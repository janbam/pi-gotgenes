import type { ExtensionContext } from "@earendil-works/pi-coding-agent";
import { describe, expect, it } from "vitest";
import sessionTools from "#src/index";
import { captureTools } from "#test/helpers/capture-tools";

/** Theme stub whose colour and weight helpers are the identity function. */
function plainTheme() {
  return {
    fg: (_key: string, text: string) => text,
    bold: (text: string) => text,
  };
}

/**
 * `leafId` defaults to the last entry's id, which is what Pi's own
 * `SessionManager` assigns while indexing a file it just loaded.
 * Pass one explicitly to model a session whose leaf is not its last entry.
 */
function makeCtx(
  entries: unknown[],
  sessionFile?: string,
  leafId?: string | null,
): ExtensionContext {
  return {
    sessionManager: {
      getEntries: () => entries,
      getSessionFile: () => sessionFile,
      getLeafId: () =>
        leafId !== undefined
          ? leafId
          : ((entries.at(-1) as { id?: string } | undefined)?.id ?? null),
    },
  } as unknown as ExtensionContext;
}

describe("read_session tool", () => {
  it("returns session entries as transcript", async () => {
    const tools = captureTools(sessionTools);
    const tool = tools.get("read_session");
    expect(tool).toBeDefined();

    const entries = [
      {
        type: "message",
        id: "1",
        parentId: null,
        timestamp: "2026-01-01T00:00:00Z",
        message: { role: "user", content: "hi", timestamp: 1 },
      },
      {
        type: "message",
        id: "2",
        parentId: "1",
        timestamp: "2026-01-01T00:00:01Z",
        message: {
          role: "assistant",
          content: [{ type: "text", text: "hello back" }],
          provider: "anthropic",
          model: "claude-sonnet-4-20250514",
        },
      },
    ];

    const ctx = makeCtx(entries);
    const result = await tool!.execute("tc1", {}, undefined, undefined, ctx);
    const text = (result as { content: { text: string }[] }).content[0].text;
    expect(text).toBe(
      "1. user\nhi\n\n---\n\n2. assistant [anthropic/claude-sonnet-4-20250514]\nhello back",
    );
  });

  it("filters entries by type before formatting", async () => {
    const tools = captureTools(sessionTools);
    const tool = tools.get("read_session")!;

    const entries = [
      {
        type: "message",
        id: "1",
        parentId: null,
        timestamp: "t1",
        message: { role: "user", content: "first", timestamp: 1 },
      },
      {
        type: "compaction",
        id: "2",
        parentId: "1",
        timestamp: "t2",
        summary: "compacted",
        firstKeptEntryId: "1",
        tokensBefore: 5000,
      },
      {
        type: "message",
        id: "3",
        parentId: "2",
        timestamp: "t3",
        message: { role: "user", content: "second", timestamp: 2 },
      },
    ];

    const ctx = makeCtx(entries);
    const result = await tool.execute(
      "tc1",
      { types: ["compaction"] },
      undefined,
      undefined,
      ctx,
    );
    const text = (result as { content: { text: string }[] }).content[0].text;
    expect(text).toBe("[compaction] Context compacted (5000 tokens before)");
  });

  it("limits to the most recent N entries before formatting", async () => {
    const tools = captureTools(sessionTools);
    const tool = tools.get("read_session")!;

    const entries = [
      {
        type: "message",
        id: "1",
        parentId: null,
        timestamp: "t1",
        message: { role: "user", content: "first", timestamp: 1 },
      },
      {
        type: "message",
        id: "2",
        parentId: "1",
        timestamp: "t2",
        message: { role: "user", content: "second", timestamp: 2 },
      },
      {
        type: "message",
        id: "3",
        parentId: "2",
        timestamp: "t3",
        message: { role: "user", content: "third", timestamp: 3 },
      },
    ];

    const ctx = makeCtx(entries);
    const result = await tool.execute(
      "tc1",
      { limit: 2 },
      undefined,
      undefined,
      ctx,
    );
    const text = (result as { content: { text: string }[] }).content[0].text;
    // Last two entries; turn counter is relative to the formatted slice
    expect(text).toContain("second");
    expect(text).toContain("third");
    expect(text).not.toContain("first");
  });

  it("combines type filter and limit before formatting", async () => {
    const tools = captureTools(sessionTools);
    const tool = tools.get("read_session")!;

    const entries = [
      {
        type: "message",
        id: "1",
        parentId: null,
        timestamp: "t1",
        message: { role: "user", content: "one", timestamp: 1 },
      },
      {
        type: "compaction",
        id: "2",
        parentId: "1",
        timestamp: "t2",
        summary: "x",
        firstKeptEntryId: "1",
        tokensBefore: 1000,
      },
      {
        type: "message",
        id: "3",
        parentId: "2",
        timestamp: "t3",
        message: { role: "user", content: "two", timestamp: 2 },
      },
      {
        type: "message",
        id: "4",
        parentId: "3",
        timestamp: "t4",
        message: { role: "user", content: "three", timestamp: 3 },
      },
    ];

    const ctx = makeCtx(entries);
    const result = await tool.execute(
      "tc1",
      { types: ["message"], limit: 1 },
      undefined,
      undefined,
      ctx,
    );
    const text = (result as { content: { text: string }[] }).content[0].text;
    expect(text).toContain("three");
    expect(text).not.toContain("one");
    expect(text).not.toContain("two");
  });

  it("returns empty string when no entries match the filter", async () => {
    const tools = captureTools(sessionTools);
    const tool = tools.get("read_session")!;

    const ctx = makeCtx([
      {
        type: "message",
        id: "1",
        parentId: null,
        timestamp: "t1",
        message: { role: "user", content: "hello", timestamp: 1 },
      },
    ]);
    const result = await tool.execute(
      "tc1",
      { types: ["compaction"] },
      undefined,
      undefined,
      ctx,
    );
    const text = (result as { content: { text: string }[] }).content[0].text;
    expect(text).toBe("");
  });

  describe("window bounds", () => {
    const threeUserTurns = [1, 2, 3].map((n) => ({
      type: "message",
      id: String(n),
      parentId: n === 1 ? null : String(n - 1),
      timestamp: `t${n}`,
      message: { role: "user", content: `turn ${n}`, timestamp: n },
    }));

    it("returns no entries for a limit of zero", async () => {
      const tools = captureTools(sessionTools);
      const tool = tools.get("read_session")!;

      const result = (await tool.execute(
        "tc1",
        { limit: 0 },
        undefined,
        undefined,
        makeCtx(threeUserTurns),
      )) as {
        content: { text: string }[];
        details: { summary: { totalEntries: number } };
      };

      expect(result.content[0].text).toBe("");
      expect(result.details.summary.totalEntries).toBe(0);
    });

    it("returns no entries for a negative limit", async () => {
      const tools = captureTools(sessionTools);
      const tool = tools.get("read_session")!;

      const result = (await tool.execute(
        "tc1",
        { limit: -2 },
        undefined,
        undefined,
        makeCtx(threeUserTurns),
      )) as {
        content: { text: string }[];
        details: { summary: { totalEntries: number } };
      };

      expect(result.content[0].text).toBe("");
      expect(result.details.summary.totalEntries).toBe(0);
    });

    it("skips the most recent offset entries", async () => {
      const tools = captureTools(sessionTools);
      const tool = tools.get("read_session")!;

      const result = (await tool.execute(
        "tc1",
        { offset: 1 },
        undefined,
        undefined,
        makeCtx(threeUserTurns),
      )) as { content: { text: string }[] };

      const text = result.content[0].text;
      expect(text).toContain("turn 1");
      expect(text).toContain("turn 2");
      expect(text).not.toContain("turn 3");
    });

    it("pages backward when offset and limit are combined", async () => {
      const tools = captureTools(sessionTools);
      const tool = tools.get("read_session")!;

      const result = (await tool.execute(
        "tc1",
        { offset: 1, limit: 1 },
        undefined,
        undefined,
        makeCtx(threeUserTurns),
      )) as { content: { text: string }[] };

      const text = result.content[0].text;
      expect(text).toBe("1. user\nturn 2");
    });

    it("elides user bodies when asked, keeping the turn structure", async () => {
      const tools = captureTools(sessionTools);
      const tool = tools.get("read_session")!;

      const result = (await tool.execute(
        "tc1",
        { elide_user_text: true, limit: 1 },
        undefined,
        undefined,
        makeCtx(threeUserTurns),
      )) as { content: { text: string }[] };

      expect(result.content[0].text).toBe("1. user\n[text elided: 6 chars]");
    });

    it("drops a phantom model change from the transcript and every count", async () => {
      const tools = captureTools(sessionTools);
      const tool = tools.get("read_session")!;

      const entries = [
        { type: "message", message: { role: "user", content: "hello" } },
        {
          type: "message",
          message: {
            role: "assistant",
            content: [{ type: "text", text: "hi" }],
            provider: "anthropic",
            model: "claude-sonnet",
          },
        },
        {
          type: "model_change",
          provider: "anthropic",
          modelId: "claude-opus",
        },
      ];

      const result = (await tool.execute(
        "tc1",
        {},
        undefined,
        undefined,
        makeCtx(entries),
      )) as {
        content: { text: string }[];
        details: { kind: string; summary: Record<string, number> };
      };

      expect(result.content[0].text).not.toContain("[model change]");
      expect(result.details.summary).toEqual({
        totalEntries: 2,
        messages: 2,
        toolCalls: 0,
        compactions: 0,
        modelChanges: 0,
      });
    });
  });

  describe("renderCall", () => {
    it("names the window bounds in the collapsed call label", () => {
      const tools = captureTools(sessionTools);
      const tool = tools.get("read_session")!;

      const label = tool
        .renderCall(
          { offset: 40, limit: 20, elide_user_text: true },
          plainTheme(),
          {},
        )
        .render(200)
        .join("\n");

      expect(label).toContain("offset: 40");
      expect(label).toContain("limit: 20");
      expect(label).toContain("elide user text");
    });
  });

  describe("details", () => {
    it("returns transcript details with summary counts", async () => {
      const tools = captureTools(sessionTools);
      const tool = tools.get("read_session")!;

      const entries = [
        {
          type: "message",
          message: { role: "user", content: "hello" },
        },
        {
          type: "message",
          message: {
            role: "assistant",
            content: [
              { type: "text", text: "hi" },
              { type: "toolCall", id: "tc1", name: "Read", arguments: {} },
            ],
            provider: "anthropic",
            model: "claude-sonnet",
          },
        },
        { type: "compaction", tokensBefore: 1000 },
        { type: "model_change", provider: "anthropic", modelId: "claude-opus" },
        {
          type: "message",
          message: {
            role: "assistant",
            content: [{ type: "text", text: "switched" }],
            provider: "anthropic",
            model: "claude-opus",
          },
        },
      ];

      const ctx = makeCtx(entries);
      const result = (await tool.execute(
        "tc1",
        {},
        undefined,
        undefined,
        ctx,
      )) as {
        details: { kind: string; summary: Record<string, number> };
      };

      expect(result.details).toEqual({
        kind: "transcript",
        summary: {
          totalEntries: 5,
          messages: 3,
          toolCalls: 1,
          compactions: 1,
          modelChanges: 1,
        },
      });
    });

    it("returns transcript details with zero counts when filter produces no entries", async () => {
      const tools = captureTools(sessionTools);
      const tool = tools.get("read_session")!;

      const ctx = makeCtx([
        { type: "message", message: { role: "user", content: "hello" } },
      ]);
      const result = (await tool.execute(
        "tc1",
        { types: ["compaction"] },
        undefined,
        undefined,
        ctx,
      )) as { details: { kind: string; summary: { totalEntries: number } } };

      expect(result.details.kind).toBe("transcript");
      expect(result.details.summary.totalEntries).toBe(0);
    });
  }); // describe("details")

  describe("branches", () => {
    function userTurn(id: string, parentId: string | null, body: string) {
      return {
        type: "message",
        id,
        parentId,
        timestamp: `t${id}`,
        message: { role: "user", content: body, timestamp: 1 },
      };
    }

    // 1 → {2, 3}: the operator rewound after "retracted" and asked "kept".
    const forked = [
      userTurn("1", null, "first"),
      userTurn("2", "1", "retracted"),
      userTurn("3", "1", "kept"),
    ];

    async function render(
      params: Record<string, unknown>,
      ctx = makeCtx(forked),
    ) {
      const tool = captureTools(sessionTools).get("read_session")!;
      return (await tool.execute("tc1", params, undefined, undefined, ctx)) as {
        content: { text: string }[];
        details: { summary: { totalEntries: number } };
      };
    }

    it("follows the live path by default", async () => {
      const result = await render({});
      expect(result.content[0].text).toBe(
        "1. user\nfirst\n\n---\n\n" +
          '[abandoned branch] 1 entry omitted (branches: "all" to include)\n\n---\n\n' +
          "2. user\nkept",
      );
    });

    it("counts only the live path in the summary", async () => {
      const result = await render({});
      expect(result.details.summary.totalEntries).toBe(2);
    });

    it("brackets the abandoned branch when asked for all branches", async () => {
      const result = await render({ branches: "all" });
      expect(result.content[0].text).toBe(
        "1. user\nfirst\n\n---\n\n" +
          "[abandoned branch begins] 1 entry\n\n---\n\n" +
          "2. user\nretracted\n\n---\n\n" +
          "[abandoned branch ends]\n\n---\n\n" +
          "3. user\nkept",
      );
    });

    it("treats an unrecognized branches value as the live default", async () => {
      const result = await render({ branches: "everything" });
      expect(result.content[0].text).not.toContain("retracted");
    });

    it("keeps the omission marker through a type filter, as the retro lens calls it", async () => {
      const result = await render({ types: ["message"] });
      expect(result.content[0].text).toBe(
        "1. user\nfirst\n\n---\n\n" +
          '[abandoned branch] 1 entry omitted (branches: "all" to include)\n\n---\n\n' +
          "2. user\nkept",
      );
    });

    it("walks from the session manager's leaf, not the last entry", async () => {
      // The leaf is entry 2, so the branch ending in "kept" is the abandoned one.
      const result = await render({}, makeCtx(forked, undefined, "2"));
      expect(result.content[0].text).toBe(
        "1. user\nfirst\n\n---\n\n" +
          "2. user\nretracted\n\n---\n\n" +
          '[abandoned branch] 1 entry omitted (branches: "all" to include)',
      );
    });
  });
});
