import type { ExtensionContext } from "@earendil-works/pi-coding-agent";
import { describe, expect, it, vi } from "vitest";
import sessionTools from "#src/index";
import { captureTools } from "#test/helpers/capture-tools";

function makeCtx(): ExtensionContext {
  return {
    sessionManager: {
      getEntries: () => [],
      getSessionFile: () => undefined,
    },
  } as unknown as ExtensionContext;
}

const mockExistsSync = vi.hoisted(() =>
  vi.fn((_path: string): boolean => false),
);
const mockReadFileSync = vi.hoisted(() =>
  vi.fn((_path: string, _enc: string): string => ""),
);
vi.mock("node:fs", () => ({
  existsSync: mockExistsSync,
  readFileSync: mockReadFileSync,
  default: { existsSync: mockExistsSync, readFileSync: mockReadFileSync },
}));

describe("read_session_file tool", () => {
  it("returns a status message when the session file does not exist", async () => {
    const tools = captureTools(sessionTools);
    const tool = tools.get("read_session_file")!;
    expect(tool).toBeDefined();

    mockExistsSync.mockReturnValue(false);

    const ctx = makeCtx();
    const result = await tool.execute(
      "tc1",
      { path: "/sessions/--project--/missing.jsonl" },
      undefined,
      undefined,
      ctx,
    );
    const text = (result as { content: { text: string }[] }).content[0].text;
    expect(text).toBe(
      "Session file not found: /sessions/--project--/missing.jsonl",
    );
  });

  it("reads and returns the session file's entries as a transcript", async () => {
    const tools = captureTools(sessionTools);
    const tool = tools.get("read_session_file")!;

    mockExistsSync.mockReturnValue(true);
    const fileEntries = [
      JSON.stringify({
        type: "session",
        version: 3,
        id: "s1",
        timestamp: "2026-01-01T00:00:00Z",
        cwd: "/project",
      }),
      JSON.stringify({
        type: "message",
        id: "1",
        parentId: null,
        timestamp: "2026-01-01T00:00:01Z",
        message: { role: "user", content: "hello", timestamp: 1 },
      }),
      JSON.stringify({
        type: "message",
        id: "2",
        parentId: "1",
        timestamp: "2026-01-01T00:00:02Z",
        message: {
          role: "assistant",
          content: [{ type: "text", text: "hi" }],
          provider: "anthropic",
          model: "claude-sonnet-4-20250514",
        },
      }),
    ].join("\n");
    mockReadFileSync.mockReturnValue(fileEntries);

    const ctx = makeCtx();
    const result = await tool.execute(
      "tc1",
      { path: "/sessions/--project--/2026-05-20T12-00-00Z_.jsonl" },
      undefined,
      undefined,
      ctx,
    );
    const text = (result as { content: { text: string }[] }).content[0].text;
    expect(text).toBe(
      "1. user\nhello\n\n---\n\n2. assistant [anthropic/claude-sonnet-4-20250514]\nhi",
    );
  });

  it("supports type filtering", async () => {
    const tools = captureTools(sessionTools);
    const tool = tools.get("read_session_file")!;

    mockExistsSync.mockReturnValue(true);
    const fileEntries = [
      JSON.stringify({
        type: "session",
        version: 3,
        id: "s1",
        timestamp: "t0",
        cwd: "/",
      }),
      JSON.stringify({
        type: "message",
        id: "1",
        parentId: null,
        timestamp: "t1",
        message: { role: "user", content: "hi", timestamp: 1 },
      }),
      JSON.stringify({
        type: "model_change",
        id: "2",
        parentId: "1",
        timestamp: "t2",
        provider: "anthropic",
        modelId: "claude-sonnet-4-20250514",
      }),
    ].join("\n");
    mockReadFileSync.mockReturnValue(fileEntries);

    const ctx = makeCtx();
    const result = await tool.execute(
      "tc1",
      { path: "/sessions/--project--/s.jsonl", types: ["model_change"] },
      undefined,
      undefined,
      ctx,
    );
    const text = (result as { content: { text: string }[] }).content[0].text;
    expect(text).toBe(
      "[model change] \u2192 anthropic/claude-sonnet-4-20250514",
    );
  });

  it("supports limit filtering", async () => {
    const tools = captureTools(sessionTools);
    const tool = tools.get("read_session_file")!;

    mockExistsSync.mockReturnValue(true);
    const fileEntries = [
      JSON.stringify({
        type: "session",
        version: 3,
        id: "s1",
        timestamp: "t0",
        cwd: "/",
      }),
      JSON.stringify({
        type: "message",
        id: "1",
        parentId: null,
        timestamp: "t1",
        message: { role: "user", content: "first", timestamp: 1 },
      }),
      JSON.stringify({
        type: "message",
        id: "2",
        parentId: "1",
        timestamp: "t2",
        message: { role: "user", content: "second", timestamp: 2 },
      }),
    ].join("\n");
    mockReadFileSync.mockReturnValue(fileEntries);

    const ctx = makeCtx();
    const result = await tool.execute(
      "tc1",
      { path: "/sessions/--project--/s.jsonl", limit: 1 },
      undefined,
      undefined,
      ctx,
    );
    const text = (result as { content: { text: string }[] }).content[0].text;
    expect(text).toContain("second");
    expect(text).not.toContain("first");
  });

  describe("window bounds", () => {
    function threeTurnFile() {
      mockExistsSync.mockReturnValue(true);
      mockReadFileSync.mockReturnValue(
        [1, 2, 3]
          .map((n) =>
            JSON.stringify({
              type: "message",
              id: String(n),
              parentId: n === 1 ? null : String(n - 1),
              timestamp: `t${n}`,
              message: { role: "user", content: `turn ${n}`, timestamp: n },
            }),
          )
          .join("\n"),
      );
    }

    it("supports offset paging", async () => {
      const tools = captureTools(sessionTools);
      const tool = tools.get("read_session_file")!;
      threeTurnFile();

      const result = await tool.execute(
        "tc1",
        { path: "/sessions/--project--/s.jsonl", offset: 1, limit: 1 },
        undefined,
        undefined,
        makeCtx(),
      );
      const text = (result as { content: { text: string }[] }).content[0].text;
      expect(text).toBe("1. user\nturn 2");
    });

    it("elides user bodies when asked", async () => {
      const tools = captureTools(sessionTools);
      const tool = tools.get("read_session_file")!;
      threeTurnFile();

      const result = await tool.execute(
        "tc1",
        {
          path: "/sessions/--project--/s.jsonl",
          offset: 1,
          limit: 1,
          elide_user_text: true,
        },
        undefined,
        undefined,
        makeCtx(),
      );
      const text = (result as { content: { text: string }[] }).content[0].text;
      expect(text).toBe("1. user\n[text elided: 6 chars]");
    });
  });

  describe("details", () => {
    it("returns status details when the session file is not found", async () => {
      const tools = captureTools(sessionTools);
      const tool = tools.get("read_session_file")!;

      mockExistsSync.mockReturnValue(false);

      const ctx = makeCtx();
      const result = (await tool.execute(
        "tc1",
        { path: "/sessions/--project--/missing.jsonl" },
        undefined,
        undefined,
        ctx,
      )) as { details: { kind: string; message: string } };

      expect(result.details.kind).toBe("status");
      expect(result.details.message).toBe(
        "Session file not found: /sessions/--project--/missing.jsonl",
      );
    });

    it("returns transcript details with summary counts on success", async () => {
      const tools = captureTools(sessionTools);
      const tool = tools.get("read_session_file")!;

      mockExistsSync.mockReturnValue(true);
      const fileEntries = [
        JSON.stringify({
          type: "session",
          version: 3,
          id: "s1",
          timestamp: "2026-01-01T00:00:00Z",
          cwd: "/project",
        }),
        JSON.stringify({
          type: "message",
          id: "1",
          parentId: null,
          timestamp: "2026-01-01T00:00:01Z",
          message: { role: "user", content: "hello", timestamp: 1 },
        }),
        JSON.stringify({
          type: "message",
          id: "2",
          parentId: "1",
          timestamp: "2026-01-01T00:00:02Z",
          message: {
            role: "assistant",
            content: [
              { type: "text", text: "hi" },
              { type: "toolCall", id: "tc1", name: "Read", arguments: {} },
            ],
            provider: "anthropic",
            model: "claude-sonnet",
          },
        }),
      ].join("\n");
      mockReadFileSync.mockReturnValue(fileEntries);

      const ctx = makeCtx();
      const result = (await tool.execute(
        "tc1",
        { path: "/sessions/--project--/s.jsonl" },
        undefined,
        undefined,
        ctx,
      )) as { details: { kind: string; summary: Record<string, number> } };

      expect(result.details).toEqual({
        kind: "transcript",
        summary: {
          totalEntries: 2,
          messages: 2,
          toolCalls: 1,
          compactions: 0,
          modelChanges: 0,
        },
      });
    });
  }); // describe("details")

  describe("branches", () => {
    function userLine(id: string, parentId: string | null, body: string) {
      return JSON.stringify({
        type: "message",
        id,
        parentId,
        timestamp: `t${id}`,
        message: { role: "user", content: body, timestamp: 1 },
      });
    }

    async function render(params: Record<string, unknown>) {
      mockExistsSync.mockReturnValue(true);
      mockReadFileSync.mockReturnValue(
        [
          JSON.stringify({
            type: "session",
            version: 3,
            id: "s1",
            timestamp: "t0",
            cwd: "/",
          }),
          userLine("1", null, "first"),
          userLine("2", "1", "retracted"),
          userLine("3", "1", "kept"),
        ].join("\n"),
      );
      const tool = captureTools(sessionTools).get("read_session_file")!;
      return (await tool.execute(
        "tc1",
        { path: "/sessions/--project--/s.jsonl", ...params },
        undefined,
        undefined,
        makeCtx(),
      )) as { content: { text: string }[] };
    }

    it("follows the live path by default, taking the last entry as the leaf", async () => {
      const result = await render({});
      expect(result.content[0].text).toBe(
        "1. user\nfirst\n\n---\n\n" +
          '[abandoned branch] 1 entry omitted (branches: "all" to include)\n\n---\n\n' +
          "2. user\nkept",
      );
    });

    it("brackets the abandoned branch when asked for all branches", async () => {
      const result = await render({ branches: "all" });
      expect(result.content[0].text).toContain("[abandoned branch begins]");
      expect(result.content[0].text).toContain("retracted");
    });
  });
});
