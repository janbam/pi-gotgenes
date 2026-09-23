#!/usr/bin/env node
// Which models read this repo's agent documentation, and when.
//
// Reads the local Pi session transcripts for this checkout and every worktree,
// and rolls each assistant message up by week x model x thinking level x
// workflow stage. Only aggregate counts are emitted — never message content.
//
// Entries are walked in order, so a message is attributed to the session name
// and thinking level *in effect at that moment*. Taking the last name in the
// file instead would credit a renamed or resumed session's whole history to
// whatever stage it ended as.
//
// The store is machine-local, unversioned, and prunable, and it begins when Pi
// first ran here — so commit each run's CSV as a snapshot rather than assuming
// this can be re-derived later.
//
// Usage: node scripts/agent-docs/model-usage.mjs [--sessions-dir DIR] [--prefix NAME]

import { readdirSync, readFileSync } from "node:fs";
import { homedir } from "node:os";
import { basename, join } from "node:path";
import { fileURLToPath } from "node:url";

// Pi encodes a session store's directory name from the cwd it was launched in.
const DEFAULT_SESSIONS_DIR = join(homedir(), ".pi", "agent", "sessions");
const DEFAULT_PREFIX = "--Users-chris-development-pi-pi-packages";
// Session names follow the AGENTS.md convention: "#865 Planning — <title>".
const STAGE_PATTERN = /^#(\d+)\s+([^—]+?)\s+—/;
const UNNAMED = "(unnamed)";
const DEFAULT_THINKING = "(default)";

export function parseArgs(argv) {
  const options = { sessionsDir: DEFAULT_SESSIONS_DIR, prefix: DEFAULT_PREFIX };
  for (let i = 0; i < argv.length; i += 2) {
    const value = argv[i + 1];
    if (argv[i] === "--sessions-dir") options.sessionsDir = value;
    else if (argv[i] === "--prefix") options.prefix = value;
    else throw new Error(`unknown option: ${argv[i]}`);
  }
  return options;
}

export function transcriptPaths({ sessionsDir, prefix }) {
  return readdirSync(sessionsDir)
    .filter((name) => name.startsWith(prefix))
    .flatMap((name) => {
      const dir = join(sessionsDir, name);
      return readdirSync(dir)
        .filter((file) => file.endsWith(".jsonl"))
        .map((file) => join(dir, file));
    })
    .sort();
}

export function weekOf(timestamp) {
  const date = new Date(timestamp);
  const monday = new Date(date);
  monday.setUTCDate(date.getUTCDate() - ((date.getUTCDay() + 6) % 7));
  return monday.toISOString().slice(0, 10);
}

/**
 * Fold one transcript's entries into the aggregate, in order.
 *
 * The stage and thinking level in effect when a message arrives are the ones
 * it is attributed to, so a rename or level change mid-transcript splits the
 * transcript's messages across rows rather than crediting them all to the
 * final state.
 *
 * @param {Map<string, {messages: number, tokens: number, cost: number, sessions: Set<string>}>} rows
 * @param {string} sessionId
 * @param {Iterable<string>} lines JSONL entries, one per line
 */
export function accumulateLines(rows, sessionId, lines) {
  let thinking = DEFAULT_THINKING;
  let stage = UNNAMED;

  for (const line of lines) {
    // Cheap pre-filter: transcripts are large and mostly tool payloads.
    if (
      !line.includes('"assistant"') &&
      !line.includes('"thinking_level_change"') &&
      !line.includes('"session_info"')
    ) {
      continue;
    }
    let entry;
    try {
      entry = JSON.parse(line);
    } catch {
      continue;
    }

    if (entry.type === "thinking_level_change") {
      thinking = entry.thinkingLevel ?? thinking;
      continue;
    }
    if (entry.type === "session_info") {
      const match = STAGE_PATTERN.exec(entry.name ?? "");
      if (match) stage = match[2].trim();
      continue;
    }
    if (entry.type !== "message" || entry.message?.role !== "assistant")
      continue;

    const { model, usage } = entry.message;
    if (!model || !entry.timestamp) continue;

    const key = [weekOf(entry.timestamp), model, thinking, stage].join(
      "\u0000",
    );
    const row = rows.get(key) ?? {
      messages: 0,
      tokens: 0,
      cost: 0,
      sessions: new Set(),
    };
    row.messages += 1;
    row.tokens += usage?.totalTokens ?? 0;
    row.cost += usage?.cost?.total ?? 0;
    row.sessions.add(sessionId);
    rows.set(key, row);
  }
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const options = parseArgs(process.argv.slice(2));
  const rows = new Map();
  for (const path of transcriptPaths(options)) {
    const sessionId = basename(path)
      .split("_")
      .pop()
      .replace(/\.jsonl$/, "");
    accumulateLines(rows, sessionId, readFileSync(path, "utf8").split("\n"));
  }

  process.stdout.write(
    "week,model,thinking_level,stage,sessions,messages,tokens,cost_usd\n",
  );
  for (const key of [...rows.keys()].sort()) {
    const row = rows.get(key);
    const cells = key.split("\u0000").join(",");
    process.stdout.write(
      `${cells},${row.sessions.size},${row.messages},${row.tokens},${row.cost.toFixed(2)}\n`,
    );
  }
}
