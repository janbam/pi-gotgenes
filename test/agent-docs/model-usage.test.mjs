import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import {
  accumulateLines,
  transcriptPaths,
  weekOf,
} from "../../scripts/agent-docs/model-usage.mjs";

/** One assistant message as Pi writes it to a transcript. */
function assistant(timestamp, model, totalTokens, costTotal = 0) {
  return JSON.stringify({
    type: "message",
    timestamp,
    message: {
      role: "assistant",
      model,
      usage: { totalTokens, cost: { total: costTotal } },
    },
  });
}

function sessionInfo(name) {
  return JSON.stringify({ type: "session_info", name });
}

function thinkingLevel(level) {
  return JSON.stringify({
    type: "thinking_level_change",
    thinkingLevel: level,
  });
}

/** Rows keyed on the four-part composite, made comparable with toEqual. */
function plain(rows) {
  return [...rows.entries()].map(([key, row]) => ({
    key: key.split("\u0000"),
    messages: row.messages,
    tokens: row.tokens,
    cost: row.cost,
    sessions: [...row.sessions].sort(),
  }));
}

describe("weekOf", () => {
  it("returns the Monday of the ISO week, in UTC", () => {
    // 2026-09-16 is a Wednesday.
    expect(weekOf("2026-09-16T23:51:49.100Z")).toBe("2026-09-14");
  });

  it("keeps a Monday on itself", () => {
    expect(weekOf("2026-09-14T00:00:00.000Z")).toBe("2026-09-14");
  });

  it("assigns a late-Sunday UTC timestamp to the week that is ending, not the one starting", () => {
    // 2026-09-13 is a Sunday. In any timezone east of UTC this is already
    // Monday, which is what a local-time implementation would report.
    expect(weekOf("2026-09-13T23:30:00.000Z")).toBe("2026-09-07");
  });
});

describe("accumulateLines", () => {
  describe("ordered attribution", () => {
    it("attributes each message to the stage in effect when it arrived", () => {
      const rows = new Map();
      accumulateLines(rows, "s1", [
        sessionInfo("#42 Planning — a title"),
        assistant("2026-09-16T10:00:00Z", "claude-opus-5", 100),
        sessionInfo("#42 TDD — a title"),
        assistant("2026-09-16T11:00:00Z", "claude-opus-5", 200),
      ]);

      expect(plain(rows)).toEqual([
        {
          key: ["2026-09-14", "claude-opus-5", "(default)", "Planning"],
          messages: 1,
          tokens: 100,
          cost: 0,
          sessions: ["s1"],
        },
        {
          key: ["2026-09-14", "claude-opus-5", "(default)", "TDD"],
          messages: 1,
          tokens: 200,
          cost: 0,
          sessions: ["s1"],
        },
      ]);
    });

    it("attributes each message to the thinking level in effect when it arrived", () => {
      const rows = new Map();
      accumulateLines(rows, "s1", [
        thinkingLevel("high"),
        assistant("2026-09-16T10:00:00Z", "claude-opus-5", 100),
        thinkingLevel("low"),
        assistant("2026-09-16T11:00:00Z", "claude-opus-5", 200),
      ]);

      expect(plain(rows).map((r) => [r.key[2], r.tokens])).toEqual([
        ["high", 100],
        ["low", 200],
      ]);
    });

    it("uses (unnamed) and (default) until a name or level appears", () => {
      const rows = new Map();
      accumulateLines(rows, "s1", [
        assistant("2026-09-16T10:00:00Z", "claude-opus-5", 100),
        sessionInfo("#42 Ship — a title"),
        thinkingLevel("high"),
        assistant("2026-09-16T11:00:00Z", "claude-opus-5", 200),
      ]);

      expect(plain(rows).map((r) => r.key.slice(2))).toEqual([
        ["(default)", "(unnamed)"],
        ["high", "Ship"],
      ]);
    });
  });

  describe("row aggregation", () => {
    it("sums messages, tokens, and cost into one row per week x model x level x stage", () => {
      const rows = new Map();
      accumulateLines(rows, "s1", [
        assistant("2026-09-16T10:00:00Z", "claude-opus-5", 100, 0.5),
        assistant("2026-09-17T10:00:00Z", "claude-opus-5", 300, 1.25),
      ]);

      expect(plain(rows)).toEqual([
        {
          key: ["2026-09-14", "claude-opus-5", "(default)", "(unnamed)"],
          messages: 2,
          tokens: 400,
          cost: 1.75,
          sessions: ["s1"],
        },
      ]);
    });

    it("counts distinct sessions across calls that share a row", () => {
      const rows = new Map();
      accumulateLines(rows, "s1", [assistant("2026-09-16T10:00:00Z", "m", 1)]);
      accumulateLines(rows, "s2", [assistant("2026-09-16T10:00:00Z", "m", 1)]);
      accumulateLines(rows, "s1", [assistant("2026-09-16T10:00:00Z", "m", 1)]);

      expect(plain(rows)[0].sessions).toEqual(["s1", "s2"]);
      expect(plain(rows)[0].messages).toBe(3);
    });
  });

  describe("entries it ignores", () => {
    it("skips user messages, unparseable lines, and messages without a model", () => {
      const rows = new Map();
      accumulateLines(rows, "s1", [
        JSON.stringify({
          type: "message",
          timestamp: "2026-09-16T10:00:00Z",
          message: { role: "user", content: '"assistant" said hi' },
        }),
        '{"type":"message","message":{"role":"assistant"', // truncated
        JSON.stringify({
          type: "message",
          timestamp: "2026-09-16T10:00:00Z",
          message: { role: "assistant", usage: { totalTokens: 5 } },
        }),
        "",
      ]);

      expect(rows.size).toBe(0);
    });

    it("leaves the stage alone for a session name outside the #N Stage — title convention", () => {
      const rows = new Map();
      accumulateLines(rows, "s1", [
        sessionInfo("Backlog triage — 2026-09-15"),
        assistant("2026-09-16T10:00:00Z", "m", 1),
      ]);

      expect(plain(rows)[0].key[3]).toBe("(unnamed)");
    });
  });
});

describe("transcriptPaths", () => {
  let sessionsDir;

  beforeEach(() => {
    sessionsDir = mkdtempSync(path.join(tmpdir(), "model-usage-"));
  });

  afterEach(() => {
    rmSync(sessionsDir, { recursive: true, force: true });
  });

  function store(name, files) {
    const dir = path.join(sessionsDir, name);
    mkdirSync(dir);
    for (const file of files) writeFileSync(path.join(dir, file), "");
  }

  it("lists .jsonl files from every store whose name starts with the prefix, sorted", () => {
    store("--repo--", ["b.jsonl", "a.jsonl", "notes.txt"]);
    store("--repo-worktrees-issue-1--", ["c.jsonl"]);
    store("--other-repo--", ["decoy.jsonl"]);

    expect(transcriptPaths({ sessionsDir, prefix: "--repo" })).toEqual([
      path.join(sessionsDir, "--repo--", "a.jsonl"),
      path.join(sessionsDir, "--repo--", "b.jsonl"),
      path.join(sessionsDir, "--repo-worktrees-issue-1--", "c.jsonl"),
    ]);
  });
});
