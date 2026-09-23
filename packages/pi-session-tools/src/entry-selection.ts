/**
 * entry-selection.ts — Chooses which session entries a transcript renders.
 *
 * Everything that happens to an entry array before formatting lives here:
 * branch resolution, type filtering, phantom `model_change` pruning, and
 * windowing. Keeping the selection pure and separate from
 * `format-transcript.ts` lets the window be computed against the whole session
 * rather than against what a caller asked to see.
 */

import type { TranscriptEntry } from "./format-transcript.js";
import {
  BRANCH_MARKER_TYPE,
  type BranchMode,
  resolveBranches,
} from "./session-tree.js";

/** The bounds a transcript tool applies to a session's entries before rendering. */
export interface EntrySelection {
  /** Entry types to keep. When omitted, every type is kept. */
  types?: string[];
  /** How many of the most recent entries to skip. */
  offset?: number;
  /** How many entries to take, counting backward from the offset point. */
  limit?: number;
  /** Which branches to keep. When omitted, the entry tree is not consulted. */
  branches?: BranchMode;
  /** The live leaf, when the caller knows it. Otherwise the last entry is used. */
  leafId?: string | null;
}

/**
 * Resolve branches, filter by `types`, drop phantom `model_change` markers,
 * then window.
 * The returned array is exactly what the caller will see rendered, which is
 * why `limit` counts entries that survive pruning rather than raw entries.
 *
 * Branch resolution runs first because `filterByTypes` severs parent chains: a
 * `types: ["message"]` query drops the `model_change` that roots most sessions,
 * which would orphan everything below it.
 *
 * Pruning runs on the unwindowed array on purpose: `offset` lets a window end
 * short of the session's end, and a marker whose assistant turn sits one entry
 * past that edge is a real switch, not a phantom.
 */
export function selectEntries(
  entries: TranscriptEntry[],
  selection: EntrySelection,
): TranscriptEntry[] {
  const resolved = selection.branches
    ? resolveBranches(entries, {
        mode: selection.branches,
        leafId: selection.leafId,
      })
    : entries;
  const filtered = filterByTypes(resolved, selection.types);
  const pruned = prunePhantomModelChanges(filtered);
  return windowEntries(pruned, selection.offset, selection.limit);
}

/**
 * Keep the requested types, plus every branch marker.
 * A marker is not a session entry type, and the disclosure that a branch was
 * dropped must not itself be droppable — that would reproduce the silent
 * omission for exactly the type-filtered calls that read a transcript for
 * attribution.
 */
function filterByTypes(
  entries: TranscriptEntry[],
  types: string[] | undefined,
): TranscriptEntry[] {
  if (!types) return entries;
  const allowed = new Set(types);
  return entries.filter(
    (e) => allowed.has(e.type) || e.type === BRANCH_MARKER_TYPE,
  );
}

function prunePhantomModelChanges(
  entries: TranscriptEntry[],
): TranscriptEntry[] {
  const effective = collectEffectiveModelChangeIndices(entries);
  return entries.filter(
    (entry, index) => entry.type !== "model_change" || effective.has(index),
  );
}

/**
 * Take at most `limit` entries, ending `offset` entries from the most recent.
 * Both bounds clamp at zero, mirroring `boundListingPaths`: left unclamped, a
 * negative bound reads as an offset from the other end and silently returns
 * more entries than the caller asked for.
 */
function windowEntries(
  entries: TranscriptEntry[],
  offset: number | undefined,
  limit: number | undefined,
): TranscriptEntry[] {
  const end = Math.max(0, entries.length - Math.max(0, offset ?? 0));
  const start = limit == null ? 0 : Math.max(0, end - Math.max(0, limit));
  return entries.slice(start, end);
}

/**
 * Return the entry indices of `model_change` markers that took effect — a
 * switch followed by at least one assistant turn before the next switch (or
 * the end of entries).
 *
 * A phantom switch (cycling the TUI picker, or ending a session on a switch)
 * never produces a turn and is excluded.
 * Guard: when the stream contains no assistant messages at all (e.g. a
 * `types: ["model_change"]` filtered query), every marker is treated as
 * effective — there is no ground truth to validate against, and suppressing
 * all of them would hide the only signal the caller asked for.
 */
export function collectEffectiveModelChangeIndices(
  entries: TranscriptEntry[],
): Set<number> {
  const effective = new Set<number>();
  const modelChangeIndices: number[] = [];
  let pendingIndex: number | null = null;
  let sawAssistantMessage = false;

  for (const [index, entry] of entries.entries()) {
    if (entry.type === "model_change") {
      modelChangeIndices.push(index);
      pendingIndex = index;
      continue;
    }
    if (entry.type !== "message") continue;
    const msg = (entry as unknown as Record<string, unknown>).message as
      | Record<string, unknown>
      | undefined;
    if (msg?.role !== "assistant") continue;
    sawAssistantMessage = true;
    if (pendingIndex !== null) {
      effective.add(pendingIndex);
      pendingIndex = null;
    }
  }

  if (!sawAssistantMessage) return new Set(modelChangeIndices);
  return effective;
}
