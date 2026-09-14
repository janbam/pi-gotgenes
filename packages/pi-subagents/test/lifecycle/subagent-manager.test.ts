import type { JsonValue } from "@earendil-works/pi-coding-agent";
import { afterEach, beforeEach, describe, expect, it, type Mock, vi } from "vitest";
import { AgentTypeRegistry } from "#src/config/agent-types";
import { ConcurrencyLimiter } from "#src/lifecycle/concurrency-limiter";
import type {
  CreateSubagentSessionParams,
  RestoreSubagentSessionParams,
} from "#src/lifecycle/create-subagent-session";
import type { AgentSpawnConfig } from "#src/lifecycle/subagent-manager";
import { resolveRetentionWindow, SubagentManager, type SubagentManagerObserver } from "#src/lifecycle/subagent-manager";
import type {
  PersistedSubagentRecord,
  SubagentRegistryWriter,
} from "#src/lifecycle/subagent-persistence";
import type { SubagentSession } from "#src/lifecycle/subagent-session";
import type { WorkspaceProvider } from "#src/lifecycle/workspace";
import { NotificationManager } from "#src/observation/notification";
import { SubagentEventsObserver } from "#src/observation/subagent-events-observer";
import type { RunConfig } from "#src/runtime";
import { SubagentsServiceAdapter } from "#src/service/service-adapter";
import type { AgentConfig, SessionContext, Subagent } from "#src/types";
import { makeWorkspace, makeWorkspaceProvider } from "#test/helpers/make-workspace";
import { createBlockingFactory, createSessionFactory } from "#test/helpers/manager-stubs";
import { createMockSession, createSubagentSessionStub, emitResumeUsageAndCompaction, toSubagentSession } from "#test/helpers/mock-session";
import { STUB_SNAPSHOT } from "#test/helpers/stub-ctx";

/** Default max concurrent background agents (matches production default). */
const DEFAULT_MAX_CONCURRENT = 4;

type SessionFactory = (params: CreateSubagentSessionParams) => Promise<SubagentSession>;
type RestoreFactory = (
  params: RestoreSubagentSessionParams,
) => Promise<SubagentSession>;

/** Default factory: resolves to a fresh SubagentSession stub on every spawn. */
function defaultFactory(): SessionFactory {
  return vi.fn(async (_params: CreateSubagentSessionParams) => toSubagentSession(createSubagentSessionStub()));
}

function makeAgentConfig(overrides: Partial<AgentConfig> = {}): AgentConfig {
  return {
    name: "test-agent",
    description: "Test agent",
    toolNames: ["read", "grep"],
    systemPrompt: "You are a test agent.",
    promptMode: "replace",
    inheritContext: false,
    runInBackground: false,
    ...overrides,
  };
}

/** Registry with default agents only. */
function defaultRegistry(): AgentTypeRegistry {
  return new AgentTypeRegistry(() => new Map());
}

/** Registry with a single custom agent override, keyed by its canonical name. */
function registryWith(name: string, overrides: Partial<AgentConfig>): AgentTypeRegistry {
  return new AgentTypeRegistry(() => new Map([[name, makeAgentConfig({ name, ...overrides })]]));
}

/** Test helper: construct an SubagentManager with injected stubs. */
function createManager(overrides?: {
  createSubagentSession?: SessionFactory;
  restoreSubagentSession?: RestoreFactory;
  observer?: Partial<SubagentManagerObserver>;
  getMaxConcurrent?: () => number;
  getRunConfig?: () => RunConfig;
  getRetentionPolicy?: () => { consumedSessionRetentionMinutes: number; unconsumedSessionRetentionMinutes: number };
  baseCwd?: string;
  registry?: AgentTypeRegistry;
  writeSessionState?: SubagentRegistryWriter;
}) {
  const createSubagentSession: SessionFactory = overrides?.createSubagentSession ?? defaultFactory();
  const observer: SubagentManagerObserver | undefined = overrides?.observer
    ? {
        onSubagentStarted: () => {},
        onSubagentCompleted: () => {},
        onSubagentResumed: () => {},
        onSubagentResuming: () => {},
        onSubagentCompacted: () => {},
        onSubagentCreated: () => {},
        ...overrides.observer,
      }
    : undefined;
  const limiter = new ConcurrencyLimiter(overrides?.getMaxConcurrent ?? (() => DEFAULT_MAX_CONCURRENT));
  const mgr = new SubagentManager({
    createSubagentSession,
    restoreSubagentSession: overrides?.restoreSubagentSession,
    observer,
    limiter,
    baseCwd: overrides?.baseCwd ?? "/repo",
    getRunConfig: overrides?.getRunConfig,
    getRetentionPolicy: overrides?.getRetentionPolicy,
    registry: overrides?.registry ?? defaultRegistry(),
    writeSessionState: overrides?.writeSessionState,
  });
  return { manager: mgr, createSubagentSession, limiter };
}

/** Mutable Pi session-state boundary used to simulate switch/reopen activation. */
function parentState(
  initial?: unknown,
  branchIds: string[] = ["entry-1"],
) {
  let stored = initial;
  const writeSessionState = vi.fn<SubagentRegistryWriter>((_key, value) => {
    stored = value;
  });
  const ctx: SessionContext = {
    cwd: "/repo",
    model: undefined,
    modelRegistry: { find: () => undefined, getAll: () => [] },
    getSystemPrompt: () => "parent prompt",
    sessionManager: {
      getSessionFile: () => "/sessions/parent.jsonl",
      getSessionId: () => "parent-session",
      getLeafId: () => branchIds.at(-1) ?? null,
      getBranch: () => branchIds.map((id) => ({ id })),
      getSessionState: <T extends JsonValue>() => stored as T | undefined,
    },
  };
  return { ctx, writeSessionState, read: () => stored };
}

/** One settled durable record for activation and branch-isolation tests. */
function persistedRecord(
  id: string,
  parentEntryId: string | null,
): PersistedSubagentRecord {
  return {
    id,
    type: "Explore",
    description: `record ${id}`,
    isBackground: true,
    parentEntryId,
    state: {
      status: "completed",
      result: "done",
      startedAt: 100,
      completedAt: 200,
      toolUses: 0,
      lifetimeUsage: { input: 0, output: 0, cacheWrite: 0 },
      compactionCount: 0,
      turnCount: 1,
      responseText: "done",
    },
    session: {
      outputFile: `/tasks/${id}.jsonl`,
      sessionId: `session-${id}`,
      sessionDir: "/tasks",
      effectiveCwd: "/repo",
      systemPrompt: "Explore",
      toolNames: ["read"],
    },
  };
}

/** Spawn a background agent using STUB_SNAPSHOT. */
function spawnBg(mgr: SubagentManager, prompt = "test", desc = prompt) {
  return mgr.spawn(STUB_SNAPSHOT, "general-purpose", prompt, {
    description: desc,
    background: { kind: "explicit", isBackground: true },
  });
}

/** Spawn a foreground agent using STUB_SNAPSHOT. */
function spawnFg(mgr: SubagentManager, prompt = "test", desc = prompt) {
  return mgr.spawnAndWait(STUB_SNAPSHOT, "general-purpose", prompt, {
    description: desc,
  });
}

/** Spawn a background agent carrying a parentSession.toolCallId (notification path). */
function spawnBgWithToolCall(mgr: SubagentManager, toolCallId: string, prompt = "test", desc = prompt) {
  return mgr.spawn(STUB_SNAPSHOT, "general-purpose", prompt, {
    description: desc,
    background: { kind: "explicit", isBackground: true },
    parentSession: { toolCallId },
  });
}

/** Arrange a manager at limit 1 with two bg agents over a blocking factory: first runs, second queues. */
function arrangeQueuedPair(observer?: Partial<SubagentManagerObserver>) {
  const factory = createBlockingFactory();
  const { manager: mgr } = createManager({ createSubagentSession: factory, getMaxConcurrent: () => 1, observer });
  const running = spawnBg(mgr, "a");
  const queued = spawnBg(mgr, "b");
  return { manager: mgr, factory, running, queued };
}

/**
 * Arrange a manager whose onSubagentCompleted observer forwards to a real
 * NotificationManager (mirroring SubagentEventsObserver's unconditional
 * sendCompletion delegation), with one background agent spawned via a tool
 * call. The act (when the record is marked consumed relative to awaiting)
 * stays in each test.
 */
function seedNotificationScenario() {
  const sendMessage = vi.fn();
  const notifications = new NotificationManager(sendMessage);
  const { manager } = createManager({
    observer: { onSubagentCompleted: (r) => notifications.sendCompletion(r) },
  });
  // The spawning tool call runs inside a parent agent run, so nudges are
  // withheld until it settles.
  notifications.onParentAgentStart();
  const id = spawnBgWithToolCall(manager, "tc-1");
  const record = manager.getRecord(id)!;
  return { manager, record, notifications, sendMessage };
}

/** A foreground spawn whose session creation is held open until openGate(). */
function seedForegroundNotificationScenario() {
  const sendMessage = vi.fn();
  const notifications = new NotificationManager(sendMessage);
  const { promise: gate, resolve: openGate } = Promise.withResolvers<void>(); // eslint-disable-line @typescript-eslint/no-invalid-void-type -- Promise.withResolvers<void> is valid; rule does not allow void in generic fn call type args
  const { manager } = createManager({
    observer: { onSubagentCompleted: (r) => notifications.sendCompletion(r) },
    createSubagentSession: vi.fn(async (_params: CreateSubagentSessionParams) => {
      await gate;
      return toSubagentSession(createSubagentSessionStub());
    }),
  });
  notifications.onParentAgentStart();
  const pending = spawnFg(manager);
  return { manager, notifications, sendMessage, pending, openGate };
}

describe("SubagentManager", () => {
  describe("durable parent registry", () => {
    let managers: SubagentManager[] = [];

    afterEach(async () => {
      await Promise.all(managers.map((manager) => manager.dispose()));
      managers = [];
    });

    it("hydrates only active-ancestry records while preserving hidden siblings", () => {
      const visible = persistedRecord("visible", "entry-1");
      const hidden = persistedRecord("hidden", "sibling-entry");
      const parent = parentState(
        { version: 1, records: [visible, hidden] },
        ["entry-1", "entry-2"],
      );
      const { manager } = createManager({
        writeSessionState: parent.writeSessionState,
      });
      managers.push(manager);

      manager.activate(parent.ctx);

      expect(manager.listAgents().map((record) => record.id)).toEqual(["visible"]);
      expect(parent.writeSessionState).toHaveBeenLastCalledWith(
        "@gotgenes/pi-subagents",
        expect.objectContaining({ records: [hidden, expect.objectContaining({ id: "visible" })] }),
      );
    });

    it("reopens and resumes the same ID after parent compaction and process reactivation", async () => {
      const branchIds = ["entry-1"];
      const parent = parentState(undefined, branchIds);
      const fresh = createSessionFactory(createMockSession(), "/tasks/agent.jsonl");
      const first = createManager({
        createSubagentSession: fresh.factory,
        writeSessionState: parent.writeSessionState,
      }).manager;
      managers.push(first);
      first.activate(parent.ctx);
      const id = first.spawn(STUB_SNAPSHOT, "Explore", "inspect", {
        description: "durable child",
        background: { kind: "explicit", isBackground: true },
        parentSession: {
          parentSessionFile: "/sessions/parent.jsonl",
          parentSessionId: "parent-session",
          parentEntryId: "entry-1",
        },
      });
      await first.getRecord(id)!.promise;

      // Parent compaction extends the active branch but must retain handles
      // anchored earlier in that same ancestry.
      branchIds.push("compaction-1");
      await first.deactivate();

      const reopened = createSubagentSessionStub(
        createMockSession(),
        "/tasks/agent.jsonl",
      );
      reopened.resumeTurnLoop.mockResolvedValue("continued after reopen");
      const restoreSubagentSession = vi.fn<RestoreFactory>(async () =>
        toSubagentSession(reopened),
      );
      const second = createManager({
        restoreSubagentSession,
        writeSessionState: parent.writeSessionState,
      }).manager;
      managers.push(second);

      second.activate(parent.ctx);
      const hydrated = second.getRecord(id)!;
      expect(hydrated.id).toBe(id);
      expect(hydrated.isSessionReady()).toBe(false);

      const outcome = await second.resume(id, "continue");

      expect(outcome).toEqual({ kind: "resumed", record: hydrated });
      expect(restoreSubagentSession).toHaveBeenCalledOnce();
      expect(reopened.resumeTurnLoop).toHaveBeenCalledWith(
        "continue",
        undefined,
      );
      expect(hydrated.result).toBe("continued after reopen");
    });

    it("restores the persisted workspace before reopening the child session", async () => {
      const parent = parentState();
      const liveWorkspace = makeWorkspace("/ws/agent", undefined, {
        state: { path: "/ws/agent", revision: "abc123" },
      });
      const first = createManager({
        createSubagentSession: createSessionFactory(
          createMockSession(),
          "/tasks/workspace-agent.jsonl",
        ).factory,
        writeSessionState: parent.writeSessionState,
      }).manager;
      managers.push(first);
      first.registerWorkspaceProvider(makeWorkspaceProvider(liveWorkspace));
      first.activate(parent.ctx);
      const id = first.spawn(STUB_SNAPSHOT, "Explore", "inspect", {
        description: "workspace child",
        background: { kind: "explicit", isBackground: true },
        parentSession: { parentEntryId: "entry-1" },
      });
      await first.getRecord(id)!.promise;
      await first.deactivate();

      const order: string[] = [];
      const restoredWorkspace = makeWorkspace("/ws/agent");
      const provider = makeWorkspaceProvider(undefined, restoredWorkspace);
      provider.restore.mockImplementation(async () => {
        order.push("workspace");
        return restoredWorkspace;
      });
      const reopened = createSubagentSessionStub(
        createMockSession(),
        "/tasks/workspace-agent.jsonl",
      );
      const restoreSubagentSession = vi.fn<RestoreFactory>(async () => {
        order.push("session");
        return toSubagentSession(reopened);
      });
      const second = createManager({
        restoreSubagentSession,
        writeSessionState: parent.writeSessionState,
      }).manager;
      managers.push(second);
      second.registerWorkspaceProvider(provider);
      second.activate(parent.ctx);

      await second.resume(id, "continue");

      expect(order).toEqual(["workspace", "session"]);
      expect(provider.restore).toHaveBeenCalledWith(
        expect.objectContaining({ agentId: id }),
        { path: "/ws/agent", revision: "abc123" },
      );
    });

    it("resuspends a reconstructed workspace when reopening the child session fails", async () => {
      const persisted = persistedRecord("workspace-agent", "entry-1");
      persisted.workspace = {
        providerId: "test-workspace",
        state: { path: "/ws/agent", revision: "abc123" },
      };
      const parent = parentState({ version: 1, records: [persisted] });
      const restoredWorkspace = makeWorkspace("/ws/agent", undefined, {
        state: { path: "/ws/agent", revision: "abc123" },
      });
      const manager = createManager({
        restoreSubagentSession: vi.fn(async () => {
          throw new Error("child session unavailable");
        }),
        writeSessionState: parent.writeSessionState,
      }).manager;
      managers.push(manager);
      manager.registerWorkspaceProvider(
        makeWorkspaceProvider(undefined, restoredWorkspace),
      );
      manager.activate(parent.ctx);

      // A failed child reopen leaves no turn to own the restored directory, so
      // the resume boundary must return it to its durable checkpoint at once.
      await expect(manager.resume(persisted.id, "continue")).resolves.toEqual({
        kind: "refused",
        reason: "unavailable",
      });

      expect(restoredWorkspace.suspend).toHaveBeenCalledWith({
        status: "completed",
        description: "record workspace-agent",
      });
      expect(manager.getRecord(persisted.id)?.resumeRefusal).toBe("unavailable");
    });

    it("allows the same ID to retry after its required workspace provider is restored", async () => {
      const persisted = persistedRecord("workspace-agent", "entry-1");
      persisted.workspace = {
        providerId: "test-workspace",
        state: { path: "/ws/agent", revision: "abc123" },
      };
      const parent = parentState({ version: 1, records: [persisted] });
      const reopened = createSubagentSessionStub();
      const manager = createManager({
        restoreSubagentSession: vi.fn(async () => toSubagentSession(reopened)),
        writeSessionState: parent.writeSessionState,
      }).manager;
      managers.push(manager);
      manager.activate(parent.ctx);

      await expect(manager.resume(persisted.id, "continue")).resolves.toEqual({
        kind: "refused",
        reason: "incompatible",
      });

      manager.registerWorkspaceProvider(
        makeWorkspaceProvider(undefined, makeWorkspace("/ws/agent")),
      );
      await expect(manager.resume(persisted.id, "continue")).resolves.toMatchObject({
        kind: "resumed",
      });
    });

    it("does not expose or resume a durable ID from an unrelated parent session", async () => {
      const origin = parentState({
        version: 1,
        records: [persistedRecord("origin-agent", "entry-1")],
      });
      const unrelated = parentState(undefined, ["unrelated-entry"]);
      const { manager } = createManager({
        writeSessionState: unrelated.writeSessionState,
      });
      managers.push(manager);

      manager.activate(unrelated.ctx);

      expect(manager.getRecord("origin-agent")).toBeUndefined();
      await expect(manager.resume("origin-agent", "continue")).resolves.toEqual({
        kind: "refused",
        reason: "unknown-agent",
      });
      expect(origin.read()).toBeDefined();
    });

    it("returns a stable incompatibility when the active registry schema is unsupported", async () => {
      const parent = parentState({ version: 99, records: [] });
      const { manager } = createManager({
        writeSessionState: parent.writeSessionState,
      });
      managers.push(manager);
      manager.activate(parent.ctx);

      await expect(manager.resume("agent-1", "continue")).resolves.toEqual({
        kind: "refused",
        reason: "incompatible",
      });
    });

    it("keeps an explicit deletion reason stable across parent reactivation", async () => {
      const parent = parentState();
      const first = createManager({
        createSubagentSession: createSessionFactory().factory,
        writeSessionState: parent.writeSessionState,
      }).manager;
      managers.push(first);
      first.activate(parent.ctx);
      const id = first.spawn(STUB_SNAPSHOT, "Explore", "inspect", {
        description: "deletable child",
        background: { kind: "explicit", isBackground: true },
        parentSession: { parentEntryId: "entry-1" },
      });
      await first.getRecord(id)!.promise;

      await first.clearCompleted();

      await expect(first.resume(id, "continue")).resolves.toEqual({
        kind: "refused",
        reason: "deleted",
      });
      await first.deactivate();

      const second = createManager({
        writeSessionState: parent.writeSessionState,
      }).manager;
      managers.push(second);
      second.activate(parent.ctx);
      await expect(second.resume(id, "continue")).resolves.toEqual({
        kind: "refused",
        reason: "deleted",
      });
    });

    it("hides a sibling tombstone immediately and restores its deletion reason on return", async () => {
      const branchIds = ["shared-entry", "old-entry"];
      const tombstone = {
        id: "deleted-agent",
        parentEntryId: "old-entry",
        reason: "deleted" as const,
        deletedAt: 300,
      };
      const parent = parentState(
        { version: 1, records: [], tombstones: [tombstone] },
        branchIds,
      );
      const manager = createManager({
        writeSessionState: parent.writeSessionState,
      }).manager;
      managers.push(manager);
      manager.activate(parent.ctx);
      await expect(manager.resume(tombstone.id, "continue")).resolves.toEqual({
        kind: "refused",
        reason: "deleted",
      });

      // Pi commits the leaf before session_tree handlers finish. The old
      // sibling's durable deletion marker must disappear at that live boundary.
      branchIds.splice(0, branchIds.length, "shared-entry", "new-entry");
      await expect(manager.resume(tombstone.id, "probe")).resolves.toEqual({
        kind: "refused",
        reason: "unknown-agent",
      });
      await manager.reconcileTree(parent.ctx);
      expect(JSON.stringify(parent.read())).toContain(tombstone.id);

      // Re-entering the owning lineage reprojects the preserved marker and
      // recovers the stable actionable reason for the same ID.
      branchIds.splice(0, branchIds.length, "shared-entry", "old-entry");
      await manager.reconcileTree(parent.ctx);
      await expect(manager.resume(tombstone.id, "continue")).resolves.toEqual({
        kind: "refused",
        reason: "deleted",
      });
    });

    it("waits for in-flight session creation before clearing a deactivated registry", async () => {
      const parent = parentState();
      const sessionGate = Promise.withResolvers<SubagentSession>();
      const manager = createManager({
        createSubagentSession: vi.fn(() => sessionGate.promise),
        writeSessionState: parent.writeSessionState,
      }).manager;
      managers.push(manager);
      manager.activate(parent.ctx);
      const id = spawnBg(manager);

      let deactivated = false;
      const pending = manager.deactivate().then(() => { deactivated = true; });
      await new Promise<void>((resolve) => { setImmediate(resolve); });

      expect(deactivated).toBe(false);
      expect(manager.getRecord(id)).toBeDefined();

      sessionGate.resolve(toSubagentSession(createSubagentSessionStub()));
      await pending;

      expect(deactivated).toBe(true);
      expect(manager.listAgents()).toEqual([]);
    });

    it("waits for in-flight restoration and refuses its turn during parent-session deactivation", async () => {
      const record = persistedRecord("restoring-agent", "entry-1");
      const parent = parentState({ version: 1, records: [record] });
      const restoreGate = Promise.withResolvers<void>(); // eslint-disable-line @typescript-eslint/no-invalid-void-type -- Promise.withResolvers<void> is valid; rule does not allow void in generic fn call type args
      const restoredSession = createSubagentSessionStub();
      const restoreSubagentSession = vi.fn<RestoreFactory>(async () => {
        await restoreGate.promise;
        return toSubagentSession(restoredSession);
      });
      const manager = createManager({
        restoreSubagentSession,
        writeSessionState: parent.writeSessionState,
      }).manager;
      managers.push(manager);
      manager.activate(parent.ctx);

      // Begin restoration under the outgoing session, then close admission
      // before that asynchronous boundary can publish a resumed turn.
      const resuming = manager.resume(record.id, "continue");
      await vi.waitFor(() => {
        expect(restoreSubagentSession).toHaveBeenCalledOnce();
      });
      let deactivated = false;
      const deactivating = manager.deactivate().then(() => {
        deactivated = true;
      });
      await new Promise<void>((resolve) => { setImmediate(resolve); });
      expect(deactivated).toBe(false);
      expect(() => spawnBg(manager)).toThrow(
        "Cannot spawn a subagent while a parent session transition is in progress",
      );

      restoreGate.resolve();
      await expect(resuming).resolves.toEqual({
        kind: "refused",
        reason: "parent-transition",
      });
      await deactivating;

      expect(restoredSession.resumeTurnLoop).not.toHaveBeenCalled();
      expect(restoredSession.dispose).toHaveBeenCalledOnce();
      expect(manager.listAgents()).toEqual([]);
      expect(JSON.stringify(parent.read())).toContain(record.id);
    });

    it("settles only departing sibling agents before reprojecting a tree branch", async () => {
      const branchIds = ["shared-entry", "old-entry"];
      const parent = parentState(undefined, branchIds);
      const rootGate = Promise.withResolvers<void>(); // eslint-disable-line @typescript-eslint/no-invalid-void-type -- Promise.withResolvers<void> is valid; rule does not allow void in generic fn call type args
      const siblingGate = Promise.withResolvers<void>(); // eslint-disable-line @typescript-eslint/no-invalid-void-type -- Promise.withResolvers<void> is valid; rule does not allow void in generic fn call type args
      const rootSession = createSubagentSessionStub();
      const siblingSession = createSubagentSessionStub();
      rootSession.runTurnLoop.mockImplementation(async () => {
        await rootGate.promise;
        return { responseText: "shared done", aborted: false, steered: false };
      });
      siblingSession.runTurnLoop.mockImplementation(async () => {
        await siblingGate.promise;
        return { responseText: "sibling stopped", aborted: false, steered: false };
      });
      const sessions = [rootSession, siblingSession];
      const appendedAt: Array<string | undefined> = [];
      const notifiedAt: Array<string | undefined> = [];
      const sideEffects = new SubagentEventsObserver({
        emit: vi.fn(),
        appendEntry: vi.fn(() => { appendedAt.push(branchIds.at(-1)); }),
        notifications: {
          sendCompletion: vi.fn(() => { notifiedAt.push(branchIds.at(-1)); }),
          sendUpdate: vi.fn(),
          sendWorkspaceNotice: vi.fn(),
          dispose: vi.fn(),
        },
      });
      const manager = createManager({
        createSubagentSession: vi.fn(async () =>
          toSubagentSession(sessions.shift() ?? createSubagentSessionStub()),
        ),
        observer: {
          onSubagentCompleted: (record) =>
            sideEffects.onSubagentCompleted(record),
        },
        writeSessionState: parent.writeSessionState,
      }).manager;
      managers.push(manager);
      manager.activate(parent.ctx);
      const sharedId = manager.spawn(STUB_SNAPSHOT, "Explore", "shared", {
        description: "shared agent",
        background: { kind: "explicit", isBackground: true },
        parentSession: { parentEntryId: "shared-entry" },
      });
      const siblingId = manager.spawn(STUB_SNAPSHOT, "Explore", "sibling", {
        description: "old sibling agent",
        background: { kind: "explicit", isBackground: true },
        parentSession: { parentEntryId: "old-entry" },
      });
      await vi.waitFor(() => {
        expect(rootSession.runTurnLoop).toHaveBeenCalledOnce();
        expect(siblingSession.runTurnLoop).toHaveBeenCalledOnce();
      });
      const sharedRecord = manager.getRecord(sharedId);

      // Finish the departing child while the old leaf still owns all branch-local effects.
      const preparing = manager.prepareTreeTransition("shared-entry");
      siblingGate.resolve();
      await preparing;
      expect(appendedAt).toEqual(["old-entry"]);
      expect(notifiedAt).toEqual(["old-entry"]);

      branchIds.splice(0, branchIds.length, "shared-entry", "new-entry");
      await manager.reconcileTree(parent.ctx);

      expect(manager.getRecord(siblingId)).toBeUndefined();
      expect(manager.getRecord(sharedId)).toBe(sharedRecord);
      expect(manager.getRecord(sharedId)?.status).toBe("running");
      expect(JSON.stringify(parent.read())).toContain(siblingId);

      // A shared-ancestor child remains live and may complete on the selected branch.
      rootGate.resolve();
      await sharedRecord?.promise;
      expect(appendedAt).toEqual(["old-entry", "new-entry"]);
      expect(notifiedAt).toEqual(["old-entry", "new-entry"]);
    });

    it("waits for an already-aborted departing run before releasing its branch", async () => {
      const branchIds = ["shared-entry", "old-entry"];
      const parent = parentState(undefined, branchIds);
      const runGate = Promise.withResolvers<void>(); // eslint-disable-line @typescript-eslint/no-invalid-void-type -- Promise.withResolvers<void> is valid; rule does not allow void in generic fn call type args
      const session = createSubagentSessionStub();
      const workspace = makeWorkspace("/worktrees/departing");
      session.runTurnLoop.mockImplementation(async () => {
        await runGate.promise;
        return { responseText: "stopped", aborted: false, steered: false };
      });
      const appendedAt: Array<string | undefined> = [];
      const notifiedAt: Array<string | undefined> = [];
      const sideEffects = new SubagentEventsObserver({
        emit: vi.fn(),
        appendEntry: vi.fn(() => { appendedAt.push(branchIds.at(-1)); }),
        notifications: {
          sendCompletion: vi.fn(() => { notifiedAt.push(branchIds.at(-1)); }),
          sendUpdate: vi.fn(),
          sendWorkspaceNotice: vi.fn(),
          dispose: vi.fn(),
        },
      });
      const manager = createManager({
        createSubagentSession: vi.fn(async () => toSubagentSession(session)),
        observer: {
          onSubagentCompleted: (record) =>
            sideEffects.onSubagentCompleted(record),
        },
        writeSessionState: parent.writeSessionState,
      }).manager;
      managers.push(manager);
      manager.registerWorkspaceProvider(makeWorkspaceProvider(workspace));
      manager.activate(parent.ctx);
      const id = manager.spawn(STUB_SNAPSHOT, "Explore", "inspect", {
        description: "already stopped sibling",
        background: { kind: "explicit", isBackground: true },
        parentSession: { parentEntryId: "old-entry" },
      });
      await vi.waitFor(() => {
        expect(session.runTurnLoop).toHaveBeenCalledOnce();
      });

      // A synchronous stopped status does not mean the run's terminal observer
      // and resource teardown have settled.
      expect(manager.abort(id)).toBe(true);
      let prepared = false;
      const preparing = manager.prepareTreeTransition("shared-entry").then(() => {
        prepared = true;
      });
      await Promise.resolve();
      expect(prepared).toBe(false);
      expect(session.dispose).not.toHaveBeenCalled();

      runGate.resolve();
      await preparing;
      expect(appendedAt).toEqual(["old-entry"]);
      expect(notifiedAt).toEqual(["old-entry"]);
      expect(workspace.suspend).toHaveBeenCalledOnce();
      expect(session.dispose).toHaveBeenCalledOnce();

      branchIds.splice(0, branchIds.length, "shared-entry", "new-entry");
      await manager.reconcileTree(parent.ctx);
      expect(manager.getRecord(id)).toBeUndefined();
      expect(appendedAt).toEqual(["old-entry"]);
      expect(notifiedAt).toEqual(["old-entry"]);
    });

    it("rejects reentrant service spawns during tree preparation", async () => {
      const branchIds = ["shared-entry", "old-entry"];
      const parent = parentState(undefined, branchIds);
      const siblingGate = Promise.withResolvers<void>(); // eslint-disable-line @typescript-eslint/no-invalid-void-type -- Promise.withResolvers<void> is valid; rule does not allow void in generic fn call type args
      const siblingSession = createSubagentSessionStub();
      siblingSession.runTurnLoop.mockImplementation(async () => {
        await siblingGate.promise;
        return { responseText: "sibling stopped", aborted: false, steered: false };
      });
      const workspace = makeWorkspace("/worktrees/sibling");
      const eventsAt: Array<{ channel: string; leaf: string | undefined }> = [];
      const appendedAt: Array<string | undefined> = [];
      const notifiedAt: Array<string | undefined> = [];
      let reentrantError: unknown;
      let reentrantResume: ReturnType<SubagentsServiceAdapter["resume"]> | undefined;
      const serviceRef: { current?: SubagentsServiceAdapter } = {};
      const sideEffects = new SubagentEventsObserver({
        emit: (channel) => {
          eventsAt.push({ channel, leaf: branchIds.at(-1) });
          if (channel !== "subagents:failed") return;
          const service = serviceRef.current;
          if (!service) throw new Error("service fixture was not initialized");
          try {
            service.spawn("Explore", "spawned by completion subscriber");
          } catch (error) {
            reentrantError = error;
          }
          reentrantResume = service.resume(siblingId, "resume from completion subscriber");
        },
        appendEntry: vi.fn(() => { appendedAt.push(branchIds.at(-1)); }),
        notifications: {
          sendCompletion: vi.fn(() => { notifiedAt.push(branchIds.at(-1)); }),
          sendUpdate: vi.fn(),
          sendWorkspaceNotice: vi.fn(),
          dispose: vi.fn(),
        },
      });
      const manager = createManager({
        createSubagentSession: vi.fn(async () => toSubagentSession(siblingSession)),
        observer: {
          onSubagentCompleted: (record) =>
            sideEffects.onSubagentCompleted(record),
        },
        writeSessionState: parent.writeSessionState,
      }).manager;
      managers.push(manager);
      manager.registerWorkspaceProvider(makeWorkspaceProvider(workspace));
      manager.activate(parent.ctx);
      serviceRef.current = new SubagentsServiceAdapter(
        manager,
        vi.fn(),
        {
          currentCtx: parent.ctx,
          buildSnapshot: () => STUB_SNAPSHOT,
          getSessionInfo: () => ({
            parentSessionFile: "/sessions/parent.jsonl",
            parentSessionId: "parent-session",
            parentEntryId: branchIds.at(-1) ?? null,
          }),
        },
      );
      const siblingId = manager.spawn(STUB_SNAPSHOT, "Explore", "sibling", {
        description: "old sibling agent",
        background: { kind: "explicit", isBackground: true },
        parentSession: { parentEntryId: "old-entry" },
      });
      await vi.waitFor(() => {
        expect(siblingSession.runTurnLoop).toHaveBeenCalledOnce();
      });

      // The completion event is a synchronous cross-extension reentrancy point;
      // it must not admit fresh old-leaf work after the departing snapshot.
      const preparing = manager.prepareTreeTransition("shared-entry");
      siblingGate.resolve();
      await preparing;
      expect(reentrantError).toEqual(
        new Error("Cannot spawn a subagent while a parent session transition is in progress"),
      );
      await expect(reentrantResume).resolves.toEqual({
        kind: "refused",
        reason: "parent-transition",
      });
      expect(manager.listAgents().map((record) => record.id)).toEqual([siblingId]);
      expect(siblingSession.dispose).toHaveBeenCalledOnce();
      expect(workspace.suspend).toHaveBeenCalledOnce();
      expect(eventsAt).toEqual([
        { channel: "subagents:failed", leaf: "old-entry" },
      ]);
      expect(appendedAt).toEqual(["old-entry"]);
      expect(notifiedAt).toEqual(["old-entry"]);

      branchIds.splice(0, branchIds.length, "shared-entry", "new-entry");
      await manager.reconcileTree(parent.ctx);
      expect(manager.getRecord(siblingId)).toBeUndefined();
      expect(JSON.stringify(parent.read())).toContain(siblingId);
      expect(eventsAt).toEqual([
        { channel: "subagents:failed", leaf: "old-entry" },
      ]);
      expect(appendedAt).toEqual(["old-entry"]);
      expect(notifiedAt).toEqual(["old-entry"]);
    });

    it("silently settles old-lineage work admitted after tree preparation", async () => {
      const branchIds = ["shared-entry", "old-entry"];
      const parent = parentState(undefined, branchIds);
      const lateGate = Promise.withResolvers<void>(); // eslint-disable-line @typescript-eslint/no-invalid-void-type -- Promise.withResolvers<void> is valid; rule does not allow void in generic fn call type args
      const lateSession = createSubagentSessionStub();
      const workspace = makeWorkspace("/worktrees/late-sibling");
      lateSession.runTurnLoop.mockImplementation(async () => {
        await lateGate.promise;
        return { responseText: "late sibling stopped", aborted: false, steered: false };
      });
      const eventsAt: Array<{ channel: string; leaf: string | undefined }> = [];
      const appendedAt: Array<string | undefined> = [];
      const notifiedAt: Array<string | undefined> = [];
      const sideEffects = new SubagentEventsObserver({
        emit: (channel) => { eventsAt.push({ channel, leaf: branchIds.at(-1) }); },
        appendEntry: vi.fn(() => { appendedAt.push(branchIds.at(-1)); }),
        notifications: {
          sendCompletion: vi.fn(() => { notifiedAt.push(branchIds.at(-1)); }),
          sendUpdate: vi.fn(),
          sendWorkspaceNotice: vi.fn(),
          dispose: vi.fn(),
        },
      });
      let isCurrent: (() => boolean) | undefined;
      const manager = createManager({
        createSubagentSession: vi.fn(async (params) => {
          isCurrent = params.isCurrent;
          return toSubagentSession(lateSession);
        }),
        observer: {
          onSubagentCompleted: (record) =>
            sideEffects.onSubagentCompleted(record),
        },
        writeSessionState: parent.writeSessionState,
      }).manager;
      managers.push(manager);
      manager.registerWorkspaceProvider(makeWorkspaceProvider(workspace));
      manager.activate(parent.ctx);
      const service = new SubagentsServiceAdapter(
        manager,
        vi.fn(),
        {
          currentCtx: parent.ctx,
          buildSnapshot: () => STUB_SNAPSHOT,
          getSessionInfo: () => ({
            parentSessionFile: "/sessions/parent.jsonl",
            parentSessionId: "parent-session",
            parentEntryId: branchIds.at(-1) ?? null,
          }),
        },
      );

      // Admission reopens after preparation because another extension can
      // cancel navigation without emitting a matching completion event.
      await manager.prepareTreeTransition("shared-entry");
      const lateId = service.spawn("Explore", "admitted before tree commit");
      await vi.waitFor(() => {
        expect(lateSession.runTurnLoop).toHaveBeenCalledOnce();
      });
      expect(isCurrent?.()).toBe(true);

      branchIds.splice(0, branchIds.length, "shared-entry", "new-entry");
      expect(isCurrent?.()).toBe(false);
      expect(service.getRecord(lateId)).toBeUndefined();
      expect(service.listAgents()).toEqual([]);
      expect(service.abort(lateId)).toBe(false);
      await expect(service.resume(lateId, "must stay hidden")).resolves.toEqual({
        kind: "refused",
        reason: "unknown-agent",
      });
      let reconciled = false;
      const reconciling = manager.reconcileTree(parent.ctx).then(() => {
        reconciled = true;
      });
      await Promise.resolve();
      expect(reconciled).toBe(false);

      lateGate.resolve();
      await reconciling;
      expect(manager.getRecord(lateId)).toBeUndefined();
      expect(JSON.stringify(parent.read())).toContain(lateId);
      expect(JSON.stringify(parent.read())).toContain('"status":"stopped"');
      expect(lateSession.dispose).toHaveBeenCalledOnce();
      expect(workspace.suspend).toHaveBeenCalledOnce();
      expect(eventsAt).toEqual([]);
      expect(appendedAt).toEqual([]);
      expect(notifiedAt).toEqual([]);
    });

    it("refuses a resume whose session restoration crosses into a sibling branch", async () => {
      const branchIds = ["shared-entry", "old-entry"];
      const record = persistedRecord("restoring-agent", "old-entry");
      const parent = parentState(
        { version: 1, records: [record], tombstones: [] },
        branchIds,
      );
      const restoreGate = Promise.withResolvers<void>(); // eslint-disable-line @typescript-eslint/no-invalid-void-type -- Promise.withResolvers<void> is valid; rule does not allow void in generic fn call type args
      const restoredSession = createSubagentSessionStub();
      const restoreSubagentSession = vi.fn<RestoreFactory>(async () => {
        await restoreGate.promise;
        return toSubagentSession(restoredSession);
      });
      const onSubagentResuming = vi.fn();
      const onSubagentResumed = vi.fn();
      const manager = createManager({
        restoreSubagentSession,
        observer: { onSubagentResuming, onSubagentResumed },
        writeSessionState: parent.writeSessionState,
      }).manager;
      managers.push(manager);
      manager.activate(parent.ctx);
      await manager.prepareTreeTransition("shared-entry");

      // Restoration starts on the old leaf, but must revalidate lineage before
      // it is allowed to start the resumed turn loop.
      const resuming = manager.resume(record.id, "continue");
      await vi.waitFor(() => {
        expect(restoreSubagentSession).toHaveBeenCalledOnce();
      });
      branchIds.splice(0, branchIds.length, "shared-entry", "new-entry");
      let reconciled = false;
      const reconciling = manager.reconcileTree(parent.ctx).then(() => {
        reconciled = true;
      });
      await Promise.resolve();
      expect(reconciled).toBe(false);
      expect(manager.getRecord(record.id)).toBeUndefined();

      restoreGate.resolve();
      await expect(resuming).resolves.toEqual({
        kind: "refused",
        reason: "parent-transition",
      });
      await reconciling;
      expect(restoredSession.resumeTurnLoop).not.toHaveBeenCalled();
      expect(restoredSession.dispose).toHaveBeenCalledOnce();
      expect(onSubagentResuming).not.toHaveBeenCalled();
      expect(onSubagentResumed).not.toHaveBeenCalled();
      expect(JSON.stringify(parent.read())).toContain(record.id);
    });

    it("reopens admission as soon as tree preparation settles", async () => {
      const parent = parentState(undefined, ["shared-entry", "old-entry"]);
      const manager = createManager({
        writeSessionState: parent.writeSessionState,
      }).manager;
      managers.push(manager);
      manager.activate(parent.ctx);

      await manager.prepareTreeTransition("shared-entry");
      expect(() => spawnBg(manager)).not.toThrow();
    });
  });

  describe("spawn", () => {
    let manager: SubagentManager;

    afterEach(() => {
      manager.abortAll();
    });

    describe("type resolution", () => {
      it("stores the canonical type for case-variant input", () => {
        ({ manager } = createManager());

        const id = manager.spawn(STUB_SNAPSHOT, "explore", "test", {
          description: "d",
          background: { kind: "explicit", isBackground: true },
        });

        expect(manager.getRecord(id)!.type).toBe("Explore");
      });

      it("falls back to general-purpose for an unknown type", () => {
        ({ manager } = createManager());

        const id = manager.spawn(STUB_SNAPSHOT, "no-such-agent", "test", {
          description: "d",
          background: { kind: "explicit", isBackground: true },
        });

        expect(manager.getRecord(id)!.type).toBe("general-purpose");
      });

      it("throws for a known-but-disabled type", () => {
        ({ manager } = createManager({ registry: registryWith("Plan", { enabled: false }) }));

        expect(() =>
          manager.spawn(STUB_SNAPSHOT, "Plan", "test", {
            description: "d",
            background: { kind: "explicit", isBackground: true },
          }),
        ).toThrow('Agent type "Plan" is disabled');
      });

      it("reports the canonical casing in the disabled-agent error for case-insensitive input", () => {
        ({ manager } = createManager({ registry: registryWith("Plan", { enabled: false }) }));

        expect(() =>
          manager.spawn(STUB_SNAPSHOT, "plan", "test", {
            description: "d",
            background: { kind: "explicit", isBackground: true },
          }),
        ).toThrow('Agent type "Plan" is disabled');
      });

      it("does not create a record for a rejected spawn", () => {
        ({ manager } = createManager({ registry: registryWith("Plan", { enabled: false }) }));

        expect(() =>
          manager.spawn(STUB_SNAPSHOT, "Plan", "test", {
            description: "d",
            background: { kind: "explicit", isBackground: true },
          }),
        ).toThrow();

        expect(manager.listAgents()).toEqual([]);
      });
    });

    /**
     * onSubagentCreated fires only for a background agent, so it is the
     * discriminator here. Record status cannot serve: under the default
     * concurrency limit a background agent is admitted immediately and reaches
     * "running" too, so asserting on it passes whichever mode resolves.
     */
    describe("background-mode resolution", () => {
      let onCreated: Mock<(record: Subagent) => void>;

      function spawnExplore(background: AgentSpawnConfig["background"], runInBackground: boolean) {
        onCreated = vi.fn();
        ({ manager } = createManager({
          registry: registryWith("Explore", { runInBackground }),
          observer: { onSubagentCreated: onCreated },
        }));
        return manager.spawn(STUB_SNAPSHOT, "Explore", "test", { description: "d", background });
      }

      it("defers to frontmatter declaring background when the request is a default", () => {
        spawnExplore({ kind: "default", isBackground: false }, true);

        expect(onCreated).toHaveBeenCalledOnce();
      });

      it("defers to frontmatter declaring foreground when the request is a default", () => {
        spawnExplore({ kind: "default", isBackground: true }, false);

        expect(onCreated).not.toHaveBeenCalled();
      });

      it("ignores frontmatter declaring foreground when the request is explicit", () => {
        spawnExplore({ kind: "explicit", isBackground: true }, false);

        expect(onCreated).toHaveBeenCalledOnce();
      });

      it("ignores frontmatter declaring background when the request is explicit", () => {
        spawnExplore({ kind: "explicit", isBackground: false }, true);

        expect(onCreated).not.toHaveBeenCalled();
      });

      it("stamps the resolved mode on the record when it resolves to background", () => {
        const id = spawnExplore({ kind: "default", isBackground: false }, true);

        expect(manager.getRecord(id)!.isBackground).toBe(true);
      });

      it("stamps the resolved mode on the record when it resolves to foreground", () => {
        const id = spawnExplore({ kind: "default", isBackground: true }, false);

        expect(manager.getRecord(id)!.isBackground).toBe(false);
      });

      it("queues a resolved-background agent behind a full concurrency limit", () => {
        onCreated = vi.fn();
        ({ manager } = createManager({
          registry: registryWith("Explore", { runInBackground: true }),
          getMaxConcurrent: () => 1,
          createSubagentSession: createBlockingFactory(),
        }));
        spawnBg(manager, "occupies-the-only-slot");

        const id = manager.spawn(STUB_SNAPSHOT, "Explore", "test", {
          description: "d",
          background: { kind: "default", isBackground: false },
        });

        expect(manager.getRecord(id)!.status).toBe("queued");
      });
    });
  });

  describe("spawnAndWait", () => {
    let manager: SubagentManager;

    afterEach(() => {
      manager.abortAll();
    });

    describe("type resolution", () => {
      it("stores the canonical type for case-variant input", async () => {
        ({ manager } = createManager());

        const record = await manager.spawnAndWait(STUB_SNAPSHOT, "explore", "test", { description: "d" });

        expect(record.type).toBe("Explore");
      });

      it("rejects for a known-but-disabled type", async () => {
        ({ manager } = createManager({ registry: registryWith("Plan", { enabled: false }) }));

        await expect(
          manager.spawnAndWait(STUB_SNAPSHOT, "Plan", "test", { description: "d" }),
        ).rejects.toThrow('Agent type "Plan" is disabled');
      });
    });

    describe("foreground commitment", () => {
      it("stamps isBackground false on the record", async () => {
        ({ manager } = createManager({ registry: registryWith("Explore", { runInBackground: true }) }));

        const record = await manager.spawnAndWait(STUB_SNAPSHOT, "Explore", "test", { description: "d" });

        expect(record.isBackground).toBe(false);
      });

      it("stays foreground for an agent whose frontmatter declares runInBackground: true", async () => {
        const onCreated = vi.fn();
        ({ manager } = createManager({
          registry: registryWith("Explore", { runInBackground: true }),
          observer: { onSubagentCreated: onCreated },
        }));

        const record = await manager.spawnAndWait(STUB_SNAPSHOT, "Explore", "test", { description: "d" });

        // The caller holds the result promise, so the frontmatter must not route
        // it through the limiter or announce it as a background agent.
        expect(record.status).toBe("completed");
        expect(onCreated).not.toHaveBeenCalled();
      });

      it("claims the outcome before the run can terminate", async () => {
        // Hold session creation open so the claim is observable while the run is
        // still in flight — the window in which the nudge would otherwise fire.
        const { promise: gate, resolve: openGate } = Promise.withResolvers<void>(); // eslint-disable-line @typescript-eslint/no-invalid-void-type -- Promise.withResolvers<void> is valid; rule does not allow void in generic fn call type args
        ({ manager } = createManager({
          createSubagentSession: vi.fn(async (_params: CreateSubagentSessionParams) => {
            await gate;
            return toSubagentSession(createSubagentSessionStub());
          }),
        }));

        const pending = manager.spawnAndWait(STUB_SNAPSHOT, "Explore", "test", { description: "d" });

        expect(manager.listAgents()[0]?.claimed).toBe(true);

        openGate();
        const record = await pending;
        expect(record.claimed).toBe(true);
      });

      it("runs immediately rather than queueing behind a full concurrency limit", async () => {
        // Only the first session creation blocks, so the background agent holds
        // the single limiter slot open while the foreground agent runs.
        let creations = 0;
        const factory = vi.fn((_params: CreateSubagentSessionParams) => {
          creations += 1;
          return creations === 1
            ? new Promise<SubagentSession>(() => {})
            : Promise.resolve(toSubagentSession(createSubagentSessionStub()));
        });
        ({ manager } = createManager({
          registry: registryWith("Explore", { runInBackground: true }),
          getMaxConcurrent: () => 1,
          createSubagentSession: factory,
        }));
        spawnBg(manager, "occupies-the-only-slot");

        // Were this routed through the limiter, the await would never settle.
        const record = await manager.spawnAndWait(STUB_SNAPSHOT, "Explore", "test", { description: "d" });

        expect(record.status).toBe("completed");
      });
    });
  });

  describe("concurrency", () => {
    describe("queueing with injected stubs", () => {
      let manager: SubagentManager;

      afterEach(async () => {
        await manager.dispose();
      });

      it("queues excess background agents and drains them in order", async () => {
        const startOrder: string[] = [];
        const { promise: gate1, resolve: resolve1 } = Promise.withResolvers<void>(); // eslint-disable-line @typescript-eslint/no-invalid-void-type -- Promise.withResolvers<void> is valid; rule does not allow void in generic fn call type args
        const { promise: gate2, resolve: resolve2 } = Promise.withResolvers<void>(); // eslint-disable-line @typescript-eslint/no-invalid-void-type -- Promise.withResolvers<void> is valid; rule does not allow void in generic fn call type args

        let callCount = 0;
        const factory: SessionFactory = vi.fn(async () => {
          callCount++;
          const n = callCount;
          startOrder.push(`start-${n}`);
          const stub = createSubagentSessionStub();
          stub.runTurnLoop.mockImplementation(async () => {
            if (n === 1) await gate1;
            if (n === 2) await gate2;
            return { responseText: `result-${n}`, aborted: false, steered: false };
          });
          return toSubagentSession(stub);
        });
        ({ manager } = createManager({ createSubagentSession: factory, getMaxConcurrent: () => 1 }));

        // Spawn two background agents — first runs, second queues
        const id1 = spawnBg(manager, "test1", "first");
        const id2 = spawnBg(manager, "test2", "second");

        expect(manager.getRecord(id1)!.status).toBe("running");
        expect(manager.getRecord(id2)!.status).toBe("queued");

        // Complete first agent — second should start
        resolve1();
        await manager.getRecord(id1)!.promise;

        // Wait for the second to start
        await vi.waitFor(() => expect(manager.getRecord(id2)!.status).toBe("running"));

        resolve2();
        await manager.getRecord(id2)!.promise;

        expect(startOrder).toEqual(["start-1", "start-2"]);
        expect(manager.getRecord(id1)!.result).toBe("result-1");
        expect(manager.getRecord(id2)!.result).toBe("result-2");
      });

      it("gives a queued agent an awaitable promise at spawn (before its slot opens)", () => {
        const { manager: mgr, running, queued } = arrangeQueuedPair();
        manager = mgr;

        // A still-queued agent must already expose a settle-on-completion promise,
        // so waitForAll can await it without relying on a re-poll. (Regression
        // guard: #374 made the promise lazy; the limiter handle is captured eagerly.)
        expect(manager.getRecord(queued)!.status).toBe("queued");
        expect(manager.getRecord(queued)!.promise).toBeInstanceOf(Promise);

        manager.abort(running);
        manager.abort(queued);
      });

      it("abort removes a queued agent without ever running it", () => {
        const { manager: mgr, factory, running, queued } = arrangeQueuedPair();
        manager = mgr;

        expect(manager.getRecord(queued)!.status).toBe("queued");

        // Abort the queued agent
        expect(manager.abort(queued)).toBe(true);
        expect(manager.getRecord(queued)!.status).toBe("stopped");

        // factory was called once (for the first agent), never for the aborted one
        expect(factory).toHaveBeenCalledOnce();

        manager.abort(running);
      });

      it("onStart fires when agent transitions from queued to running", async () => {
        const startedIds: string[] = [];
        const { promise: gate, resolve } = Promise.withResolvers<void>(); // eslint-disable-line @typescript-eslint/no-invalid-void-type -- Promise.withResolvers<void> is valid; rule does not allow void in generic fn call type args

        let callCount = 0;
        const factory: SessionFactory = vi.fn(async () => {
          callCount++;
          const n = callCount;
          const stub = createSubagentSessionStub();
          stub.runTurnLoop.mockImplementation(async () => {
            if (n === 1) await gate;
            return { responseText: "ok", aborted: false, steered: false };
          });
          return toSubagentSession(stub);
        });
        ({ manager } = createManager({
          createSubagentSession: factory,
          getMaxConcurrent: () => 1,
          observer: { onSubagentStarted: (record) => { startedIds.push(record.id); } },
        }));

        const id1 = spawnBg(manager, "a");
        const id2 = spawnBg(manager, "b");

        // First agent started immediately
        expect(startedIds).toEqual([id1]);

        // Complete first — second should start and fire onStart
        resolve();
        await manager.getRecord(id1)!.promise;
        await vi.waitFor(() => expect(startedIds).toHaveLength(2));

        expect(startedIds).toEqual([id1, id2]);

        await manager.getRecord(id2)!.promise;
      });
    });

    // Diagnosis, boundary, and these three cases contributed by @daoguademeng in #665.
    describe("stopping a queued agent", () => {
      let manager: SubagentManager;

      afterEach(async () => {
        await manager.dispose();
      });

      it("abort() on a queued agent notifies onSubagentCompleted", () => {
        const completed: Subagent[] = [];
        const { manager: mgr, running, queued } = arrangeQueuedPair({
          onSubagentCompleted: (record) => completed.push(record),
        });
        manager = mgr;

        expect(manager.abort(queued)).toBe(true);

        expect(completed).toHaveLength(1);
        expect(completed[0]).toBe(manager.getRecord(queued));
        expect(manager.getRecord(queued)!.status).toBe("stopped");
        expect(manager.getRecord(queued)!.stoppedWhileQueued).toBe(true);

        manager.abort(running);
      });

      it("abortAll() notifies onSubagentCompleted for queued agents", () => {
        const completed: Subagent[] = [];
        const { manager: mgr, queued } = arrangeQueuedPair({
          onSubagentCompleted: (record) => completed.push(record),
        });
        manager = mgr;

        expect(manager.abortAll()).toBe(2);

        // Only the queued agent notifies here: the running one's session creation
        // never resolves, so its run never reaches completeRun/failRun.
        expect(completed).toHaveLength(1);
        expect(completed[0]).toBe(manager.getRecord(queued));
        expect(manager.getRecord(queued)!.stoppedWhileQueued).toBe(true);
      });

      it("notifies exactly once, even after the stopped agent's slot frees", async () => {
        const completed: Subagent[] = [];
        const { promise: gate, resolve } = Promise.withResolvers<void>(); // eslint-disable-line @typescript-eslint/no-invalid-void-type -- Promise.withResolvers<void> is valid; rule does not allow void in generic fn call type args

        let callCount = 0;
        const factory: SessionFactory = vi.fn(async () => {
          callCount++;
          const n = callCount;
          const stub = createSubagentSessionStub();
          stub.runTurnLoop.mockImplementation(async () => {
            if (n === 1) await gate;
            return { responseText: `result-${n}`, aborted: false, steered: false };
          });
          return toSubagentSession(stub);
        });
        ({ manager } = createManager({
          createSubagentSession: factory,
          getMaxConcurrent: () => 1,
          observer: { onSubagentCompleted: (record) => completed.push(record) },
        }));

        const running = spawnBg(manager, "a");
        const queued = spawnBg(manager, "b");
        expect(manager.getRecord(queued)!.status).toBe("queued");

        manager.abort(queued);
        const notificationsFor = (id: string) => completed.filter((record) => record.id === id);
        expect(notificationsFor(queued)).toHaveLength(1);

        // Free the slot. The limiter runs the stopped agent's thunk, which must
        // no-op on guardedRun()'s active guard rather than run and notify again.
        resolve();
        await manager.getRecord(running)!.promise;
        await manager.getRecord(queued)!.promise;

        expect(notificationsFor(queued)).toHaveLength(1);
        expect(factory).toHaveBeenCalledOnce();
      });
    });
  });

  describe("observer notifications", () => {
    describe("completion callbacks", () => {
      let manager: SubagentManager;

      afterEach(async () => {
        await manager.dispose();
      });

      it("does not let onComplete errors turn a completed agent into a failed run", async () => {
        ({ manager } = createManager({ observer: { onSubagentCompleted: () => {
          throw new Error("stale extension context");
        } } }));

        const id = spawnBg(manager);
        await expect(manager.getRecord(id)!.promise).resolves.toBeUndefined();

        expect(manager.getRecord(id)!.status).toBe("completed");
      });
    });

    describe("onSubagentCreated", () => {
      let manager: SubagentManager;

      afterEach(async () => {
        await manager.dispose();
      });

      it("fires onSubagentCreated when a background agent is spawned", () => {
        const onCreated = vi.fn();
        ({ manager } = createManager({ observer: { onSubagentCreated: onCreated } }));

        const id = manager.spawn(STUB_SNAPSHOT, "general-purpose", "test", {
          description: "test agent",
          background: { kind: "explicit", isBackground: true },
        });

        expect(onCreated).toHaveBeenCalledOnce();
        expect(onCreated).toHaveBeenCalledWith(manager.getRecord(id));

        manager.abort(id);
      });

      it("does not fire onSubagentCreated for foreground agents", async () => {
        const onCreated = vi.fn();
        ({ manager } = createManager({ observer: { onSubagentCreated: onCreated } }));

        await manager.spawnAndWait(STUB_SNAPSHOT, "general-purpose", "test", {
          description: "foreground agent",
        });

        expect(onCreated).not.toHaveBeenCalled();
      });

      it("fires onSubagentCreated before onSubagentStarted for background agents", async () => {
        const callOrder: string[] = [];
        ({ manager } = createManager({
          observer: {
            onSubagentCreated: () => { callOrder.push("created"); },
            onSubagentStarted: () => { callOrder.push("started"); },
          },
        }));

        const id = manager.spawn(STUB_SNAPSHOT, "general-purpose", "test", {
          description: "bg agent",
          background: { kind: "explicit", isBackground: true },
        });
        await manager.getRecord(id)!.promise;

        expect(callOrder).toEqual(["created", "started"]);
      });
    });

    describe("lifecycle observer forwarding", () => {
      let manager: SubagentManager;

      beforeEach(() => {
        const { factory } = createSessionFactory(createMockSession());
        ({ manager } = createManager({ createSubagentSession: factory }));
      });

      afterEach(async () => {
        await manager.dispose();
      });

      it("forwards onSessionCreated from spawn options observer to Agent", async () => {
        const received: { agent: Subagent | undefined } = { agent: undefined };

        const id = manager.spawn(STUB_SNAPSHOT, "general-purpose", "test", {
          description: "test",
          background: { kind: "explicit", isBackground: true },
          observer: {
            onSessionCreated: (agent) => {
              received.agent = agent;
            },
          },
        });
        await manager.getRecord(id)!.promise;

        expect(received.agent).toBe(manager.getRecord(id));
        expect(received.agent!.id).toBe(id);
      });

      it("forwards onSessionCreated for foreground agents", async () => {
        const received: { agent: Subagent | undefined } = { agent: undefined };

        await manager.spawnAndWait(STUB_SNAPSHOT, "general-purpose", "test", {
          description: "fg",
          observer: {
            onSessionCreated: (agent) => {
              received.agent = agent;
            },
          },
        });

        expect(received.agent).toBeDefined();
        expect(received.agent!.type).toBe("general-purpose");
      });
    });

    describe("toolCallId notification wiring", () => {
      let manager: SubagentManager;

      afterEach(async () => {
        await manager.dispose();
      });

      it("wires toolCallId on spawn when provided", () => {
        ({ manager } = createManager());

        const id = spawnBgWithToolCall(manager, "tc-42", "test", "bg");
        const record = manager.getRecord(id)!;

        expect(record.toolCallId).toBe("tc-42");
        manager.abort(id);
      });

      it("toolCallId is undefined when absent", () => {
        ({ manager } = createManager());

        const id = manager.spawn(STUB_SNAPSHOT, "general-purpose", "test", {
          description: "bg",
          background: { kind: "explicit", isBackground: true },
        });
        const record = manager.getRecord(id)!;

        expect(record.toolCallId).toBeUndefined();
        manager.abort(id);
      });
    });

    describe("consumed state versus onComplete ordering", () => {
      let manager: SubagentManager;

      beforeEach(() => {
        vi.useFakeTimers();
      });

      afterEach(async () => {
        await manager.dispose();
        vi.useRealTimers();
      });

      it("marking consumed after awaiting still suppresses the nudge (flush-time re-check)", async () => {
        const seeded = seedNotificationScenario();
        manager = seeded.manager;
        const { record, sendMessage } = seeded;

        // onSubagentCompleted already withheld the nudge by the time this await
        // resumes (it fires synchronously inside record.promise's resolution
        // chain). The parent pulls the result (markConsumed) later in the same
        // run; the notification manager re-reads record.consumed when the run
        // settles and drops the nudge — no separate cancel call needed.
        await record.promise;
        record.markConsumed();

        seeded.notifications.onParentAgentSettled();
        expect(sendMessage).not.toHaveBeenCalled();
      });

      it("marking consumed before await suppresses the nudge (schedule-time guard)", async () => {
        const seeded = seedNotificationScenario();
        manager = seeded.manager;
        const { record, sendMessage } = seeded;

        // The parent already holds the result: sendCompletion sees record.consumed
        // at enqueue time and never withholds a nudge to flush.
        record.markConsumed();
        await record.promise;

        seeded.notifications.onParentAgentSettled();
        expect(sendMessage).not.toHaveBeenCalled();
      });

      it("onComplete is called for foreground agents", async () => {
        let onCompleteCalled = false;
        ({ manager } = createManager({ observer: { onSubagentCompleted: () => {
          onCompleteCalled = true;
        } } }));

        await spawnFg(manager);

        // The lifecycle event and the session-history record are facts about the
        // run, owed for every agent; only the nudge is conditional.
        expect(onCompleteCalled).toBe(true);
      });

      it("sends no nudge for a foreground completion", async () => {
        const seeded = seedForegroundNotificationScenario();
        manager = seeded.manager;

        seeded.openGate();
        await seeded.pending;
        seeded.notifications.onParentAgentSettled();

        expect(seeded.sendMessage).not.toHaveBeenCalled();
      });

      it("sends no nudge when the parent turn is interrupted before a foreground agent terminates", async () => {
        const seeded = seedForegroundNotificationScenario();
        manager = seeded.manager;

        // The parent's turn ends while the child is still running, so the flush
        // finds nothing pending and stops withholding. The agent then terminates
        // with no run active — the window the consumption re-check cannot cover,
        // because markConsumed has not run yet either.
        seeded.notifications.onParentAgentSettled();
        seeded.openGate();
        await seeded.pending;

        expect(seeded.sendMessage).not.toHaveBeenCalled();
      });
    });
  });

  describe("session retention and teardown", () => {
    describe("cleanup timer", () => {
      let manager: SubagentManager;

      afterEach(async () => {
        await manager.dispose();
      });

      it("does not keep the process alive on its own", () => {
        ({ manager } = createManager());

        expect((manager as any).sweepInterval.hasRef()).toBe(false);
      });
    });

    describe("clearCompleted", () => {
      let manager: SubagentManager;

      afterEach(async () => {
        await manager.dispose();
      });

      it("clearCompleted removes completed records", async () => {
        ({ manager } = createManager());

        const id = spawnBg(manager);
        await manager.getRecord(id)!.promise;

        expect(manager.listAgents()).toHaveLength(1);
        await manager.clearCompleted();
        expect(manager.listAgents()).toHaveLength(0);
      });

      it("clearCompleted does not remove running or queued agents", async () => {
        // Use maxConcurrent=1 to keep second agent queued; factory never resolves
        ({ manager } = createManager({ getMaxConcurrent: () => 1, createSubagentSession: createBlockingFactory() }));

        const id1 = spawnBg(manager, "test1", "running agent");
        // Second agent should be queued (limit=1)
        const id2 = spawnBg(manager, "test2", "queued agent");

        expect(manager.getRecord(id1)!.status).toBe("running");
        expect(manager.getRecord(id2)!.status).toBe("queued");

        await manager.clearCompleted();

        // Both should still be present
        expect(manager.getRecord(id1)).toBeDefined();
        expect(manager.getRecord(id2)).toBeDefined();

        // Abort to allow cleanup
        manager.abort(id1);
        manager.abort(id2);
      });

      it("clearCompleted calls dispose on sessions of removed records", async () => {
        const disposeSpy = vi.fn();
        const sess = createMockSession({ dispose: disposeSpy });
        const { factory } = createSessionFactory(sess);
        ({ manager } = createManager({ createSubagentSession: factory }));

        const id = spawnBg(manager);
        await manager.getRecord(id)!.promise;

        await manager.clearCompleted();

        expect(disposeSpy).toHaveBeenCalledOnce();
      });

      it("clearCompleted removes error and stopped records", async () => {
        const { factory, stub } = createSessionFactory();
        stub.runTurnLoop.mockRejectedValue(new Error("boom"));
        ({ manager } = createManager({ createSubagentSession: factory }));

        const id = spawnBg(manager);
        await manager.getRecord(id)!.promise;
        expect(manager.getRecord(id)!.status).toBe("error");

        await manager.clearCompleted();
        expect(manager.getRecord(id)).toBeUndefined();
      });
    });

    describe("teardown awaits each child's shutdown", () => {
      let manager: SubagentManager;

      /** A manager holding one completed agent whose teardown the test controls. */
      async function seedGatedTeardown() {
        const { factory, stub } = createSessionFactory();
        const teardown = Promise.withResolvers<void>(); // eslint-disable-line @typescript-eslint/no-invalid-void-type -- Promise.withResolvers<void> is valid; rule does not allow void in generic fn call type args
        stub.dispose = vi.fn((): Promise<void> => teardown.promise);
        ({ manager } = createManager({ createSubagentSession: factory }));
        const id = spawnBg(manager);
        await manager.getRecord(id)!.promise;
        return { id, teardown, stub };
      }

      it("clearCompleted resolves only after the removed record's teardown settles", async () => {
        const { teardown } = await seedGatedTeardown();

        let settled = false;
        const pending = manager.clearCompleted().then(() => {
          settled = true;
        });
        await Promise.resolve();
        expect(settled).toBe(false);

        teardown.resolve();
        await pending;
        expect(settled).toBe(true);
      });

      it("clearCompleted drops the record before awaiting its teardown", async () => {
        const { id, teardown } = await seedGatedTeardown();

        const pending = manager.clearCompleted();
        expect(manager.getRecord(id)).toBeUndefined();

        teardown.resolve();
        await pending;
      });

      it("dispose resolves only after every record's teardown settles", async () => {
        const { teardown } = await seedGatedTeardown();

        let settled = false;
        const pending = manager.dispose().then(() => {
          settled = true;
        });
        await Promise.resolve();
        expect(settled).toBe(false);

        teardown.resolve();
        await pending;
        expect(settled).toBe(true);
      });

      it("dispose tears down every record even when one teardown rejects", async () => {
        const failing = createSessionFactory();
        failing.stub.dispose = vi.fn((): Promise<void> => Promise.reject(new Error("teardown failed")));
        const healthy = createSessionFactory();
        const factories = [failing.factory, healthy.factory];
        ({ manager } = createManager({
          createSubagentSession: vi.fn(async (params: CreateSubagentSessionParams) =>
            (factories.shift() ?? healthy.factory)(params),
          ),
        }));

        const first = spawnBg(manager, "test1", "first");
        const second = spawnBg(manager, "test2", "second");
        await manager.getRecord(first)!.promise;
        await manager.getRecord(second)!.promise;

        await expect(manager.dispose()).resolves.toBeUndefined();
        expect(failing.stub.dispose).toHaveBeenCalledOnce();
        expect(healthy.stub.dispose).toHaveBeenCalledOnce();
        expect(manager.listAgents()).toHaveLength(0);
      });
    });

    describe("consumption-aware session release sweep", () => {
      let manager: SubagentManager;

      afterEach(async () => {
        vi.restoreAllMocks();
        await manager.dispose();
      });

      /** Spawn a background agent over a session factory and await its completion. */
      async function spawnCompleted(
        outputFile: string | undefined = "/tasks/agent.jsonl",
        getRetentionPolicy?: () => { consumedSessionRetentionMinutes: number; unconsumedSessionRetentionMinutes: number },
      ): Promise<string> {
        const { factory } = createSessionFactory(createMockSession(), outputFile);
        ({ manager } = createManager({ createSubagentSession: factory, getRetentionPolicy }));
        const id = spawnBg(manager, "test", "investigate the bug");
        await manager.getRecord(id)!.promise;
        return id;
      }

      it("releases a consumed agent's session 10 min after consumption but keeps the record", async () => {
        const id = await spawnCompleted("/tasks/agent.jsonl");
        const record = manager.getRecord(id)!;
        const completedAt = record.completedAt!;
        record.markConsumed(completedAt + 5 * 60_000); // consumed 5 min after completion
        const nowSpy = vi.spyOn(Date, "now");

        // 10 min after completion is only 5 min after consumption → still retained.
        nowSpy.mockReturnValue(completedAt + 10 * 60_000);
        (manager as any).sweep();
        expect(manager.getRecord(id)!.isSessionReady()).toBe(true);

        // 10 min after consumption → session released, record survives.
        nowSpy.mockReturnValue(completedAt + 15 * 60_000);
        (manager as any).sweep();
        const swept = manager.getRecord(id)!;
        expect(swept).toBeDefined();
        expect(swept.isSessionReady()).toBe(false);
        expect(swept.outputFile).toBe("/tasks/agent.jsonl");
      });

      it("holds an unconsumed agent's session past 10 min and releases it at the cap", async () => {
        const id = await spawnCompleted("/tasks/agent.jsonl");
        const completedAt = manager.getRecord(id)!.completedAt!;
        const nowSpy = vi.spyOn(Date, "now");

        nowSpy.mockReturnValue(completedAt + 11 * 60_000); // past the consumed window
        (manager as any).sweep();
        expect(manager.getRecord(id)!.isSessionReady()).toBe(true); // unconsumed → held

        nowSpy.mockReturnValue(completedAt + 721 * 60_000); // past the 12h cap
        (manager as any).sweep();
        expect(manager.getRecord(id)!.isSessionReady()).toBe(false);
      });

      it("never releases a running or queued agent's session", async () => {
        ({ manager } = createManager({ getMaxConcurrent: () => 1, createSubagentSession: createBlockingFactory() }));
        const runningId = spawnBg(manager, "t1");
        const queuedId = spawnBg(manager, "t2");
        expect(manager.getRecord(runningId)!.status).toBe("running");
        expect(manager.getRecord(queuedId)!.status).toBe("queued");
        const runRelease = vi.spyOn(manager.getRecord(runningId)!, "releaseSession");
        const queueRelease = vi.spyOn(manager.getRecord(queuedId)!, "releaseSession");

        vi.spyOn(Date, "now").mockReturnValue(Date.now() + 10_000 * 60_000);
        (manager as any).sweep();

        expect(runRelease).not.toHaveBeenCalled();
        expect(queueRelease).not.toHaveBeenCalled();
        manager.abort(runningId);
        manager.abort(queuedId);
      });

      it("honors a custom retention policy from getRetentionPolicy", async () => {
        const id = await spawnCompleted("/t.jsonl", () => ({
          consumedSessionRetentionMinutes: 1,
          unconsumedSessionRetentionMinutes: 2,
        }));
        const record = manager.getRecord(id)!;
        const completedAt = record.completedAt!;
        record.markConsumed(completedAt);
        vi.spyOn(Date, "now").mockReturnValue(completedAt + 2 * 60_000); // 2 min > 1 min window
        (manager as any).sweep();
        expect(manager.getRecord(id)!.isSessionReady()).toBe(false);
      });

      it("leaves records in place after release (getRecord still resolves them)", async () => {
        const id = await spawnCompleted("/tasks/agent.jsonl");
        const completedAt = manager.getRecord(id)!.completedAt!;
        vi.spyOn(Date, "now").mockReturnValue(completedAt + 721 * 60_000);
        (manager as any).sweep();
        expect(manager.listAgents()).toHaveLength(1);
        expect(manager.getRecord(id)).toBeDefined();
      });
    });

    describe("subagent session state", () => {
      let manager: SubagentManager;

      afterEach(async () => {
        await manager.dispose();
      });

      it("sets record.subagentSession with session and outputFile after session creation", async () => {
        const session = createMockSession();
        const { factory } = createSessionFactory(session, "/tmp/session.jsonl");
        ({ manager } = createManager({ createSubagentSession: factory }));

        const id = spawnBg(manager);
        await manager.getRecord(id)!.promise;

        const record = manager.getRecord(id)!;
        expect(record.subagentSession).toBeDefined();
        expect(record.subagentSession!.session).toBe(session);
        expect(record.subagentSession!.outputFile).toBe("/tmp/session.jsonl");
      });

      it("record.subagentSession is undefined before the session is created", () => {
        ({ manager } = createManager({ createSubagentSession: createBlockingFactory() }));

        const id = spawnBg(manager);
        const record = manager.getRecord(id)!;
        expect(record.subagentSession).toBeUndefined();
        manager.abort(id);
      });
    });
  });

  describe("record initialization", () => {
    // Eager init removes the optional/required asymmetry that previously required
    // `??=` defaults at the callback sites and `?? 0` / `?? 1` at the read sites.
    describe("lifetime usage and compaction count are eagerly initialized", () => {
      let manager: SubagentManager;

      afterEach(async () => {
        await manager.dispose();
      });

      it("spawn initializes lifetimeUsage to zeros and compactionCount to 0", () => {
        // Factory never resolves — we just want to inspect the record at spawn time.
        ({ manager } = createManager({ createSubagentSession: createBlockingFactory() }));

        const id = spawnBg(manager);
        const record = manager.getRecord(id)!;

        expect(record.lifetimeUsage).toEqual({ input: 0, output: 0, cacheWrite: 0 });
        expect(record.compactionCount).toBe(0);

        manager.abort(id);
      });

      it("record observer accumulates assistant usage into record.lifetimeUsage", async () => {
        // The record observer subscribes to session events via the wired subagentSession.
        // Emitting message_end events from runTurnLoop drives stats.
        const session = createMockSession();
        const { factory, stub } = createSessionFactory(session);
        stub.runTurnLoop.mockImplementation(async () => {
          session.emit({ type: "message_end", message: { role: "assistant", usage: { input: 100, output: 50, cacheWrite: 10 } } });
          session.emit({ type: "message_end", message: { role: "assistant", usage: { input: 200, output: 80, cacheWrite: 20 } } });
          return { responseText: "done", aborted: false, steered: false };
        });
        ({ manager } = createManager({ createSubagentSession: factory }));

        const id = spawnBg(manager);
        await manager.getRecord(id)!.promise;

        expect(manager.getRecord(id)!.lifetimeUsage).toEqual({
          input: 300, output: 130, cacheWrite: 30,
        });
      });

      it("record observer increments compactionCount on compaction_end events", async () => {
        const compactSeen: any[] = [];

        const session = createMockSession();
        const { factory, stub } = createSessionFactory(session);
        stub.runTurnLoop.mockImplementation(async () => {
          // Compaction fires while the agent is still running — the record passed to
          // onCompact should reflect the just-incremented count.
          session.emit({ type: "compaction_end", aborted: false, result: { tokensBefore: 12345 }, reason: "threshold" });
          session.emit({ type: "compaction_end", aborted: false, result: { tokensBefore: 22222 }, reason: "manual" });
          return { responseText: "done", aborted: false, steered: false };
        });

        ({ manager } = createManager({ createSubagentSession: factory, observer: { onSubagentCompacted: (record, info) => {
          compactSeen.push({ count: record.compactionCount, reason: info.reason });
        } } }));

        const id = spawnBg(manager);
        await manager.getRecord(id)!.promise;

        expect(compactSeen).toEqual([
          { count: 1, reason: "threshold" },
          { count: 2, reason: "manual" },
        ]);
        expect(manager.getRecord(id)!.compactionCount).toBe(2);
      });

      it("resume() also accumulates usage and increments compactions on the same record", async () => {
        // Spawn with a subscribable session that resume can latch onto.
        const session = createMockSession();
        const { factory, stub } = createSessionFactory(session);
        stub.resumeTurnLoop.mockImplementation(async () => {
          // Emit events through the session — the record observer subscribed by
          // SubagentManager.resume() will pick them up.
          emitResumeUsageAndCompaction(session);
          return "second";
        });
        ({ manager } = createManager({ createSubagentSession: factory }));

        const id = spawnBg(manager);
        await manager.getRecord(id)!.promise;

        // Pre-resume: lifetimeUsage from spawn was zero (run did not emit usage events)
        expect(manager.getRecord(id)!.lifetimeUsage).toEqual({ input: 0, output: 0, cacheWrite: 0 });
        expect(manager.getRecord(id)!.compactionCount).toBe(0);

        await manager.resume(id, "more");

        expect(manager.getRecord(id)!.lifetimeUsage).toEqual({ input: 70, output: 30, cacheWrite: 5 });
        expect(manager.getRecord(id)!.compactionCount).toBe(1);
      });
    });

    describe("getRunConfig threads defaultMaxTurns and graceTurns into the turn loop", () => {
      let manager: SubagentManager;

      afterEach(async () => {
        await manager.dispose();
      });

      it("passes defaultMaxTurns and graceTurns from getRunConfig to runTurnLoop", async () => {
        const getRunConfig = vi.fn(() => ({ defaultMaxTurns: 10, graceTurns: 3, midRunUpdates: true }));
        const { factory, stub } = createSessionFactory();
        ({ manager } = createManager({ getRunConfig, createSubagentSession: factory }));

        const id = spawnBg(manager);
        await manager.getRecord(id)!.promise;

        const turnOpts = stub.runTurnLoop.mock.calls[0][1];
        expect(turnOpts.defaultMaxTurns).toBe(10);
        expect(turnOpts.graceTurns).toBe(3);
      });

      it("omits defaultMaxTurns and graceTurns from runTurnLoop when no getRunConfig is provided", async () => {
        const { factory, stub } = createSessionFactory();
        ({ manager } = createManager({ createSubagentSession: factory }));

        const id = spawnBg(manager);
        await manager.getRecord(id)!.promise;

        const turnOpts = stub.runTurnLoop.mock.calls[0][1];
        expect(turnOpts.defaultMaxTurns).toBeUndefined();
        expect(turnOpts.graceTurns).toBeUndefined();
      });
    });

    describe("parent session threading", () => {
      let manager: SubagentManager;

      afterEach(async () => {
        await manager.dispose();
      });

      it("threads parentSession from AgentSpawnConfig to the factory params", async () => {
        const { factory } = createSessionFactory();
        ({ manager } = createManager({ createSubagentSession: factory }));

        manager.spawn(STUB_SNAPSHOT, "general-purpose", "test", {
          description: "test",
          background: { kind: "explicit", isBackground: true },
          parentSession: { parentSessionFile: "/sessions/parent.jsonl", parentSessionId: "parent-session-123" },
        });

        await vi.waitFor(() => expect(factory).toHaveBeenCalled());

        const params = vi.mocked(factory).mock.calls[0][0];
        expect(params.parentSession?.parentSessionFile).toBe("/sessions/parent.jsonl");
        expect(params.parentSession?.parentSessionId).toBe("parent-session-123");
      });
    });
  });

  describe("dependency injection via options bag", () => {
    let manager: SubagentManager;

    afterEach(async () => {
      await manager.dispose();
    });

    it("calls the injected factory when spawning an agent", async () => {
      const { factory } = createSessionFactory();
      ({ manager } = createManager({ createSubagentSession: factory }));

      const id = spawnBg(manager);
      await manager.getRecord(id)!.promise;

      expect(factory).toHaveBeenCalledOnce();
      expect(manager.getRecord(id)!.result).toBe("done");
    });

    it("calls resumeTurnLoop on the SubagentSession when resuming an agent", async () => {
      const { factory, stub } = createSessionFactory();
      stub.resumeTurnLoop.mockResolvedValue("second");
      ({ manager } = createManager({ createSubagentSession: factory }));

      const id = spawnBg(manager);
      await manager.getRecord(id)!.promise;

      await manager.resume(id, "continue");

      expect(stub.resumeTurnLoop).toHaveBeenCalledOnce();
      expect(manager.getRecord(id)!.result).toBe("second");
    });

    it("fires onSubagentResumed when a background agent is resumed", async () => {
      const onSubagentResumed = vi.fn();
      const { factory, stub } = createSessionFactory();
      stub.resumeTurnLoop.mockResolvedValue("second");
      ({ manager } = createManager({ createSubagentSession: factory, observer: { onSubagentResumed } }));

      const id = spawnBg(manager);
      await manager.getRecord(id)!.promise;
      await manager.resume(id, "continue");

      expect(onSubagentResumed).toHaveBeenCalledExactlyOnceWith(manager.getRecord(id));
    });

    it("fires onSubagentResumed when a foreground agent is resumed", async () => {
      const onSubagentResumed = vi.fn();
      const { factory, stub } = createSessionFactory();
      stub.resumeTurnLoop.mockResolvedValue("second");
      ({ manager } = createManager({ createSubagentSession: factory, observer: { onSubagentResumed } }));

      const record = await spawnFg(manager);
      await manager.resume(record.id, "continue");

      // A resumed foreground run is a terminal transition like any other; whether
      // the parent is told is the notification layer's call, not this seam's.
      expect(onSubagentResumed).toHaveBeenCalledExactlyOnceWith(record);
    });

  });

  describe("registerWorkspaceProvider", () => {
    let manager: SubagentManager;

    afterEach(async () => {
      await manager.dispose();
    });

    function makeProvider(): WorkspaceProvider {
      return {
        id: "test-workspace",
        prepare: vi.fn(async () => undefined),
        restore: vi.fn(async () => {
          throw new Error("workspace unavailable");
        }),
      };
    }

    it("returns a disposer and exposes the registered provider via getter", () => {
      ({ manager } = createManager());
      const provider = makeProvider();

      const dispose = manager.registerWorkspaceProvider(provider);

      expect(typeof dispose).toBe("function");
      expect(manager.workspaceProvider).toBe(provider);
    });

    it("throws when a provider is already registered", () => {
      ({ manager } = createManager());
      manager.registerWorkspaceProvider(makeProvider());

      expect(() => manager.registerWorkspaceProvider(makeProvider())).toThrow(
        /already registered/i,
      );
    });

    it("disposer clears the slot, allowing re-registration", () => {
      ({ manager } = createManager());
      const first = makeProvider();
      const dispose = manager.registerWorkspaceProvider(first);

      dispose();

      expect(manager.workspaceProvider).toBeUndefined();
      const second = makeProvider();
      manager.registerWorkspaceProvider(second);
      expect(manager.workspaceProvider).toBe(second);
    });

    it("does not repeat a terminal workspace checkpoint notice when the session is released", async () => {
      const onSubagentWorkspaceNotice = vi.fn<(record: Subagent, notice: string) => void>();
      const notice = "\n\n---\nChanges saved to branch `pi-agent-1`.";
      const stub = createSubagentSessionStub();
      let askParent: ((question: string) => void) | undefined;
      stub.runTurnLoop.mockImplementation(() => {
        askParent?.("Which config?");
        return Promise.resolve({ responseText: "Mapped them.", aborted: false, steered: false });
      });
      ({ manager } = createManager({
        createSubagentSession: vi.fn(async (params: CreateSubagentSessionParams) => {
          askParent = params.askParent;
          return toSubagentSession(stub);
        }),
        observer: { onSubagentWorkspaceNotice },
      }));
      manager.registerWorkspaceProvider({
        id: "test-workspace",
        prepare: vi.fn(async () => ({
          cwd: "/ws/dir",
          snapshot: vi.fn(() => ({ cwd: "/ws/dir" })),
          suspend: vi.fn(() => ({
            state: { cwd: "/ws/dir" },
            resultAddendum: notice,
          })),
          dispose: vi.fn(() => ({ resultAddendum: notice })),
        })),
        restore: vi.fn(async () => {
          throw new Error("workspace unavailable");
        }),
      });

      const id = manager.spawn(STUB_SNAPSHOT, "general-purpose", "test", {
        description: "held agent",
        background: { kind: "explicit", isBackground: true },
      });
      const record = manager.getRecord(id)!;
      await record.promise;
      await record.releaseSession();

      expect(record.result).toContain(notice);
      expect(onSubagentWorkspaceNotice).not.toHaveBeenCalled();
    });

    it("stale disposer does not evict a later provider", () => {
      ({ manager } = createManager());
      const first = makeProvider();
      const disposeFirst = manager.registerWorkspaceProvider(first);
      disposeFirst();
      const second = makeProvider();
      manager.registerWorkspaceProvider(second);

      // Calling the first disposer again must not clear the second provider.
      disposeFirst();

      expect(manager.workspaceProvider).toBe(second);
    });
  });

  describe("resume", () => {
    let manager: SubagentManager;

    afterEach(async () => {
      await manager.dispose();
    });

    describe("refused", () => {
      it("reports an id no record answers to", async () => {
        ({ manager } = createManager());

        expect(await manager.resume("nope", "continue")).toEqual({
          kind: "refused",
          reason: "unknown-agent",
        });
      });

      it("reports a run that has not settled", async () => {
        ({ manager } = createManager({ createSubagentSession: createBlockingFactory() }));
        const id = spawnBg(manager);

        await vi.waitFor(() => expect(manager.getRecord(id)!.status).toBe("running"));

        expect(await manager.resume(id, "continue")).toEqual({
          kind: "refused",
          reason: "still-running",
        });
      });

      it("reports a session released by the retention sweep", async () => {
        const { factory } = createSessionFactory();
        ({ manager } = createManager({ createSubagentSession: factory }));
        const id = spawnBg(manager);
        await manager.getRecord(id)!.promise;
        await manager.getRecord(id)!.releaseSession();

        expect(await manager.resume(id, "continue")).toEqual({
          kind: "refused",
          reason: "session-released",
        });
      });

      it("restores a suspended workspace before resuming the child", async () => {
        const { factory } = createSessionFactory();
        ({ manager } = createManager({ createSubagentSession: factory }));
        const provider = makeWorkspaceProvider(makeWorkspace("/ws/dir"));
        manager.registerWorkspaceProvider(provider);
        const id = spawnBg(manager);
        await manager.getRecord(id)!.promise;

        expect(await manager.resume(id, "continue")).toMatchObject({
          kind: "resumed",
        });
        expect(provider.restore).toHaveBeenCalledWith(
          expect.objectContaining({ agentId: id }),
          { cwd: "/ws/dir" },
        );
      });

      it("starts no turn loop for a refused resume", async () => {
        const { factory, stub } = createSessionFactory();
        ({ manager } = createManager({ createSubagentSession: factory }));
        const id = spawnBg(manager);
        await manager.getRecord(id)!.promise;
        await manager.getRecord(id)!.releaseSession();

        await manager.resume(id, "continue");

        expect(stub.resumeTurnLoop).not.toHaveBeenCalled();
      });
    });

    describe("accepted", () => {
      it("returns the resumed record", async () => {
        const { factory, stub } = createSessionFactory();
        stub.resumeTurnLoop.mockResolvedValue("second");
        ({ manager } = createManager({ createSubagentSession: factory }));
        const id = spawnBg(manager);
        await manager.getRecord(id)!.promise;

        expect(await manager.resume(id, "continue")).toEqual({
          kind: "resumed",
          record: manager.getRecord(id),
        });
      });

      it("reports a resumed run that failed as resumed, carrying the error", async () => {
        const { factory, stub } = createSessionFactory();
        stub.resumeTurnLoop.mockRejectedValue(new Error("resume exploded"));
        ({ manager } = createManager({ createSubagentSession: factory }));
        const id = spawnBg(manager);
        await manager.getRecord(id)!.promise;

        const outcome = await manager.resume(id, "continue");

        expect(outcome.kind).toBe("resumed");
        expect(manager.getRecord(id)!.status).toBe("error");
      });

      it("leaves the outcome unclaimed by default", async () => {
        const { factory, stub } = createSessionFactory();
        stub.resumeTurnLoop.mockResolvedValue("second");
        ({ manager } = createManager({ createSubagentSession: factory }));
        const id = spawnBg(manager);
        await manager.getRecord(id)!.promise;

        await manager.resume(id, "continue");

        expect(manager.getRecord(id)!.claimed).toBe(false);
      });

      it("claims the outcome before the turn loop starts when the caller asks", async () => {
        const { factory, stub } = createSessionFactory();
        ({ manager } = createManager({ createSubagentSession: factory }));
        const id = spawnBg(manager);
        await manager.getRecord(id)!.promise;
        const record = manager.getRecord(id)!;
        // resetForResume runs synchronously inside Subagent.resume(), so a claim
        // taken after the await would miss the terminal edge entirely.
        const { promise, resolve } = Promise.withResolvers<string>();
        stub.resumeTurnLoop.mockReturnValue(promise);

        const resumed = manager.resume(id, "continue", { claimOutcome: true });
        await vi.waitFor(() => expect(stub.resumeTurnLoop).toHaveBeenCalled());

        expect(record.claimed).toBe(true);
        resolve("second");
        await resumed;
      });

      it("tells the observer a resume started, before it reports one finished", async () => {
        const calls: string[] = [];
        const { factory, stub } = createSessionFactory();
        stub.resumeTurnLoop.mockResolvedValue("second");
        ({ manager } = createManager({
          createSubagentSession: factory,
          observer: {
            onSubagentResuming: () => calls.push("resuming"),
            onSubagentResumed: () => calls.push("resumed"),
          },
        }));
        const id = spawnBg(manager);
        await manager.getRecord(id)!.promise;

        await manager.resume(id, "continue");

        expect(calls).toEqual(["resuming", "resumed"]);
      });

      it("forwards the caller's signal to the resumed turn loop", async () => {
        const { factory, stub } = createSessionFactory();
        stub.resumeTurnLoop.mockResolvedValue("second");
        ({ manager } = createManager({ createSubagentSession: factory }));
        const id = spawnBg(manager);
        await manager.getRecord(id)!.promise;
        const signal = new AbortController().signal;

        await manager.resume(id, "continue", { signal });

        expect(stub.resumeTurnLoop).toHaveBeenCalledWith("continue", signal);
      });
    });
  });
});

describe("resolveRetentionWindow", () => {
  const policy = {
    consumedSessionRetentionMinutes: 10,
    unconsumedSessionRetentionMinutes: 720,
  };

  describe("an outcome the parent never collected", () => {
    it("holds for the long window, measured from completion", () => {
      expect(
        resolveRetentionWindow(
          { consumed: false, completedAt: 5_000, consumedAt: undefined, pendingQuestion: undefined },
          policy,
        ),
      ).toEqual({ referenceAt: 5_000, windowMinutes: 720 });
    });

    it("measures from zero when the record has no completion time", () => {
      expect(
        resolveRetentionWindow(
          { consumed: false, completedAt: undefined, consumedAt: undefined, pendingQuestion: undefined },
          policy,
        ),
      ).toEqual({ referenceAt: 0, windowMinutes: 720 });
    });
  });

  describe("an outcome the parent collected", () => {
    it("holds for the short window, measured from collection", () => {
      expect(
        resolveRetentionWindow(
          { consumed: true, completedAt: 5_000, consumedAt: 9_000, pendingQuestion: undefined },
          policy,
        ),
      ).toEqual({ referenceAt: 9_000, windowMinutes: 10 });
    });

    it("measures from completion when that is the later of the two", () => {
      expect(
        resolveRetentionWindow(
          { consumed: true, completedAt: 9_000, consumedAt: 5_000, pendingQuestion: undefined },
          policy,
        ),
      ).toEqual({ referenceAt: 9_000, windowMinutes: 10 });
    });
  });

  describe("a collected outcome that still carries an unanswered question", () => {
    it("holds for the long window, because the parent has not finished with it", () => {
      expect(
        resolveRetentionWindow(
          { consumed: true, completedAt: 5_000, consumedAt: 9_000, pendingQuestion: "Which config wins?" },
          policy,
        ),
      ).toEqual({ referenceAt: 5_000, windowMinutes: 720 });
    });

    it("measures from completion rather than collection, as an uncollected outcome does", () => {
      expect(
        resolveRetentionWindow(
          { consumed: true, completedAt: 9_000, consumedAt: 5_000, pendingQuestion: "Which config wins?" },
          policy,
        ),
      ).toEqual({ referenceAt: 9_000, windowMinutes: 720 });
    });
  });
});
