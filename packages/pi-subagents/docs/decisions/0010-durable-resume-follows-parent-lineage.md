---
status: accepted
date: 2026-09-14
---

# 0010 — Durable resume follows the parent-session lineage

## Status

Accepted.
Extends [ADR 0002]: the workspace seam remains provider-owned, but it now persists enough opaque state to reconstruct an isolated workspace before reopening a child session.

## Context

Fork issue [#3] requires a subagent ID to remain resumable for its parent-session lineage.
A subagent ID originally named only a live `Subagent` object in the parent process.
Compaction left that object intact, but reopening the parent, switching sessions, or releasing the heavy child SDK session destroyed the only route back to the child JSONL transcript.
Worktree-backed agents had a second lifetime boundary because their checkout was removed at the end of a terminal run.

Pi's fork-owned session-global state can store one custom JSON object under an extension key and survives compaction, reopening, and continuation.
It deliberately does not roll back on `/tree`, however, so session identity alone cannot decide which subagent records belong to the active branch.

## Decision

### The parent session owns one authoritative durable registry

`@gotgenes/pi-subagents` stores a versioned registry in Pi's session-global state under its package key.
The in-process manager is an activated cache of that registry, not the source of truth.
Each record persists its original ID, observable state, exact child-session reopening specification, and optional provider-owned workspace checkpoint.

Fresh children record the parent's current leaf entry as their ancestry anchor.
On activation, an anchored record is visible only when that entry appears in the active `getBranch()` ancestry; a null anchor belongs to the session root.
Records and tombstones from sibling branches remain hidden but are preserved on every write.
Forked or cloned parent sessions inherit Pi's effective registry snapshot, while unrelated sessions begin without one.

Tree navigation settles children anchored after the common ancestor while the old leaf still owns their terminal effects.
Spawn and resume admission closes during that drain because a lifecycle subscriber can synchronously re-enter the public service.
Pi emits no completion event when a later extension cancels navigation, so admission reopens when preparation settles rather than waiting for `session_tree`.
After a successful leaf change, reconciliation silently settles any old-lineage child admitted in the intervening window, releases its live resources, and preserves its final record as a hidden sibling.
Shared-ancestor children retain their live object and continue without interruption.

### Child sessions reopen exactly and lazily

Resume first reconstructs any workspace and then opens the persisted child JSONL with `SessionManager.open()`.
The current runtime must reproduce the saved model, tool set, effective cwd, system prompt, session directory, file, and session ID.
A missing external artifact is `unavailable`; a schema, provider, model, or effective-configuration mismatch is `incompatible`.
Neither case silently creates a replacement child or assigns a new ID.

### Retention windows release memory, not handles

`consumedSessionRetentionMinutes` and `unconsumedSessionRetentionMinutes` govern only the live child SDK session.
The durable handle lasts for the parent-session lineage with no independent wall-clock TTL.
Deleting the parent session ends that lifetime.
Explicitly clearing a completed child disposes its durable workspace and leaves a lineage-scoped `deleted` tombstone so later callers receive a stable reason rather than `unknown-agent`.

### Workspace providers own reconstruction

A `WorkspaceProvider` has a stable ID and owns the JSON shape returned by `Workspace.suspend()`.
The core treats that state as opaque and models a workspace as live, suspended, or disposed.
Resume requires the provider with the matching ID and invokes `restore()` before reopening the child transcript.
Explicit deletion invokes terminal disposal; ordinary completion, errors, aborts, and process teardown suspend instead.

The worktree provider checkpoints a clean checkout's exact revision or commits dirty content to a rescue branch, removes the checkout, and recreates the same path at that revision on resume.
If a crash left the registered checkout live, restoration reuses it verbatim so uncommitted files are not reset.

## Consequences

- Parent compaction, continuation, reopening, and session switching preserve same-ID resume within the active ancestry.
- A sibling branch or unrelated parent cannot inspect, steer, delete, or resume another lineage's records.
- A transient `parent-transition` refusal keeps a reentrant resume retryable under the same ID, while branch reconciliation prevents lifecycle events, history entries, results, and notifications from crossing into a selected sibling.
- Durable registry size is bounded by the parent-session artifact's lifetime rather than an arbitrary expiry clock.
- Missing repositories, revisions, transcripts, or providers remain visible as stable fail-closed refusals.
- The provider contract is intentionally breaking because the old prepare/dispose bracket could not represent a resumable terminal state.
- Development and runtime require Jan's Pi fork API at `@earendil-works/pi-coding-agent` 0.85.1 or newer; the three Pi development packages link to the sibling `pi-mono` checkout until that API has a published source.

[#3]: https://github.com/janbam/pi-subagents/issues/3
[ADR 0002]: 0002-extensions-on-a-minimal-core.md
