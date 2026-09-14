import { existsSync, mkdirSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { AssistantMessage } from "@earendil-works/pi-ai";
import {
  type AgentSession,
  SessionManager,
} from "@earendil-works/pi-coding-agent";
import { afterEach, describe, expect, it } from "vitest";
import { AgentTypeRegistry } from "#src/config/agent-types";
import { ConcurrencyLimiter } from "#src/lifecycle/concurrency-limiter";
import {
  type CreateSessionOptions,
  type RestoreSubagentSessionParams,
  restoreSubagentSession,
} from "#src/lifecycle/create-subagent-session";
import { SubagentManager } from "#src/lifecycle/subagent-manager";
import type { PersistedSubagentSession } from "#src/lifecycle/subagent-persistence";
import { SubagentSession } from "#src/lifecycle/subagent-session";
import type { SessionContext } from "#src/types";
import {
  createChildLifecycleMock,
  createFactorySession,
  createSubagentSessionDeps,
  createSubagentSessionIO,
} from "#test/helpers/subagent-session-io";

/** Build one valid assistant message for the persisted integration transcript. */
function assistantMessage(
  content: AssistantMessage["content"],
  stopReason: AssistantMessage["stopReason"],
): AssistantMessage {
  return {
    role: "assistant",
    content,
    api: "anthropic-messages",
    provider: "anthropic",
    model: "test-model",
    usage: {
      input: 1,
      output: 1,
      cacheRead: 0,
      cacheWrite: 0,
      totalTokens: 2,
      cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
    },
    stopReason,
    timestamp: Date.now(),
  };
}

/** Append one valid exchange so the SDK flushes a real JSONL transcript. */
function appendExchange(
  manager: SessionManager,
  prompt: string,
  response: string,
  toolResult?: string,
): void {
  manager.appendMessage({ role: "user", content: prompt, timestamp: Date.now() });
  if (toolResult) {
    manager.appendMessage(assistantMessage(
      [{ type: "toolCall", id: "call-1", name: "read", arguments: { path: "notes.md" } }],
      "toolUse",
    ));
    manager.appendMessage({
      role: "toolResult",
      toolCallId: "call-1",
      toolName: "read",
      content: [{ type: "text", text: toolResult }],
      details: {},
      isError: false,
      timestamp: Date.now(),
    });
  }
  manager.appendMessage(assistantMessage(
    [{ type: "text", text: response }],
    "stop",
  ));
}

/** Build the narrow parent context over an actual persisted Pi session manager. */
function parentContext(
  cwd: string,
  manager: SessionManager,
): SessionContext {
  return {
    cwd,
    model: undefined,
    modelRegistry: { find: () => undefined, getAll: () => [] },
    getSystemPrompt: () => "parent prompt",
    sessionManager: manager,
  };
}

/** Wrap a real child manager with a deterministic AgentSession turn boundary. */
function childSession(
  manager: SessionManager,
  response: string,
  toolResult?: string,
): AgentSession {
  const session = createFactorySession();
  session.sessionManager.getSessionFile.mockReturnValue(manager.getSessionFile());
  session.prompt.mockImplementation(async (prompt: string) => {
    appendExchange(manager, prompt, response, toolResult);
    session.messages.splice(0, session.messages.length, {
      role: "assistant",
      content: [{ type: "text", text: response }],
    });
  });
  return session as unknown as AgentSession;
}

/** Create the manager composition needed on each side of the process boundary. */
function createManager(
  createSession: () => Promise<SubagentSession>,
  restoreSession:
    | ((params: RestoreSubagentSessionParams) => Promise<SubagentSession>)
    | undefined,
  parent: SessionManager,
  cwd: string,
): SubagentManager {
  return new SubagentManager({
    createSubagentSession: createSession,
    restoreSubagentSession: restoreSession,
    limiter: new ConcurrencyLimiter(() => 1),
    baseCwd: cwd,
    registry: new AgentTypeRegistry(() => new Map()),
    writeSessionState: (key, value) => parent.setSessionState(key, value),
  });
}

describe("durable resume across a process boundary", () => {
  let root: string | undefined;
  const managers: SubagentManager[] = [];

  afterEach(async () => {
    await Promise.allSettled(managers.map((manager) => manager.dispose()));
    managers.length = 0;
    if (root) rmSync(root, { recursive: true, force: true });
    root = undefined;
  });

  it("reopens real parent and child JSONL files and resumes the same ID", async () => {
    root = mkdtempSync(join(tmpdir(), "pi-subagents-durable-"));
    const cwd = join(root, "project");
    const parentDir = join(root, "parent-sessions");
    const childDir = join(root, "child-sessions");
    mkdirSync(cwd);

    // Persist a parent branch and a child transcript through Pi's real session
    // machinery; the first manager then records its durable handle in that parent.
    const parent = SessionManager.create(cwd, parentDir);
    appendExchange(parent, "delegate this", "delegating");
    const parentEntryId = parent.getLeafId();
    const child = SessionManager.create(cwd, childDir);
    child.newSession({ parentSession: parent.getSessionId() });
    const childFile = child.getSessionFile()!;
    const spec: PersistedSubagentSession = {
      outputFile: childFile,
      sessionId: child.getSessionId(),
      sessionDir: childDir,
      effectiveCwd: cwd,
      systemPrompt: "child prompt",
      toolNames: ["read"],
    };
    const firstChild = new SubagentSession(childSession(child, "initial response", "persisted tool output"), {
      outputFile: childFile,
      sessionId: child.getSessionId(),
      sessionDir: childDir,
      agentName: "Explore",
      agentMaxTurns: undefined,
      parentContext: undefined,
      resumeSpec: spec,
      lifecycle: createChildLifecycleMock(),
    });
    const first = createManager(
      async () => firstChild,
      undefined,
      parent,
      cwd,
    );
    managers.push(first);
    first.activate(parentContext(cwd, parent));
    const id = first.spawn(
      {
        cwd,
        systemPrompt: "parent prompt",
        model: undefined,
        modelRegistry: { find: () => undefined, getAll: () => [] },
      },
      "Explore",
      "initial child prompt",
      {
        description: "durable integration child",
        background: { kind: "explicit", isBackground: true },
        parentSession: {
          parentSessionFile: parent.getSessionFile(),
          parentSessionId: parent.getSessionId(),
          parentEntryId,
        },
      },
    );
    await first.getRecord(id)!.promise;
    await first.deactivate();

    // Reopen both files as a fresh process would. The production restoration
    // factory must hand SessionManager.open() the same persisted child identity.
    const reopenedParent = SessionManager.open(parent.getSessionFile()!);
    const io = createSubagentSessionIO();
    let openedHistory = "";
    io.fileExists.mockImplementation(existsSync);
    io.openSessionManager.mockImplementation((file, sessionDir, effectiveCwd) =>
      SessionManager.open(file, sessionDir, effectiveCwd),
    );
    io.createSession.mockImplementation(async (options: CreateSessionOptions) => {
      const reopenedChild = options.sessionManager as SessionManager;
      openedHistory = JSON.stringify(reopenedChild.buildSessionContext().messages);
      return { session: childSession(reopenedChild, "continued response") };
    });
    const deps = createSubagentSessionDeps({ io });
    const second = createManager(
      async () => { throw new Error("fresh creation is not part of resume"); },
      (params) => restoreSubagentSession(params, deps),
      reopenedParent,
      cwd,
    );
    managers.push(second);
    second.activate(parentContext(cwd, reopenedParent));

    const outcome = await second.resume(id, "continue after reopen");

    expect(outcome).toMatchObject({ kind: "resumed", record: { id } });
    expect(openedHistory).toContain("initial child prompt");
    expect(openedHistory).toContain("initial response");
    expect(openedHistory).toContain("persisted tool output");
    expect(io.openSessionManager).toHaveBeenCalledWith(childFile, childDir, cwd);
    const finalHistory = JSON.stringify(
      SessionManager.open(childFile).buildSessionContext().messages,
    );
    expect(finalHistory).toContain("continue after reopen");
    expect(finalHistory).toContain("continued response");
    expect(reopenedParent.getSessionState("@gotgenes/pi-subagents"))
      .toBeDefined();
  });
});
