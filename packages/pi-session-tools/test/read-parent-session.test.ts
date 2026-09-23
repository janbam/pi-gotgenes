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

// Mock node:fs to avoid real file system access
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

describe("read_parent_session tool", () => {
  it("returns error when not running in a subagent context", async () => {
    const tools = captureTools(sessionTools);
    const tool = tools.get("read_parent_session")!;
    expect(tool).toBeDefined();

    // Session file not in a tasks/ directory
    const ctx = makeCtx("/sessions/--project--/2026-05-20T12-00-00Z_.jsonl");
    const result = await tool.execute("tc1", {}, undefined, undefined, ctx);
    const text = (result as { content: { text: string }[] }).content[0].text;
    expect(text).toContain("not running inside a subagent");
  });

  it("returns error when session file is undefined", async () => {
    const tools = captureTools(sessionTools);
    const tool = tools.get("read_parent_session")!;

    const ctx = makeCtx(undefined);
    const result = await tool.execute("tc1", {}, undefined, undefined, ctx);
    const text = (result as { content: { text: string }[] }).content[0].text;
    expect(text).toContain("not running inside a subagent");
  });

  it("returns error when parent session file does not exist", async () => {
    const tools = captureTools(sessionTools);
    const tool = tools.get("read_parent_session")!;

    mockExistsSync.mockReturnValue(false);

    const ctx = makeCtx(
      "/sessions/--project--/2026-05-20T12-00-00Z_/tasks/child.jsonl",
    );
    const result = await tool.execute("tc1", {}, undefined, undefined, ctx);
    const text = (result as { content: { text: string }[] }).content[0].text;
    expect(text).toContain("Parent session file not found");
  });

  it("reads and returns parent session entries as transcript", async () => {
    const tools = captureTools(sessionTools);
    const tool = tools.get("read_parent_session")!;

    mockExistsSync.mockReturnValue(true);
    const parentEntries = [
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
    mockReadFileSync.mockReturnValue(parentEntries);

    const ctx = makeCtx(
      "/sessions/--project--/2026-05-20T12-00-00Z_/tasks/child.jsonl",
    );
    const result = await tool.execute("tc1", {}, undefined, undefined, ctx);
    const text = (result as { content: { text: string }[] }).content[0].text;
    // Session header is stripped; user and assistant turns are formatted
    expect(text).toBe(
      "1. user\nhello\n\n---\n\n2. assistant [anthropic/claude-sonnet-4-20250514]\nhi",
    );
  });

  it("supports type filtering on parent entries before formatting", async () => {
    const tools = captureTools(sessionTools);
    const tool = tools.get("read_parent_session")!;

    mockExistsSync.mockReturnValue(true);
    const parentEntries = [
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
    mockReadFileSync.mockReturnValue(parentEntries);

    const ctx = makeCtx("/sessions/parent/tasks/child.jsonl");
    const result = await tool.execute(
      "tc1",
      { types: ["model_change"] },
      undefined,
      undefined,
      ctx,
    );
    const text = (result as { content: { text: string }[] }).content[0].text;
    // Only model_change entry passes the filter
    expect(text).toBe(
      "[model change] \u2192 anthropic/claude-sonnet-4-20250514",
    );
  });

  describe("window bounds", () => {
    function threeTurnParent() {
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
      return makeCtx("/sessions/parent/tasks/child.jsonl");
    }

    it("skips the most recent offset entries of the parent session", async () => {
      const tools = captureTools(sessionTools);
      const tool = tools.get("read_parent_session")!;

      const result = await tool.execute(
        "tc1",
        { offset: 2, limit: 1 },
        undefined,
        undefined,
        threeTurnParent(),
      );
      const text = (result as { content: { text: string }[] }).content[0].text;
      expect(text).toBe("1. user\nturn 1");
    });

    it("elides parent user bodies when asked", async () => {
      const tools = captureTools(sessionTools);
      const tool = tools.get("read_parent_session")!;

      const result = await tool.execute(
        "tc1",
        { offset: 2, limit: 1, elide_user_text: true },
        undefined,
        undefined,
        threeTurnParent(),
      );
      const text = (result as { content: { text: string }[] }).content[0].text;
      expect(text).toBe("1. user\n[text elided: 6 chars]");
    });
  });

  describe("details", () => {
    it("returns status details when not in a subagent context", async () => {
      const tools = captureTools(sessionTools);
      const tool = tools.get("read_parent_session")!;

      const ctx = makeCtx("/sessions/--project--/2026-05-20T12-00-00Z_.jsonl");
      const result = (await tool.execute(
        "tc1",
        {},
        undefined,
        undefined,
        ctx,
      )) as { details: { kind: string; message: string } };

      expect(result.details.kind).toBe("status");
      expect(result.details.message).toBeTruthy();
    });

    it("returns status details when parent session file is not found", async () => {
      const tools = captureTools(sessionTools);
      const tool = tools.get("read_parent_session")!;

      mockExistsSync.mockReturnValue(false);

      const ctx = makeCtx(
        "/sessions/--project--/2026-05-20T12-00-00Z_/tasks/child.jsonl",
      );
      const result = (await tool.execute(
        "tc1",
        {},
        undefined,
        undefined,
        ctx,
      )) as { details: { kind: string; message: string } };

      expect(result.details.kind).toBe("status");
      expect(result.details.message).toBeTruthy();
    });

    it("returns transcript details with summary counts on success", async () => {
      const tools = captureTools(sessionTools);
      const tool = tools.get("read_parent_session")!;

      mockExistsSync.mockReturnValue(true);
      const parentEntries = [
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
      mockReadFileSync.mockReturnValue(parentEntries);

      const ctx = makeCtx(
        "/sessions/--project--/2026-05-20T12-00-00Z_/tasks/child.jsonl",
      );
      const result = (await tool.execute(
        "tc1",
        {},
        undefined,
        undefined,
        ctx,
      )) as { details: { kind: string; summary: Record<string, number> } };

      expect(result.details).toEqual({
        kind: "transcript",
        summary: {
          totalEntries: 2, // session header filtered out
          messages: 2,
          toolCalls: 1,
          compactions: 0,
          modelChanges: 0,
        },
      });
    });
  }); // describe("details")

  describe("branches", () => {
    it("follows the parent session's live path by default", async () => {
      const tool = captureTools(sessionTools).get("read_parent_session")!;
      mockExistsSync.mockReturnValue(true);
      mockReadFileSync.mockReturnValue(
        [
          JSON.stringify({
            type: "session",
            version: 3,
            id: "s1",
            timestamp: "t0",
            cwd: "/project",
          }),
          ...[
            ["1", null, "first"],
            ["2", "1", "retracted"],
            ["3", "1", "kept"],
          ].map(([id, parentId, body]) =>
            JSON.stringify({
              type: "message",
              id,
              parentId,
              timestamp: `t${id}`,
              message: { role: "user", content: body, timestamp: 1 },
            }),
          ),
        ].join("\n"),
      );

      const ctx = makeCtx(
        "/sessions/--project--/2026-05-20T12-00-00Z_/tasks/child.jsonl",
      );
      const result = (await tool.execute(
        "tc1",
        {},
        undefined,
        undefined,
        ctx,
      )) as { content: { text: string }[] };
      expect(result.content[0].text).toBe(
        "1. user\nfirst\n\n---\n\n" +
          '[abandoned branch] 1 entry omitted (branches: "all" to include)\n\n---\n\n' +
          "2. user\nkept",
      );
    });
  });
});
