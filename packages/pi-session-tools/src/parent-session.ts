/**
 * parent-session.ts — Navigates the subagent session layout in both directions.
 *
 * Subagent sessions are stored at `<parent-dir>/<parent-basename>/tasks/<child>.jsonl`.
 * This module derives a child's parent session file from that convention, and a
 * session's subagent-transcripts directory from the same convention inverted.
 * Reading the files' entries is a generic concern owned by `session-file.ts`.
 */

import { basename, dirname, join } from "node:path";

/**
 * Derive the parent session file path from a subagent's session file.
 *
 * Returns undefined when the session file is not inside a `tasks/` directory
 * (i.e., the current session is not a subagent).
 */
export function deriveParentSessionFile(
  sessionFile: string | undefined,
): string | undefined {
  if (!sessionFile) return undefined;

  const tasksDir = dirname(sessionFile);
  if (basename(tasksDir) !== "tasks") return undefined;

  const parentBase = dirname(tasksDir);
  return `${parentBase}.jsonl`;
}

/**
 * Derive the directory holding a session's subagent transcripts.
 *
 * The inverse of `deriveParentSessionFile`: the directory nests under the
 * session file's own basename, so the same derivation applies at any depth.
 */
export function deriveSubagentSessionsDir(sessionFile: string): string {
  return join(dirname(sessionFile), basename(sessionFile, ".jsonl"), "tasks");
}
