/**
 * session-navigator.ts — The `/subagents:sessions` command: pick a subagent and
 * read its transcript through Pi's own per-entry session components.
 *
 * SDK/TUI consumer half of native session navigation. The unit-testable core
 * (selection, sourcing) lives in `session-navigation.ts`; this module wires that
 * core to a custom picker overlay and a read-only scrollable overlay, and owns
 * the renderer — it mounts Pi's interactive components (`AssistantMessageComponent`,
 * `ToolExecutionComponent`, …) into a `Container`, mirroring Pi's own
 * `renderSessionContext` mapping. Rendering lives here, not in the pure module,
 * because the components require a `TUI`, `cwd`, and markdown theme.
 *
 * The transcript viewer is read-only for content — steering stays in the
 * `steer_subagent` tool and the widget — but it (and the picker) route Ctrl+C to
 * an injected abort callback, so the operator can stop a running subagent
 * without leaving the command. It consumes a `TranscriptSource`, so a released
 * agent's disk snapshot (`fileSnapshotSource`) swaps in without touching the
 * renderer or the overlay.
 */

import { getMarkdownTheme } from "@earendil-works/pi-coding-agent";
import {
  type Component,
  type MarkdownTheme,
  matchesKey,
  type TUI,
  truncateToWidth,
  visibleWidth,
} from "@earendil-works/pi-tui";
import type { AgentConfigLookup } from "#src/config/agent-types";
import type { Theme } from "#src/ui/display";
import { getDisplayName } from "#src/ui/display";
import {
  fileSnapshotSource,
  isAbortableEntry,
  listNavigableAgents,
  liveSource,
  type NavigableSubagent,
  type NavigationEntry,
  type TranscriptSource,
} from "#src/ui/session-navigation";
import { TranscriptContent } from "#src/ui/transcript-content";

// ─────────────────────────────────────────────────────────────────────────────

/** Chrome lines: top border + header + header sep + footer sep + footer + bottom border. */
const CHROME_LINES = 6;
const MIN_VIEWPORT = 3;
const VIEWPORT_HEIGHT_PCT = 70;
/** Overlay width as a share of the terminal, as handed to Pi's overlay compositor. */
const OVERLAY_WIDTH_PCT = 90;

/** Component factory shape Pi's `ui.custom` invokes to mount an overlay. */
export type OverlayComponentFactory<R> = (
  tui: TUI,
  theme: Theme,
  keybindings: unknown,
  done: (result: R) => void,
) => Component;

/** Narrow UI interface — only the `ctx.ui` methods the navigator calls. */
export interface SessionNavigatorUI {
  notify(message: string, level: "info" | "warning" | "error"): void;
  custom<R>(component: OverlayComponentFactory<R>, options?: unknown): Promise<R>;
}

/** Parameters for one `/subagents:sessions` invocation. */
export interface SessionNavigatorParams {
  ui: SessionNavigatorUI;
  agents: readonly NavigableSubagent[];
  registry: AgentConfigLookup;
  /** Working directory for tool-call rendering (relative path display). */
  cwd: string;
  /** Reads a persisted session file for the file-snapshot source. */
  readFile: (path: string) => string;
  /**
   * Aborts a subagent by id (wired to `SubagentManager.abort`). Ctrl+C in the
   * picker and the transcript viewer routes here.
   */
  abort: (id: string) => boolean;
}

/** Options for the read-only transcript overlay. */
export interface TranscriptOverlayOptions {
  tui: TUI;
  theme: Theme;
  source: TranscriptSource;
  done: (result: undefined) => void;
  cwd: string;
  markdownTheme: MarkdownTheme;
  /**
   * Ctrl+C action for the viewer: abort the viewed agent. Absent when the
   * entry is not abortable (snapshot source, or an already-settled agent) —
   * the footer omits the abort hint then.
   */
  abort?: () => void;
}

/** Options for the agent picker overlay. */
export interface AgentSelectorOverlayOptions {
  tui: TUI;
  theme: Theme;
  entries: NavigationEntry[];
  /**
   * Rebuilds the entry list from the live records; called after an abort so
   * statuses re-label (an aborted agent shows its stopped status).
   */
  refresh: () => NavigationEntry[];
  done: (result: NavigationEntry | undefined) => void;
  /**
   * Abort the highlighted entry's agent and surface the outcome. The overlay
   * only routes the key; policy (abortable check, notification) is the
   * caller's, so the component stays mechanical.
   */
  abort: (entry: NavigationEntry) => void;
}

/**
 * Handler for the `/subagents:sessions` slash command.
 *
 * Lists navigable subagents in a picker overlay, lets the operator pick one
 * (or abort one with Ctrl+C), and opens its transcript read-only. Receives the
 * agent records (`manager.listAgents()`) and an abort callback rather than the
 * manager, so it stays a reactive consumer whose only core action is the
 * explicit operator-initiated abort.
 */
export class SessionNavigatorHandler {
  async handle({ ui, agents, registry, cwd, readFile, abort }: SessionNavigatorParams): Promise<void> {
    const entries = listNavigableAgents(agents, registry);
    if (entries.length === 0) {
      ui.notify("No subagent sessions to view.", "info");
      return;
    }

    // Picker: custom overlay rather than `ui.select`, because Pi's built-in
    // selector maps Ctrl+C to dialog-cancel and offers no hook to abort the
    // highlighted agent instead.
    const picked = await ui.custom<NavigationEntry | undefined>(
      (tui, theme, _keybindings, done) =>
        new AgentSelectorOverlay({
          tui,
          theme,
          entries,
          // Records are live objects, so re-running the listing after an abort
          // picks up the new statuses for the re-labeled rows.
          refresh: () => listNavigableAgents(agents, registry),
          done,
          abort: (entry) => this.abortEntry(entry, { ui, registry, abort }),
        }),
      {
        overlay: true,
        overlayOptions: {
          anchor: "center",
          width: `${OVERLAY_WIDTH_PCT}%`,
          maxHeight: `${VIEWPORT_HEIGHT_PCT}%`,
        },
      },
    );
    if (!picked) return;

    let source: TranscriptSource;
    try {
      source = picked.kind === "live" ? liveSource(picked.record) : fileSnapshotSource(picked.outputFile, readFile);
    } catch {
      ui.notify("Could not read the session transcript file.", "error");
      return;
    }
    const markdownTheme = getMarkdownTheme();
    await ui.custom<undefined>(
      (tui, theme, _keybindings, done) =>
        new TranscriptOverlay({
          tui,
          theme,
          source,
          done,
          cwd,
          markdownTheme,
          // Abortable entries keep the viewer open after the abort (per
          // operator choice): the live source shows the agent settling into
          // its stopped state. Snapshots and settled agents get no abort
          // action, so the footer omits the hint.
          abort: isAbortableEntry(picked) ? () => this.abortEntry(picked, { ui, registry, abort }) : undefined,
        }),
      {
        overlay: true,
        overlayOptions: {
          anchor: "center",
          width: `${OVERLAY_WIDTH_PCT}%`,
          maxHeight: `${VIEWPORT_HEIGHT_PCT}%`,
        },
      },
    );
  }

  // ---- Private ----

  /**
   * Abort one entry's agent (if it is still live) and report the outcome —
   * the single funnel both overlays' Ctrl+C routes through.
   */
  private abortEntry(
    entry: NavigationEntry,
    deps: { ui: SessionNavigatorUI; registry: AgentConfigLookup; abort: (id: string) => boolean },
  ): void {
    if (!isAbortableEntry(entry) || entry.kind !== "live") {
      deps.ui.notify("That subagent is not running — nothing to abort.", "warning");
      return;
    }
    const name = getDisplayName(entry.record.type, deps.registry);
    if (!deps.abort(entry.record.id)) {
      deps.ui.notify(`Could not abort ${name}.`, "error");
      return;
    }
    deps.ui.notify(`Aborting ${name}.`, "info");
  }
}

/**
 * Agent picker overlay: a scroll-free list with a highlighted row.
 *
 * Mirrors Pi's built-in extension selector's keys (arrows/j/k + Enter/Esc)
 * plus Ctrl+C, which routes to the injected abort callback and refreshes the
 * rows so an aborted agent is marked with its stopped status in the list.
 */
export class AgentSelectorOverlay implements Component {
  private entries: NavigationEntry[];
  private selectedIndex = 0;
  private readonly tui: TUI;
  private readonly theme: Theme;
  private readonly refresh: () => NavigationEntry[];
  private readonly done: (result: NavigationEntry | undefined) => void;
  private readonly abort: (entry: NavigationEntry) => void;

  constructor({ tui, theme, entries, refresh, done, abort }: AgentSelectorOverlayOptions) {
    this.tui = tui;
    this.theme = theme;
    this.entries = entries;
    this.refresh = refresh;
    this.done = done;
    this.abort = abort;
  }

  handleInput(data: string): void {
    if (matchesKey(data, "escape") || matchesKey(data, "q")) {
      this.done(undefined);
      return;
    }
    if (matchesKey(data, "up") || matchesKey(data, "k")) {
      this.selectedIndex = Math.max(0, this.selectedIndex - 1);
      this.tui.requestRender();
    } else if (matchesKey(data, "down") || matchesKey(data, "j")) {
      this.selectedIndex = Math.min(this.entries.length - 1, this.selectedIndex + 1);
      this.tui.requestRender();
    } else if (matchesKey(data, "enter")) {
      this.done(this.entries[this.selectedIndex]);
    } else if (matchesKey(data, "ctrl+c")) {
      const entry = this.entries.at(this.selectedIndex);
      if (entry === undefined) return;
      this.abort(entry);
      // Re-label from the live records; keep the highlight on the same agent
      // so several aborts in a row need no re-navigation.
      const selectedKey = this.entryKey(entry);
      this.entries = this.refresh();
      this.selectedIndex = Math.max(
        0,
        this.entries.findIndex((candidate) => this.entryKey(candidate) === selectedKey),
      );
      this.tui.requestRender();
    }
  }

  render(width: number): string[] {
    if (width < 6) return [];
    const th = this.theme;
    const innerW = width - 4;
    const lines: string[] = [];

    const pad = (s: string, len: number): string => s + " ".repeat(Math.max(0, len - visibleWidth(s)));
    const row = (content: string): string =>
      th.fg("border", "│") + " " + truncateToWidth(pad(content, innerW), innerW) + " " + th.fg("border", "│");
    const hrTop = th.fg("border", `╭${"─".repeat(width - 2)}╮`);
    const hrBot = th.fg("border", `╰${"─".repeat(width - 2)}╯`);
    const hrMid = row(th.fg("dim", "─".repeat(innerW)));

    lines.push(hrTop);
    lines.push(row(th.bold("Subagent sessions")));
    lines.push(hrMid);

    for (let i = 0; i < this.entries.length; i++) {
      const marker = i === this.selectedIndex ? th.fg("accent", "→ ") : "  ";
      lines.push(row(marker + this.entries[i].label));
    }

    lines.push(hrMid);
    const footer = th.fg("dim", "↑↓ navigate · Enter view · Ctrl+C abort · Esc close");
    lines.push(row(footer));
    lines.push(hrBot);

    return lines;
  }

  // fallow-ignore-next-line unused-class-member
  invalidate(): void {}

  // ---- Private ----

  /** Stable identity across refreshes: the live record's id, or the snapshot's file. */
  private entryKey(entry: NavigationEntry): string {
    return entry.kind === "live" ? `live:${entry.record.id}` : `snapshot:${entry.outputFile}`;
  }
}

/**
 * Read-only scrollable transcript overlay.
 *
 * Owns scroll state, chrome, and key handling; the rows it paints come from a
 * `TranscriptContent` collaborator, which holds the transcript's components and
 * refreshes them when the source changes (live agents).
 */
export class TranscriptOverlay implements Component {
  private scrollOffset = 0;
  private autoScroll = true;
  private unsubscribe: (() => void) | undefined;
  private closed = false;

  private readonly tui: TUI;
  private readonly theme: Theme;
  private readonly done: (result: undefined) => void;
  private readonly content: TranscriptContent;
  private readonly abort: (() => void) | undefined;
  /** Inner width the compositor last rendered at; input must use the same layout. */
  private renderedInnerWidth: number | undefined;

  constructor({ tui, theme, source, done, cwd, markdownTheme, abort }: TranscriptOverlayOptions) {
    this.tui = tui;
    this.theme = theme;
    this.done = done;
    this.abort = abort;
    this.content = new TranscriptContent({ tui, cwd, markdownTheme, source });
    this.unsubscribe = source.subscribe((event) => {
      if (this.closed) return;
      this.content.apply(event);
      this.tui.requestRender();
    });
  }

  handleInput(data: string): void {
    if (matchesKey(data, "escape") || matchesKey(data, "q")) {
      this.closed = true;
      this.done(undefined);
      return;
    }

    // Ctrl+C aborts the viewed agent and keeps the viewer open: the live
    // source settles the transcript into its stopped state.
    if (matchesKey(data, "ctrl+c")) {
      this.abort?.();
      return;
    }

    const totalLines = this.content.lineCount(this.inputWidth());
    const viewportHeight = this.viewportHeight();
    const maxScroll = Math.max(0, totalLines - viewportHeight);

    if (matchesKey(data, "up") || matchesKey(data, "k")) {
      this.scrollOffset = Math.max(0, this.scrollOffset - 1);
      this.autoScroll = this.scrollOffset >= maxScroll;
    } else if (matchesKey(data, "down") || matchesKey(data, "j")) {
      this.scrollOffset = Math.min(maxScroll, this.scrollOffset + 1);
      this.autoScroll = this.scrollOffset >= maxScroll;
    } else if (matchesKey(data, "pageUp") || matchesKey(data, "shift+up")) {
      this.scrollOffset = Math.max(0, this.scrollOffset - viewportHeight);
      this.autoScroll = false;
    } else if (matchesKey(data, "pageDown") || matchesKey(data, "shift+down")) {
      this.scrollOffset = Math.min(maxScroll, this.scrollOffset + viewportHeight);
      this.autoScroll = this.scrollOffset >= maxScroll;
    } else if (matchesKey(data, "home")) {
      this.scrollOffset = 0;
      this.autoScroll = false;
    } else if (matchesKey(data, "end")) {
      this.scrollOffset = maxScroll;
      this.autoScroll = true;
    }
  }

  render(width: number): string[] {
    if (width < 6) return [];
    const th = this.theme;
    const innerW = width - 4;
    this.renderedInnerWidth = innerW;
    const lines: string[] = [];

    const pad = (s: string, len: number): string => s + " ".repeat(Math.max(0, len - visibleWidth(s)));
    const row = (content: string): string =>
      th.fg("border", "│") + " " + truncateToWidth(pad(content, innerW), innerW) + " " + th.fg("border", "│");
    const hrTop = th.fg("border", `╭${"─".repeat(width - 2)}╮`);
    const hrBot = th.fg("border", `╰${"─".repeat(width - 2)}╯`);
    const hrMid = row(th.fg("dim", "─".repeat(innerW)));

    lines.push(hrTop);
    lines.push(row(th.bold("Subagent session")));
    lines.push(hrMid);

    const totalLines = this.content.lineCount(innerW);
    const viewportHeight = this.viewportHeight();
    const maxScroll = Math.max(0, totalLines - viewportHeight);
    if (this.autoScroll) this.scrollOffset = maxScroll;
    const visibleStart = Math.min(this.scrollOffset, maxScroll);
    const visible = this.content.slice(innerW, visibleStart, viewportHeight);
    for (let i = 0; i < viewportHeight; i++) lines.push(row(visible[i] ?? ""));

    lines.push(hrMid);
    const scrollPct =
      totalLines <= viewportHeight
        ? "100%"
        : `${Math.round(((visibleStart + viewportHeight) / totalLines) * 100)}%`;
    const footerLeft = th.fg("dim", `${totalLines} lines · ${scrollPct}`);
    const footerRight = th.fg(
      "dim",
      this.abort ? "↑↓ scroll · PgUp/PgDn · Ctrl+C abort · Esc close" : "↑↓ scroll · PgUp/PgDn · Esc close",
    );
    const footerGap = Math.max(1, innerW - visibleWidth(footerLeft) - visibleWidth(footerRight));
    lines.push(row(footerLeft + " ".repeat(footerGap) + footerRight));
    lines.push(hrBot);

    return lines;
  }

  // fallow-ignore-next-line unused-class-member
  invalidate(): void {
    this.content.invalidate();
  }

  dispose(): void {
    this.closed = true;
    if (this.unsubscribe) {
      this.unsubscribe();
      this.unsubscribe = undefined;
    }
  }

  // ---- Private ----

  /**
   * The width `handleInput` must lay out at: the one the compositor actually
   * supplied, so scroll bounds match the layout on screen. Before the first
   * paint there is none, so fall back to the overlay's share of the terminal.
   */
  private inputWidth(): number {
    return (
      this.renderedInnerWidth ??
      Math.max(0, Math.floor((this.tui.terminal.columns * OVERLAY_WIDTH_PCT) / 100) - 4)
    );
  }

  private viewportHeight(): number {
    const maxRows = Math.floor((this.tui.terminal.rows * VIEWPORT_HEIGHT_PCT) / 100);
    return Math.max(MIN_VIEWPORT, maxRows - CHROME_LINES);
  }
}
