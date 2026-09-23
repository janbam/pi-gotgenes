/**
 * session-tree.ts — Reads a session's entries as the tree Pi writes, not the
 * flat list they are stored as.
 *
 * Every session entry carries an `id` and a `parentId`, so rewinding the
 * conversation makes the next entry a second child of an earlier one. The
 * *live path* is the walk from the leaf back to the root; everything else
 * belongs to a branch that was abandoned. This module owns that walk and
 * marks what it leaves out, so no other module has to know the file is a tree.
 *
 * The walk reproduces Pi's own `buildSessionPath`: the leaf is the caller's
 * when it knows one, and otherwise the last entry in the file — which is the
 * leaf Pi itself resumes into, since `SessionManager` assigns it while
 * indexing every entry in order.
 */

import type { TranscriptEntry } from "./format-transcript.js";

/** Which branches of a session's entry tree a transcript renders. */
export type BranchMode = "live" | "all";

/**
 * Entry type of a synthetic marker. Never present in a session file, and
 * chosen to collide with none of the SDK's `SessionEntry` variants.
 */
export const BRANCH_MARKER_TYPE = "branch_marker";

/** A marker standing in for, or bracketing, a run of abandoned entries. */
export type BranchMarkerEntry =
  | { type: typeof BRANCH_MARKER_TYPE; marker: "omitted"; count: number }
  | {
      type: typeof BRANCH_MARKER_TYPE;
      marker: "abandoned_begin";
      count: number;
    }
  | { type: typeof BRANCH_MARKER_TYPE; marker: "abandoned_end" };

/** Which branches to keep, and the leaf to measure them against. */
export interface BranchResolution {
  mode: BranchMode;
  /** The live leaf. Omit to use the last entry, as Pi does when loading a file. */
  leafId?: string | null;
}

/**
 * Rewrite an entry array so that abandoned branches are marked rather than
 * silently interleaved.
 *
 * In `"live"` mode each maximal run of abandoned entries is replaced by one
 * `omitted` marker; in `"all"` mode each run is bracketed by `abandoned_begin`
 * and `abandoned_end`. An array with no resolvable tree — no ids, or a leaf
 * that names nothing — is returned unchanged, since nothing in it can be shown
 * to be abandoned.
 */
export function resolveBranches(
  entries: TranscriptEntry[],
  resolution: BranchResolution,
): TranscriptEntry[] {
  const abandoned = collectAbandonedIds(entries, resolution.leafId);
  if (abandoned.size === 0) return entries;
  return resolution.mode === "all"
    ? bracketAbandonedRuns(entries, abandoned)
    : replaceAbandonedRuns(entries, abandoned);
}

/**
 * Ids of entries that are not ancestors of the leaf.
 *
 * An entry without a string `id` is never abandoned: it cannot be shown to be
 * off the live path, so it is kept.
 */
function collectAbandonedIds(
  entries: TranscriptEntry[],
  leafId: string | null | undefined,
): Set<string> {
  const byId = new Map<string, TranscriptEntry>();
  for (const entry of entries) {
    const id = entryId(entry);
    if (id !== undefined) byId.set(id, entry);
  }

  const startId = leafId ?? entryId(entries[entries.length - 1]);
  if (startId === undefined || !byId.has(startId)) return new Set();

  const live = collectLivePathIds(byId, startId);

  const abandoned = new Set<string>();
  for (const entry of entries) {
    const id = entryId(entry);
    if (id !== undefined && !live.has(id)) abandoned.add(id);
  }
  return abandoned;
}

/**
 * Walk `parentId` from the leaf to the root.
 * Stops at a self-parent and at a repeat visit, both of which Pi's own
 * `getTree` tolerates in a hand-edited or migrated file.
 */
function collectLivePathIds(
  byId: Map<string, TranscriptEntry>,
  startId: string,
): Set<string> {
  const live = new Set<string>();
  let current = byId.get(startId);
  while (current !== undefined) {
    const id = entryId(current);
    if (id === undefined || live.has(id)) break;
    live.add(id);
    const parent = parentId(current);
    if (parent === undefined || parent === id) break;
    current = byId.get(parent);
  }
  return live;
}

/** Replace each run of abandoned entries with one `omitted` marker. */
function replaceAbandonedRuns(
  entries: TranscriptEntry[],
  abandoned: Set<string>,
): TranscriptEntry[] {
  const resolved: TranscriptEntry[] = [];
  let run = 0;
  for (const entry of entries) {
    if (isAbandoned(entry, abandoned)) {
      run++;
      continue;
    }
    if (run > 0) {
      resolved.push(omittedMarker(run));
      run = 0;
    }
    resolved.push(entry);
  }
  if (run > 0) resolved.push(omittedMarker(run));
  return resolved;
}

/** Bracket each run of abandoned entries with begin/end markers. */
function bracketAbandonedRuns(
  entries: TranscriptEntry[],
  abandoned: Set<string>,
): TranscriptEntry[] {
  const resolved: TranscriptEntry[] = [];
  let index = 0;
  while (index < entries.length) {
    const entry = entries[index];
    if (!isAbandoned(entry, abandoned)) {
      resolved.push(entry);
      index++;
      continue;
    }
    let runEnd = index;
    while (runEnd < entries.length && isAbandoned(entries[runEnd], abandoned)) {
      runEnd++;
    }
    resolved.push(
      abandonedBeginMarker(runEnd - index),
      ...entries.slice(index, runEnd),
      abandonedEndMarker(),
    );
    index = runEnd;
  }
  return resolved;
}

function isAbandoned(entry: TranscriptEntry, abandoned: Set<string>): boolean {
  const id = entryId(entry);
  return id !== undefined && abandoned.has(id);
}

function omittedMarker(count: number): BranchMarkerEntry {
  return { type: BRANCH_MARKER_TYPE, marker: "omitted", count };
}

function abandonedBeginMarker(count: number): BranchMarkerEntry {
  return { type: BRANCH_MARKER_TYPE, marker: "abandoned_begin", count };
}

function abandonedEndMarker(): BranchMarkerEntry {
  return { type: BRANCH_MARKER_TYPE, marker: "abandoned_end" };
}

function entryId(entry: TranscriptEntry | undefined): string | undefined {
  return stringField(entry, "id");
}

function parentId(entry: TranscriptEntry | undefined): string | undefined {
  return stringField(entry, "parentId");
}

function stringField(
  entry: TranscriptEntry | undefined,
  field: string,
): string | undefined {
  const value = (entry as unknown as Record<string, unknown> | undefined)?.[
    field
  ];
  return typeof value === "string" ? value : undefined;
}
