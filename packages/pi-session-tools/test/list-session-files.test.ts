import { basename } from "node:path";
import type { ExtensionContext } from "@earendil-works/pi-coding-agent";
import { describe, expect, it, vi } from "vitest";
import sessionTools from "#src/index";
import { captureTools } from "#test/helpers/capture-tools";

function makeCtx(sessionFile: string | undefined): ExtensionContext {
  return {
    sessionManager: {
      getEntries: () => [],
      getSessionFile: () => sessionFile,
    },
  } as unknown as ExtensionContext;
}

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

/**
 * Mock a session directory holding `count` `.jsonl` files with ascending
 * mtimes, and return their basenames newest-first — the order the tool is
 * expected to emit.
 */
function mockSessionFiles(count: number): string[] {
  const names = Array.from(
    { length: count },
    (_, i) => `s-${String(i + 1).padStart(2, "0")}.jsonl`,
  );
  const mtimes = new Map(names.map((name, i) => [name, (i + 1) * 1000]));
  mockExistsSync.mockReturnValue(true);
  mockReaddirSync.mockReturnValue(names);
  mockStatSync.mockImplementation((path: string) => ({
    mtimeMs: mtimes.get(basename(path)) ?? 0,
  }));
  return [...names].reverse();
}

describe("list_session_files tool", () => {
  it("lists session files for a cwd, newest first", async () => {
    const tools = captureTools(sessionTools);
    const tool = tools.get("list_session_files")!;
    expect(tool).toBeDefined();

    const newestFirst = mockSessionFiles(2);

    const ctx = makeCtx(undefined);
    const result = await tool.execute(
      "tc1",
      { cwd: "/Users/chris/development/pi/pi-packages-worktrees/issue-546" },
      undefined,
      undefined,
      ctx,
    );
    const text = (result as { content: { text: string }[] }).content[0].text;
    const { homedir } = await import("node:os");
    const { join } = await import("node:path");
    const dir = join(
      homedir(),
      ".pi",
      "agent",
      "sessions",
      "--Users-chris-development-pi-pi-packages-worktrees-issue-546--",
    );
    expect(text).toBe(
      `Session directory: ${dir}\n2 session files, newest first:\n  ${join(dir, newestFirst[0])}\n  ${join(dir, newestFirst[1])}`,
    );
  });

  it("reports no session files found for an empty directory", async () => {
    const tools = captureTools(sessionTools);
    const tool = tools.get("list_session_files")!;

    mockExistsSync.mockReturnValue(false);

    const ctx = makeCtx(undefined);
    const result = await tool.execute(
      "tc1",
      { cwd: "/nowhere" },
      undefined,
      undefined,
      ctx,
    );
    const text = (result as { content: { text: string }[] }).content[0].text;
    expect(text).toContain("No session files found.");
  });

  it("derives the sessions root from the current session file when available", async () => {
    const tools = captureTools(sessionTools);
    const tool = tools.get("list_session_files")!;

    mockSessionFiles(1);

    const ctx = makeCtx(
      "/custom/root/.pi/agent/sessions/--Users-chris-current--/2026-01-01T00-00-00Z_.jsonl",
    );
    // vi.spyOn process.cwd to match the current-session encoding
    const cwdSpy = vi
      .spyOn(process, "cwd")
      .mockReturnValue("/Users/chris/current");

    const result = await tool.execute(
      "tc1",
      { cwd: "/Users/chris/peer" },
      undefined,
      undefined,
      ctx,
    );
    const text = (result as { content: { text: string }[] }).content[0].text;
    expect(text).toContain(
      "/custom/root/.pi/agent/sessions/--Users-chris-peer--",
    );
    cwdSpy.mockRestore();
  });

  describe("details", () => {
    it("returns listing details with directory and count", async () => {
      const tools = captureTools(sessionTools);
      const tool = tools.get("list_session_files")!;

      mockSessionFiles(2);

      const ctx = makeCtx(undefined);
      const result = (await tool.execute(
        "tc1",
        { cwd: "/Users/chris/peer" },
        undefined,
        undefined,
        ctx,
      )) as { details: { kind: string; directory: string; count: number } };

      const { homedir } = await import("node:os");
      const { join } = await import("node:path");
      expect(result.details.kind).toBe("listing");
      expect(result.details.count).toBe(2);
      expect(result.details.directory).toBe(
        join(homedir(), ".pi", "agent", "sessions", "--Users-chris-peer--"),
      );
    });

    it("reports the bounded count in shown and the true total in count", async () => {
      const tools = captureTools(sessionTools);
      const tool = tools.get("list_session_files")!;

      mockSessionFiles(12);

      const ctx = makeCtx(undefined);
      const result = (await tool.execute(
        "tc1",
        { cwd: "/Users/chris/peer" },
        undefined,
        undefined,
        ctx,
      )) as { details: { kind: string; count: number; shown: number } };

      expect(result.details.kind).toBe("listing");
      expect(result.details.count).toBe(12);
      expect(result.details.shown).toBe(10);
    });

    it("returns listing details with count 0 for an empty directory", async () => {
      const tools = captureTools(sessionTools);
      const tool = tools.get("list_session_files")!;

      mockExistsSync.mockReturnValue(false);

      const ctx = makeCtx(undefined);
      const result = (await tool.execute(
        "tc1",
        { cwd: "/nowhere" },
        undefined,
        undefined,
        ctx,
      )) as { details: { kind: string; count: number } };

      expect(result.details.kind).toBe("listing");
      expect(result.details.count).toBe(0);
    });
  }); // describe("details")

  describe("limit", () => {
    async function listWith(params: {
      cwd: string;
      limit?: number;
    }): Promise<string> {
      const tools = captureTools(sessionTools);
      const tool = tools.get("list_session_files")!;
      const result = await tool.execute(
        "tc1",
        params,
        undefined,
        undefined,
        makeCtx(undefined),
      );
      return (result as { content: { text: string }[] }).content[0].text;
    }

    async function peerDir(): Promise<string> {
      const { homedir } = await import("node:os");
      const { join } = await import("node:path");
      return join(
        homedir(),
        ".pi",
        "agent",
        "sessions",
        "--Users-chris-peer--",
      );
    }

    it("lists only the newest ten when the caller passes no limit", async () => {
      const newestFirst = mockSessionFiles(12);
      const dir = await peerDir();
      const { join } = await import("node:path");

      const text = await listWith({ cwd: "/Users/chris/peer" });

      expect(text).toBe(
        [
          `Session directory: ${dir}`,
          "12 session files, newest first (showing 10):",
          ...newestFirst.slice(0, 10).map((n) => `  ${join(dir, n)}`),
        ].join("\n"),
      );
    });

    it("honours an explicit limit below the default", async () => {
      const newestFirst = mockSessionFiles(12);
      const dir = await peerDir();
      const { join } = await import("node:path");

      const text = await listWith({ cwd: "/Users/chris/peer", limit: 3 });

      expect(text).toBe(
        [
          `Session directory: ${dir}`,
          "12 session files, newest first (showing 3):",
          ...newestFirst.slice(0, 3).map((n) => `  ${join(dir, n)}`),
        ].join("\n"),
      );
    });

    it("renders the unqualified count line when the limit exceeds the total", async () => {
      const newestFirst = mockSessionFiles(12);
      const dir = await peerDir();
      const { join } = await import("node:path");

      const text = await listWith({ cwd: "/Users/chris/peer", limit: 1000 });

      expect(text).toBe(
        [
          `Session directory: ${dir}`,
          "12 session files, newest first:",
          ...newestFirst.map((n) => `  ${join(dir, n)}`),
        ].join("\n"),
      );
    });

    it("lists nothing for a negative limit, rather than all but the oldest", async () => {
      mockSessionFiles(12);
      const dir = await peerDir();

      const text = await listWith({ cwd: "/Users/chris/peer", limit: -2 });

      expect(text).toBe(
        `Session directory: ${dir}\n12 session files, newest first (showing 0):`,
      );
    });
  }); // describe("limit")
});
