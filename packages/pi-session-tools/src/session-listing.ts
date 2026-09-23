/**
 * session-listing.ts — Presentation for `list_session_files`.
 *
 * Owns the two strings the tool renders from a directory's session files:
 * the transcript-style text body the model reads, and the one-line phrase
 * the collapsed TUI row shows. Both are pure functions of the path list and
 * the true file total, so neither can disagree with the other.
 */

/** Cap applied to `list_session_files` when the caller passes no `limit`. */
export const DEFAULT_LIST_LIMIT = 10;

/**
 * Take the newest `limit` paths from a newest-first list.
 * A limit below zero yields none — left unclamped it would silently drop the
 * oldest few and list everything else.
 */
export function boundListingPaths(files: string[], limit: number): string[] {
  return files.slice(0, Math.max(0, limit));
}

/**
 * Text body: directory line, count line, one indented path per entry.
 * The count line always reports `total`, and names how many paths follow
 * whenever they are a subset of it.
 */
export function formatListingText(
  directory: string,
  paths: string[],
  total: number,
): string {
  const header = `Session directory: ${directory}`;
  if (total === 0) return `${header}\nNo session files found.`;
  const shownSuffix = paths.length < total ? ` (showing ${paths.length})` : "";
  const countLine = `${formatFileCount(total)}, newest first${shownSuffix}:`;
  return [header, countLine, ...paths.map((p) => `  ${p}`)].join("\n");
}

/** Collapsed TUI row phrase, without theme colouring or the expand hint. */
export function formatListingSummary(
  directory: string,
  shown: number,
  total: number,
): string {
  const shownPrefix = shown < total ? `${shown} of ` : "";
  return `${shownPrefix}${formatFileCount(total)} in ${directory}`;
}

function formatFileCount(total: number): string {
  return total === 1 ? "1 session file" : `${total} session files`;
}
