import { getMarkdownTheme, initTheme } from "@earendil-works/pi-coding-agent";
import type { Component, TUI } from "@earendil-works/pi-tui";
import { beforeAll, describe, expect, it, type Mock, vi } from "vitest";
import { AgentTypeRegistry } from "#src/config/agent-types";
import type { SessionMessage } from "#src/types";
import type { NavigationEntry, TranscriptSource } from "#src/ui/session-navigation";
import {
  AgentSelectorOverlay,
  SessionNavigatorHandler,
  type SessionNavigatorUI,
  TranscriptOverlay,
} from "#src/ui/session-navigator";
import { makeNavigable } from "#test/helpers/make-navigable";
import { fakeSource, mockTui } from "#test/helpers/transcript-fixtures";

const registry = new AgentTypeRegistry(() => new Map());

// Pi's per-entry components read the global interactive theme; Pi initializes it
// at startup before any command runs. Tests must initialize it explicitly.
beforeAll(() => initTheme(undefined, false));

function ansiTheme() {
  return {
    fg: (_color: string, text: string) => text,
    bold: (text: string) => text,
  };
}

function makeOverlay(opts: { source?: TranscriptSource; done?: (r: undefined) => void; tui?: TUI; abort?: () => void } = {}) {
  return new TranscriptOverlay({
    tui: opts.tui ?? mockTui(),
    theme: ansiTheme(),
    source: opts.source ?? fakeSource(),
    done: opts.done ?? vi.fn(),
    cwd: "/test/cwd",
    markdownTheme: getMarkdownTheme(),
    abort: opts.abort,
  });
}

describe("TranscriptOverlay", () => {
  it("renders the transcript content", () => {
    const lines = makeOverlay().render(80);
    expect(lines.some((l) => l.includes("Hello world"))).toBe(true);
  });

  it("subscribes on construction and requests a render on change", () => {
    const tui = mockTui();
    let captured: (() => void) | undefined;
    const source = fakeSource({
      subscribe: (onChange) => {
        captured = onChange;
        return () => {};
      },
    });
    makeOverlay({ source, tui });
    captured?.();
    expect(tui.requestRender).toHaveBeenCalledOnce();
  });

  it("closes and calls done on Escape", () => {
    const done = vi.fn();
    const overlay = makeOverlay({ done });
    overlay.handleInput("\x1b");
    expect(done).toHaveBeenCalledWith(undefined);
  });

  it("aborts the viewed agent on Ctrl+C and stays open", () => {
    const done = vi.fn();
    const abort = vi.fn();
    const overlay = makeOverlay({ done, abort });
    overlay.handleInput("\x03");
    expect(abort).toHaveBeenCalledOnce();
    expect(done).not.toHaveBeenCalled();
  });

  it("lists Ctrl+C in the footer only when an abort action is wired", () => {
    expect(makeOverlay({ abort: () => {} }).render(80).join("\n")).toContain("Ctrl+C abort");
    expect(makeOverlay().render(80).join("\n")).not.toContain("Ctrl+C abort");
  });

  it("unsubscribes on dispose", () => {
    const unsub = vi.fn();
    const overlay = makeOverlay({ source: fakeSource({ subscribe: () => unsub }) });
    overlay.dispose();
    expect(unsub).toHaveBeenCalledOnce();
  });

  it("does not request a render after dispose", () => {
    const tui = mockTui();
    let captured: (() => void) | undefined;
    const source = fakeSource({
      subscribe: (onChange) => {
        captured = onChange;
        return () => {};
      },
    });
    const overlay = makeOverlay({ source, tui });
    overlay.dispose();
    captured?.();
    expect(tui.requestRender).not.toHaveBeenCalled();
  });

  it("appends the streaming-activity indicator while running", () => {
    const source = fakeSource({
      streaming: () => ({ activeTools: new Map([["k", "read"]]), responseText: "" }),
    });
    const out = makeOverlay({ source }).render(80).join("\n");
    expect(out).toContain("◍");
  });

  describe("scroll bounds", () => {
    // A 200-column terminal renders the overlay at 90% (180 columns, inner 176)
    // while the full terminal would be inner 196. Text sized between the two
    // wraps to two rows at the overlay width and one row at the terminal width,
    // so a layout computed at the wrong width yields the wrong maxScroll.
    const OVERLAY_WIDTH = 180;
    const wrappingMessages = Array.from({ length: 30 }, (_, i) => ({
      role: "user",
      content: `${String(i).padStart(3, "0")} ${"wrap".repeat(46)}`,
    })) as unknown as SessionMessage[];

    function overlayAtBottom() {
      const overlay = makeOverlay({
        tui: mockTui(40, 200),
        source: fakeSource({ getMessages: () => wrappingMessages }),
      });
      const atBottom = overlay.render(OVERLAY_WIDTH);
      return { overlay, atBottom };
    }

    it("scrolls up from the bottom on a terminal wider than the overlay", () => {
      const { overlay, atBottom } = overlayAtBottom();
      overlay.handleInput("\x1b[A");
      expect(overlay.render(OVERLAY_WIDTH)).not.toEqual(atBottom);
    });

    it("returns to the bottom when scrolling back down", () => {
      const { overlay, atBottom } = overlayAtBottom();
      overlay.handleInput("\x1b[A");
      overlay.handleInput("\x1b[B");
      expect(overlay.render(OVERLAY_WIDTH)).toEqual(atBottom);
    });
  });

  it("refreshes its content when the source changes", () => {
    let messages = [{ role: "user", content: "first" }] as unknown as SessionMessage[];
    let captured: (() => void) | undefined;
    const source = fakeSource({
      getMessages: () => messages,
      subscribe: (onChange) => {
        captured = onChange;
        return () => {};
      },
    });
    const overlay = makeOverlay({ source });
    expect(overlay.render(80).join("\n")).toContain("first");
    messages = [{ role: "user", content: "second" }] as unknown as SessionMessage[];
    captured?.();
    expect(overlay.render(80).join("\n")).toContain("second");
  });
});

describe("AgentSelectorOverlay", () => {
  const liveEntry = (record: ReturnType<typeof makeNavigable>): NavigationEntry => ({
    kind: "live",
    record,
    label: `Agent (${record.description}) · ${record.toolUses} tools · ${record.status}`,
  });

  function makeSelector(opts: {
    entries: NavigationEntry[];
    refresh?: () => NavigationEntry[];
    abort?: (entry: NavigationEntry) => void;
    done?: (r: NavigationEntry | undefined) => void;
  }) {
    const tui = mockTui();
    const selector = new AgentSelectorOverlay({
      tui,
      theme: ansiTheme(),
      entries: opts.entries,
      refresh: opts.refresh ?? (() => opts.entries),
      done: opts.done ?? vi.fn(),
      abort: opts.abort ?? vi.fn(),
    });
    return { selector, tui };
  }

  it("renders the entries with the highlight marker on the selected row", () => {
    const { selector } = makeSelector({ entries: [liveEntry(makeNavigable()), liveEntry(makeNavigable({ id: "a2", description: "Second" }))] });
    const out = selector.render(80).join("\n");
    expect(out).toContain("→ Agent (Test task)");
    expect(out).toContain("  Agent (Second)");
  });

  it("moves the selection with arrow keys and j/k", () => {
    const { selector } = makeSelector({ entries: [liveEntry(makeNavigable()), liveEntry(makeNavigable({ id: "a2", description: "Second" }))] });
    selector.handleInput("\x1b[B");
    expect(selector.render(80).join("\n")).toContain("→ Agent (Second)");
    selector.handleInput("k");
    expect(selector.render(80).join("\n")).toContain("→ Agent (Test task)");
  });

  it("confirms with Enter and cancels with Escape", () => {
    const confirmed = vi.fn();
    const cancelled = vi.fn();
    const entry = liveEntry(makeNavigable());
    makeSelector({ entries: [entry], done: confirmed }).selector.handleInput("\r");
    expect(confirmed).toHaveBeenCalledWith(entry);
    makeSelector({ entries: [entry], done: cancelled }).selector.handleInput("\x1b");
    expect(cancelled).toHaveBeenCalledWith(undefined);
  });

  it("aborts the highlighted entry on Ctrl+C, refreshes rows, and keeps the selection", () => {
    // A live record whose status flips to stopped once aborted — the overlay
    // must re-label the row from the refreshed entries.
    let status = "running";
    const record = makeNavigable({ id: "a1", status: "running" });
    Object.defineProperty(record, "status", { get: () => status });
    const abort = vi.fn(() => {
      status = "stopped";
    });
    const refresh = () => [liveEntry(record)];
    const { selector, tui } = makeSelector({ entries: [liveEntry(record)], refresh, abort });

    selector.handleInput("\x03");

    expect(abort).toHaveBeenCalledOnce();
    expect(selector.render(80).join("\n")).toContain("→ Agent (Test task) · 2 tools · stopped");
    expect(tui.requestRender).toHaveBeenCalled();
  });

  it("clamps the selection when the aborted entry leaves the refreshed list", () => {
    const record = makeNavigable({ id: "a1", status: "running" });
    const other = makeNavigable({ id: "a2", description: "Other" });
    const refresh = () => [liveEntry(other)];
    const { selector } = makeSelector({ entries: [liveEntry(record)], refresh });

    selector.handleInput("\x03");

    // The highlighted agent vanished; the selection falls back to the first row.
    expect(selector.render(80).join("\n")).toContain("→ Agent (Other)");
  });
});

describe("SessionNavigatorHandler", () => {
  // Each mounted overlay: the component Pi's ui.custom would focus, plus its
  // done() resolver. mounted[0] is the picker, mounted[1] the transcript viewer.
  // The mock's factory takes the test's stripped-down theme, so the whole UI
  // double is cast to the navigator's narrow interface.
  interface NavigatorUIMock extends SessionNavigatorUI {
    custom: Mock;
    notify: Mock;
    mounted: { component: Component; done: Mock }[];
  }

  function makeUI(): NavigatorUIMock {
    const mounted: { component: Component; done: Mock }[] = [];
    const custom = vi.fn(
      (
        factory: (tui: TUI, theme: ReturnType<typeof ansiTheme>, keybindings: unknown, done: (r: unknown) => void) => Component,
      ) =>
        new Promise((resolve) => {
          // Wrap the resolver in a spy so tests can assert the overlay was (not)
          // closed while still settling the handler's awaited promise.
          const done = vi.fn((r: unknown) => resolve(r));
          mounted.push({ component: factory(mockTui(), ansiTheme(), undefined, done), done });
        }),
    );
    return { notify: vi.fn(), custom, mounted };
  }

  // Component.handleInput is optional on the interface; both overlays define it.
  const pickerAt = (ui: NavigatorUIMock): AgentSelectorOverlay => ui.mounted[0].component as AgentSelectorOverlay;
  const viewerAt = (ui: NavigatorUIMock): TranscriptOverlay => ui.mounted[1].component as TranscriptOverlay;

  const noReadFile = (): string => {
    throw new Error("readFile not expected in this test");
  };

  function params(ui: ReturnType<typeof makeUI>, agents: ReturnType<typeof makeNavigable>[], abort?: (id: string) => boolean) {
    return {
      ui,
      agents,
      registry,
      cwd: "/test/cwd",
      readFile: noReadFile,
      abort: abort ?? vi.fn(() => true),
    };
  }

  it("notifies and skips the overlay when no sessions are navigable", async () => {
    const ui = makeUI();
    const notReady = makeNavigable({ isSessionReady: () => false, outputFile: undefined });
    await new SessionNavigatorHandler().handle(params(ui, [notReady]));
    expect(ui.notify).toHaveBeenCalledWith("No subagent sessions to view.", "info");
    expect(ui.custom).not.toHaveBeenCalled();
  });

  it("does not open the viewer when the operator cancels the picker", async () => {
    const ui = makeUI();
    const handle = new SessionNavigatorHandler().handle(params(ui, [makeNavigable()]));
    pickerAt(ui).handleInput("\x1b");
    await handle;
    expect(ui.custom).toHaveBeenCalledOnce();
  });

  // Pick the first picker entry, wait for the viewer to mount, then close it so
  // the handler's awaited promise settles.
  async function pickAndCloseViewer(ui: NavigatorUIMock): Promise<TranscriptOverlay> {
    pickerAt(ui).handleInput("\r");
    await vi.waitFor(() => expect(ui.mounted.length).toBe(2));
    const viewer = viewerAt(ui);
    ui.mounted[1].done(undefined);
    return viewer;
  }

  it("opens a read-only overlay sourced from the picked record", async () => {
    const messages = [{ role: "assistant", content: [{ type: "text", text: "picked agent reply" }] }] as unknown as SessionMessage[];
    const record = makeNavigable({ agentMessages: messages });
    const ui = makeUI();

    const handle = new SessionNavigatorHandler().handle(params(ui, [record]));
    const viewer = await pickAndCloseViewer(ui);
    await handle;

    expect(ui.custom).toHaveBeenCalledTimes(2);
    // Invariant #423: the handler is a reactive consumer — it sources the
    // transcript and never reads tool definitions off the record itself; only
    // the overlay does, lazily, through the TranscriptSource at render time.
    expect(record.getToolDefinition).not.toHaveBeenCalled();
    expect(viewer.render(80).some((l) => l.includes("picked agent reply"))).toBe(true);
  });

  it("aborts the highlighted agent on picker Ctrl+C without opening the viewer", async () => {
    const record = makeNavigable({ id: "a1", status: "running" });
    const abort = vi.fn(() => true);
    const ui = makeUI();

    // Keep the picker promise pending: Ctrl+C aborts but does not close it.
    const handle = new SessionNavigatorHandler().handle(params(ui, [record], abort));
    pickerAt(ui).handleInput("\x03");
    pickerAt(ui).handleInput("\x1b");
    await handle;

    expect(abort).toHaveBeenCalledWith("a1");
    expect(ui.notify).toHaveBeenCalledWith("Aborting Agent.", "info");
    expect(ui.custom).toHaveBeenCalledOnce();
  });

  it("warns instead of aborting when the highlighted agent is not live", async () => {
    const abort = vi.fn(() => true);
    const ui = makeUI();

    const handle = new SessionNavigatorHandler().handle(params(ui, [makeNavigable()], abort));
    pickerAt(ui).handleInput("\x03");
    pickerAt(ui).handleInput("\x1b");
    await handle;

    expect(abort).not.toHaveBeenCalled();
    expect(ui.notify).toHaveBeenCalledWith("That subagent is not running — nothing to abort.", "warning");
  });

  it("aborts the viewed agent on viewer Ctrl+C and keeps the viewer open", async () => {
    const record = makeNavigable({ id: "a1", status: "running" });
    const abort = vi.fn(() => true);
    const ui = makeUI();

    const handle = new SessionNavigatorHandler().handle(params(ui, [record], abort));
    pickerAt(ui).handleInput("\r");
    await vi.waitFor(() => expect(ui.mounted.length).toBe(2));
    const viewer = viewerAt(ui);

    viewer.handleInput("\x03");

    expect(abort).toHaveBeenCalledWith("a1");
    expect(ui.notify).toHaveBeenCalledWith("Aborting Agent.", "info");
    // The viewer stays open after the abort — only an explicit close settles it.
    expect(ui.mounted[1].done).not.toHaveBeenCalled();
    viewer.handleInput("\x1b");
    await handle;
  });

  it("omits the abort hint and ignores Ctrl+C for an already-settled agent in the viewer", async () => {
    const abort = vi.fn(() => true);
    const ui = makeUI();

    const handle = new SessionNavigatorHandler().handle(params(ui, [makeNavigable()], abort));
    pickerAt(ui).handleInput("\r");
    await vi.waitFor(() => expect(ui.mounted.length).toBe(2));

    // The agent already settled: no abort action is wired, so there is no
    // footer hint and Ctrl+C is a no-op rather than a warning.
    expect(viewerAt(ui).render(80).join("\n")).not.toContain("Ctrl+C abort");
    viewerAt(ui).handleInput("\x03");

    expect(abort).not.toHaveBeenCalled();
    expect(ui.notify).not.toHaveBeenCalled();
    expect(ui.mounted[1].done).not.toHaveBeenCalled();
    ui.mounted[1].done(undefined);
    await handle;
  });

  it("opens an overlay sourced from the persisted file when a released agent is picked", async () => {
    const jsonl = [
      { type: "session", version: 3, id: "s1", timestamp: "2026-06-23T00:00:00Z", cwd: "/proj" },
      { type: "message", id: "m1", parentId: null, timestamp: "2026-06-23T00:00:01Z", message: { role: "assistant", content: [{ type: "text", text: "released reply" }] } },
    ]
      .map((entry) => JSON.stringify(entry))
      .join("\n");
    const readFile = vi.fn(() => jsonl);
    const released = makeNavigable({
      id: "e1", description: "Old task", status: "completed", startedAt: 1000, completedAt: 4000, toolUses: 5,
      isSessionReady: () => false, outputFile: "/tasks/e1.jsonl",
    });
    const ui = makeUI();

    const handle = new SessionNavigatorHandler().handle({ ...params(ui, [released]), readFile });
    const viewer = await pickAndCloseViewer(ui);
    await handle;

    expect(readFile).toHaveBeenCalledWith("/tasks/e1.jsonl");
    expect(ui.custom).toHaveBeenCalledTimes(2);
    expect(viewer.render(80).some((l) => l.includes("released reply"))).toBe(true);
  });

  it("omits the abort hint and ignores Ctrl+C for a released agent's snapshot viewer", async () => {
    const jsonl = [
      { type: "session", version: 3, id: "s1", timestamp: "2026-06-23T00:00:00Z", cwd: "/proj" },
      { type: "message", id: "m1", parentId: null, timestamp: "2026-06-23T00:00:01Z", message: { role: "assistant", content: [{ type: "text", text: "released reply" }] } },
    ]
      .map((entry) => JSON.stringify(entry))
      .join("\n");
    const readFile = vi.fn(() => jsonl);
    const released = makeNavigable({
      id: "e1", description: "Old task", status: "completed", startedAt: 1000, completedAt: 4000, toolUses: 5,
      isSessionReady: () => false, outputFile: "/tasks/e1.jsonl",
    });
    const abort = vi.fn(() => true);
    const ui = makeUI();

    const handle = new SessionNavigatorHandler().handle({ ...params(ui, [released], abort), readFile });
    pickerAt(ui).handleInput("\r");
    await vi.waitFor(() => expect(ui.mounted.length).toBe(2));
    const viewer = viewerAt(ui);

    // A released session has nothing left to abort: no footer hint, and
    // Ctrl+C is a no-op rather than a warning.
    expect(viewer.render(80).join("\n")).not.toContain("Ctrl+C abort");
    viewer.handleInput("\x03");
    expect(abort).not.toHaveBeenCalled();
    expect(ui.notify).not.toHaveBeenCalled();
    expect(ui.mounted[1].done).not.toHaveBeenCalled();
    ui.mounted[1].done(undefined);
    await handle;
  });

  it("notifies and skips the overlay when the session file cannot be read", async () => {
    const readFile = vi.fn(() => {
      throw new Error("ENOENT");
    });
    const released = makeNavigable({
      id: "e1", description: "Old task", status: "completed", startedAt: 1000, completedAt: 4000, toolUses: 5,
      isSessionReady: () => false, outputFile: "/tasks/e1.jsonl",
    });
    const ui = makeUI();

    const handle = new SessionNavigatorHandler().handle({ ...params(ui, [released]), readFile });
    pickerAt(ui).handleInput("\r");
    await handle;

    expect(ui.notify).toHaveBeenCalledWith("Could not read the session transcript file.", "error");
    expect(ui.custom).toHaveBeenCalledOnce();
  });
});
