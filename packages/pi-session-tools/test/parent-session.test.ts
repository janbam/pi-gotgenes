import { describe, expect, it } from "vitest";
import {
  deriveParentSessionFile,
  deriveSubagentSessionsDir,
} from "#src/parent-session";

describe("deriveParentSessionFile", () => {
  it("derives parent file from a subagent session path", () => {
    const sessionFile =
      "/home/user/.pi/agent/sessions/--project--/2026-05-20T12-00-00Z_/tasks/2026-05-20T12-01-00Z_.jsonl";
    expect(deriveParentSessionFile(sessionFile)).toBe(
      "/home/user/.pi/agent/sessions/--project--/2026-05-20T12-00-00Z_.jsonl",
    );
  });

  it("returns undefined when not in a tasks directory", () => {
    const sessionFile =
      "/home/user/.pi/agent/sessions/--project--/2026-05-20T12-00-00Z_.jsonl";
    expect(deriveParentSessionFile(sessionFile)).toBeUndefined();
  });

  it("returns undefined for undefined input", () => {
    expect(deriveParentSessionFile(undefined)).toBeUndefined();
  });

  it("handles nested tasks directories (picks immediate parent)", () => {
    // A deeply nested subagent: parent/tasks/child/tasks/grandchild.jsonl
    const sessionFile = "/sessions/parent/tasks/child/tasks/grandchild.jsonl";
    expect(deriveParentSessionFile(sessionFile)).toBe(
      "/sessions/parent/tasks/child.jsonl",
    );
  });

  it("returns undefined when tasks is not the immediate parent directory", () => {
    // tasks exists in the path but not as the immediate parent
    const sessionFile = "/sessions/tasks/subdir/session.jsonl";
    expect(deriveParentSessionFile(sessionFile)).toBeUndefined();
  });
});

describe("deriveSubagentSessionsDir", () => {
  it("derives the tasks directory from a session file path", () => {
    const sessionFile =
      "/home/user/.pi/agent/sessions/--project--/2026-05-20T12-00-00Z_.jsonl";
    expect(deriveSubagentSessionsDir(sessionFile)).toBe(
      "/home/user/.pi/agent/sessions/--project--/2026-05-20T12-00-00Z_/tasks",
    );
  });

  it("nests one level further for a subagent session file", () => {
    const sessionFile = "/sessions/parent/tasks/child.jsonl";
    expect(deriveSubagentSessionsDir(sessionFile)).toBe(
      "/sessions/parent/tasks/child/tasks",
    );
  });

  it("inverts deriveParentSessionFile", () => {
    const child = "/sessions/--project--/2026-05-20T12-00-00Z_/tasks/c.jsonl";
    const parent = deriveParentSessionFile(child)!;
    expect(deriveSubagentSessionsDir(parent)).toBe(
      "/sessions/--project--/2026-05-20T12-00-00Z_/tasks",
    );
  });

  it("keeps the basename intact when the path has no .jsonl suffix", () => {
    expect(deriveSubagentSessionsDir("/sessions/--project--/s")).toBe(
      "/sessions/--project--/s/tasks",
    );
  });
});
