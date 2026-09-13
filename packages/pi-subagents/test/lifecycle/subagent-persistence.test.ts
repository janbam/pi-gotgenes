import { describe, expect, it, vi } from "vitest";
import {
  loadSubagentRegistry,
  type PersistedSubagentRecord,
  SUBAGENT_REGISTRY_KEY,
  type SubagentRegistrySession,
  saveSubagentRegistry,
} from "#src/lifecycle/subagent-persistence";

/** Build one complete persisted record, with only the named fields overridden. */
function record(
  overrides: Partial<PersistedSubagentRecord> = {},
): PersistedSubagentRecord {
  return {
    id: "agent-1",
    type: "Explore",
    description: "inspect persistence",
    isBackground: true,
    parentEntryId: "entry-1",
    state: {
      status: "completed",
      result: "done",
      startedAt: 100,
      completedAt: 200,
      toolUses: 2,
      lifetimeUsage: { input: 10, output: 20, cacheWrite: 3 },
      compactionCount: 1,
      turnCount: 4,
      responseText: "done",
    },
    session: {
      outputFile: "/sessions/tasks/child.jsonl",
      sessionId: "child-session",
      sessionDir: "/sessions/tasks",
      effectiveCwd: "/repo",
      systemPrompt: "Explore carefully.",
      toolNames: ["read", "grep"],
      model: { provider: "anthropic", id: "claude-sonnet" },
      thinkingLevel: "high",
      agentMaxTurns: 12,
      parentContext: "Earlier parent context\n\n",
    },
    workspace: {
      providerId: "git-worktree",
      state: { repoCwd: "/repo", revision: "abc123" },
    },
    ...overrides,
  };
}

/** Build a session-state boundary over the supplied stored value and active branch IDs. */
function session(
  stored: unknown,
  branchIds: string[] = ["entry-1"],
 ) {
  const setSessionState = vi.fn<SubagentRegistrySession["setSessionState"]>();
  return {
    getSessionState: <T>() => stored as T | undefined,
    setSessionState,
    getBranch: vi.fn(() => branchIds.map((id) => ({ id }))),
  };
}

describe("loadSubagentRegistry", () => {
  it("returns an empty compatible registry when the session has no state", () => {
    expect(loadSubagentRegistry(session(undefined))).toEqual({
      kind: "ready",
      records: [],
    });
  });

  it("loads records anchored on the active parent ancestry", () => {
    const ancestor = record({ id: "ancestor", parentEntryId: "entry-1" });
    const current = record({ id: "current", parentEntryId: "entry-3" });
    const sibling = record({ id: "sibling", parentEntryId: "sibling-entry" });

    const result = loadSubagentRegistry(
      session({ version: 1, records: [ancestor, current, sibling] }, [
        "entry-1",
        "entry-2",
        "entry-3",
      ]),
    );

    expect(result).toEqual({ kind: "ready", records: [ancestor, current] });
  });

  it("keeps root-anchored records visible on every branch", () => {
    const root = record({ parentEntryId: null });

    expect(
      loadSubagentRegistry(session({ version: 1, records: [root] }, [])),
    ).toEqual({ kind: "ready", records: [root] });
  });

  it("hides every branch-anchored record from an unrelated empty lineage", () => {
    const stored = { version: 1, records: [record()] };

    expect(loadSubagentRegistry(session(stored, []))).toEqual({
      kind: "ready",
      records: [],
    });
  });

  it("reports a stable incompatibility for an unsupported registry version", () => {
    expect(
      loadSubagentRegistry(session({ version: 2, records: [record()] })),
    ).toEqual({
      kind: "incompatible",
      reason: "unsupported registry version 2",
    });
  });

  it("fails closed when a persisted record is malformed", () => {
    expect(
      loadSubagentRegistry(
        session({ version: 1, records: [{ ...record(), id: 42 }] }),
      ),
    ).toEqual({
      kind: "incompatible",
      reason: "registry record 0 is malformed",
    });
  });
});

describe("saveSubagentRegistry", () => {
  it("writes one versioned custom JSON object under the extension key", () => {
    const target = session(undefined);
    const records = [record()];

    saveSubagentRegistry(target, records);

    expect(target.setSessionState).toHaveBeenCalledWith(
      SUBAGENT_REGISTRY_KEY,
      { version: 1, records },
    );
  });
});
