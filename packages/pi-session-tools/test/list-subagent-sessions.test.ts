import { basename } from "node:path";
import { describe, expect, it, vi } from "vitest";
import sessionTools from "#src/index";
import { captureTools } from "#test/helpers/capture-tools";

const mockExistsSync = vi.hoisted(() =>
  vi.fn((_path: string): boolean => false),
);
const mockReaddirSync = vi.hoisted(() =>
  vi.fn((_path: string): string[] => []),
);
const mockStatSync = vi.hoisted(() =>
  vi.fn((_path: string): { mtimeMs: number } => ({ mtimeMs: 0 })),
);
vi.mock("node:fs", () => ({
  existsSync: mockExistsSync,
  readdirSync: mockReaddirSync,
  statSync: mockStatSync,
  default: {
    existsSync: mockExistsSync,
    readdirSync: mockReaddirSync,
    statSync: mockStatSync,
  },
}));

const SESSION_FILE =
  "/sessions/--project--/2026-09-06T04-26-34-471Z_01a074f7.jsonl";
const TASKS_DIR =
  "/sessions/--project--/2026-09-06T04-26-34-471Z_01a074f7/tasks";

/**
 * Mock a session whose subagent directory holds `count` `.jsonl` files with
 * ascending mtimes, and return their basenames newest-first — the order the
 * tool is expected to emit.
 */
function mockSubagentSessions(count: number): string[] {
  const names = Array.from(
    { length: count },
    (_, i) => `t-${String(i + 1).padStart(2, "0")}.jsonl`,
  );
  const mtimes = new Map(names.map((name, i) => [name, (i + 1) * 1000]));
  mockExistsSync.mockReturnValue(true);
  mockReaddirSync.mockReturnValue(names);
  mockStatSync.mockImplementation((path: string) => ({
    mtimeMs: mtimes.get(basename(path)) ?? 0,
  }));
  return [...names].reverse();
}

async function listWith(params: {
  path: string;
  limit?: number;
}): Promise<string> {
  const tools = captureTools(sessionTools);
  const tool = tools.get("list_subagent_sessions")!;
  const result = await tool.execute("tc1", params, undefined, undefined);
  return (result as { content: { text: string }[] }).content[0].text;
}

describe("list_subagent_sessions tool", () => {
  it("lists a session's subagent transcripts, newest first", async () => {
    const newestFirst = mockSubagentSessions(2);

    const text = await listWith({ path: SESSION_FILE });

    expect(text).toBe(
      [
        `Session directory: ${TASKS_DIR}`,
        "2 session files, newest first:",
        `  ${TASKS_DIR}/${newestFirst[0]}`,
        `  ${TASKS_DIR}/${newestFirst[1]}`,
      ].join("\n"),
    );
  });

  it("reports no session files for a session that spawned no subagents", async () => {
    mockExistsSync.mockImplementation((path: string) => path === SESSION_FILE);

    const text = await listWith({ path: SESSION_FILE });

    expect(text).toBe(
      `Session directory: ${TASKS_DIR}\nNo session files found.`,
    );
  });

  it("reports a missing session file without reading a directory", async () => {
    mockExistsSync.mockReturnValue(false);
    mockReaddirSync.mockClear();

    const text = await listWith({ path: "/sessions/--project--/typo.jsonl" });

    expect(text).toBe(
      "Session file not found: /sessions/--project--/typo.jsonl",
    );
    expect(mockReaddirSync).not.toHaveBeenCalled();
  });

  it("needs no session state, so it runs without an ExtensionContext", async () => {
    mockSubagentSessions(1);
    const tools = captureTools(sessionTools);
    const tool = tools.get("list_subagent_sessions")!;

    const result = (await tool.execute("tc1", { path: SESSION_FILE })) as {
      details: { kind: string; count: number };
    };

    expect(result.details).toEqual({
      kind: "listing",
      directory: TASKS_DIR,
      count: 1,
      shown: 1,
    });
  });

  describe("limit", () => {
    it("lists only the newest ten when the caller passes no limit", async () => {
      const newestFirst = mockSubagentSessions(12);

      const text = await listWith({ path: SESSION_FILE });

      expect(text).toBe(
        [
          `Session directory: ${TASKS_DIR}`,
          "12 session files, newest first (showing 10):",
          ...newestFirst.slice(0, 10).map((n) => `  ${TASKS_DIR}/${n}`),
        ].join("\n"),
      );
    });

    it("honours an explicit limit below the default", async () => {
      const newestFirst = mockSubagentSessions(12);

      const text = await listWith({ path: SESSION_FILE, limit: 3 });

      expect(text).toBe(
        [
          `Session directory: ${TASKS_DIR}`,
          "12 session files, newest first (showing 3):",
          ...newestFirst.slice(0, 3).map((n) => `  ${TASKS_DIR}/${n}`),
        ].join("\n"),
      );
    });
  });

  describe("details", () => {
    it("reports the bounded count in shown and the true total in count", async () => {
      mockSubagentSessions(12);
      const tools = captureTools(sessionTools);
      const tool = tools.get("list_subagent_sessions")!;

      const result = (await tool.execute("tc1", { path: SESSION_FILE })) as {
        details: { kind: string; count: number; shown: number };
      };

      expect(result.details.kind).toBe("listing");
      expect(result.details.count).toBe(12);
      expect(result.details.shown).toBe(10);
    });

    it("returns status details for a missing session file", async () => {
      mockExistsSync.mockReturnValue(false);
      const tools = captureTools(sessionTools);
      const tool = tools.get("list_subagent_sessions")!;

      const result = (await tool.execute("tc1", {
        path: "/sessions/--project--/typo.jsonl",
      })) as { details: { kind: string; message: string } };

      expect(result.details).toEqual({
        kind: "status",
        message: "Session file not found: /sessions/--project--/typo.jsonl",
      });
    });
  });
});
