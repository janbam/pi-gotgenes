---
issue: 3
issue_title: "Keep subagents resumable across compaction and session continuation"
---

# Durable subagent resume

## Release Recommendation

**Release:** ship independently

This is a user-visible resumability feature spanning `pi-subagents` and `pi-subagents-worktrees`.
It should ship as one coordinated release because either package alone leaves the guarantee incomplete.

## Problem Statement

`SubagentManager` currently treats its process-local `Map` as the registry of record.
`session_start` and `session_before_switch` delete terminal records, the retention sweep permanently disposes child sessions, and shutdown empties the manager.
The persisted child JSONL transcript survives, but no durable parent-owned record maps the original subagent ID to that transcript or preserves the effective configuration needed to reopen it.

This makes a valid ID unusable after parent compaction, session reopening, or a switch away and back.
It also makes the current workspace-backed resume contract process-local: the worktree is represented only by an in-memory `Workspace` object.

## Outcome

- A subagent ID identifies one durable child conversation for the lifetime of its parent-session lineage.
- Parent compaction does not affect resumability.
- Reopening a parent session or switching away and back restores discovery and resumes the same child JSONL with the same ID.
- A derived parent branch sees only records anchored on its active ancestry.
- Worktree-backed children checkpoint their workspace when suspended and restore it before resuming.
- Existing retention windows release live SDK objects only; they never invalidate a durable handle.
- Missing artifacts return `unavailable`; unsupported persisted schema, model, runtime, or workspace provider state returns `incompatible`.

## Non-Goals

- No automatic durable TTL while the parent session exists.
- No compatibility layer for records created before this feature.
- No workspace-provider chain or generic persistence framework.
- No UI for independently deleting one durable subagent record.
- No change to ordinary spawn, steering, result delivery, notification, or concurrency semantics beyond what session deactivation requires.
- No upstream issue, pull request, or repository mutation; this change belongs to Jan's forks.

## Decisions

### Registry ownership and lineage

The parent session-global state value under `@gotgenes/pi-subagents` is authoritative.
The in-memory manager map is an activated cache for the currently selected parent session.

Each persisted record stores the parent conversation leaf ID visible at spawn.
On activation, a record is visible only when its anchor is `null` or its anchor ID occurs in `sessionManager.getBranch()`.
This makes `/tree` filtering explicit, lets forks and clones inherit ancestor records, and keeps sibling-only records hidden even though session-global state itself does not roll back.
An unrelated session starts with no registry and therefore cannot enumerate or resume another session's records.

### Lifetime and cleanup

The existing consumed and unconsumed retention windows become memory-release thresholds.
They close a terminal child's live `AgentSession`, but preserve its record, transcript path, effective resume specification, and suspended workspace token.

Durable records live with the parent-session lineage.
Deleting that parent session ends the access contract; this feature does not invent a clock that silently invalidates an otherwise valid continuation.
External deletion of a child transcript or workspace checkpoint is reported as `unavailable` rather than disguised as an unknown ID.

### Child session reopening

Fresh creation and reopening share one activation pipeline for resources, model runtime, tools, recursion exclusion, lifecycle publication, extension binding, and teardown.
Fresh creation allocates a new `SessionManager`; reopening calls `SessionManager.open(outputFile)`.

The persisted resume specification stores effective values, not mutable source configuration: effective cwd, exact provider/model IDs, thinking level, system prompt, tool allowlist, per-agent turn limit, parent context, session directory, and child identity.
Reopening resolves the exact model through the current registry and fails closed when it is unavailable.

### Interrupted children

Session switching and orderly shutdown stop active children, wait for their transcript writes to settle, persist their final state, suspend resumable workspaces, and release SDK objects before deactivating the manager.
An active record recovered after an unclean process exit is normalized to `stopped`, with active-tool and partial-response presentation cleared, while retaining its transcript and resume specification.
Transient carrier claims and pending steer buffers never persist.

### Resumable workspaces

`WorkspaceProvider` gains a stable provider ID and a restore operation.
`Workspace` gains a suspension operation distinct from terminal disposal.
Suspension returns provider-owned JSON state and an optional result addendum; restoration receives only state produced by the matching provider ID.

The worktree provider checkpoints the exact current revision, commits dirty work to a rescue branch, removes the live checkout, and returns a token containing the repository root and revision.
Restoration creates a fresh detached worktree at that revision and registers it as live.
Missing repositories, revisions, or providers fail closed; the core never falls back to the parent cwd.

## Module-Level Changes

### `pi-subagents`

- `src/lifecycle/create-subagent-session.ts` — first separate fresh allocation from shared activation; then add exact-spec reopening through `SessionManager.open`.
- `src/lifecycle/subagent-session.ts` — expose the immutable resume specification needed for persistence.
- `src/lifecycle/subagent-persistence.ts` — own the versioned registry schema, defensive parsing, lineage filtering, and session-global reads/writes.
- `src/lifecycle/subagent-state.ts` — export a durable snapshot and normalize interrupted live state during hydration.
- `src/lifecycle/subagent.ts` — distinguish fresh and hydrated construction, lazy session/workspace restoration, suspension, and stable refusal facts.
- `src/lifecycle/subagent-manager.ts` — activate/deactivate parent registries, persist lifecycle transitions, lazily reopen before resume, and make retention release memory-only.
- `src/lifecycle/workspace.ts` and `workspace-bracket.ts` — define and own prepare/suspend/restore/dispose without leaking provider state into core policy.
- `src/handlers/lifecycle.ts`, `src/runtime.ts`, `src/types.ts`, and `src/index.ts` — capture parent branch anchors, wire session-state storage and `SessionManager.open`, and order switch/shutdown deactivation safely.
- `src/tools/agent-tool.ts`, `src/tools/get-result-tool.ts`, and `src/observation/outcome-delivery.ts` — replace process-loss wording with stable `unavailable` and `incompatible` responses.
- Existing focused tests gain state, lineage, lifecycle, refusal, and reopening cases; a process-boundary integration test proves persisted activation with the real session manager.

### `pi-subagents-worktrees`

- `src/workspace-provider.ts` and `src/worktree.ts` — checkpoint and restore worktrees through provider-owned JSON state.
- `src/index.ts` — register the resumable provider without changing load-order behavior.
- Existing provider, worktree, and composition tests prove clean and dirty checkpoint round trips plus fail-closed restoration.
- `package.json` and `pnpm-lock.yaml` adopt the core version exposing the resumable workspace contract.

### Documentation and dependency surface

- Both package READMEs and `packages/pi-subagents/docs/configuration.md` describe durable IDs, lineage, memory-only retention, and workspace restoration failures.
- `packages/pi-subagents/docs/architecture/architecture.md` records the authoritative registry and activation lifecycle.
- A focused ADR records session-global registry ownership, ancestry filtering, and the suspend/restore workspace contract.
- `pi-subagents` develops against Pi `0.85.1`, the first fork version exposing session-global state; local validation links the three Pi packages from `/home/jan/src/pi-mono` without committing machine-specific paths.

## TDD Order

1. `refactor(pi-subagents): separate child-session activation from fresh-session creation` — extract the shared activation pipeline while keeping focused factory tests green.
2. `test(pi-subagents): specify durable registry lineage` — add red tests for schema validation, root/ancestor visibility, sibling hiding, unrelated-session absence, and interrupted-state normalization.
3. `feat(pi-subagents): persist parent-scoped subagent records` — implement session-global registry snapshots and state serialization.
4. `test(pi-subagents): specify child session reopening` — add red tests for exact effective metadata, `SessionManager.open`, missing transcript, and unavailable model behavior.
5. `feat(pi-subagents): reopen retained child sessions` — implement lazy child activation and replace session-release refusal semantics.
6. `test(pi-subagents): specify session deactivation` — add red lifecycle tests for switch/shutdown stop, settle, persist, suspend, release, and incoming activation order.
7. `feat(pi-subagents): preserve agents across parent sessions` — wire activation/deactivation and stable refusal wording.
8. `test(pi-subagents): specify resumable workspaces` — add red core contract tests for provider identity, checkpoint persistence, restore, and fail-closed mismatches.
9. `feat(pi-subagents): add resumable workspace lifecycle` — implement the public suspend/restore contract and lazy restoration.
10. `test(pi-subagents-worktrees): specify worktree checkpoint round trips` — add red clean, dirty, missing-revision, and provider-state tests.
11. `feat(pi-subagents-worktrees): restore suspended worktrees` — checkpoint exact revisions, remove live checkouts, and recreate them for resume.
12. `test(pi-subagents): prove durable resume end to end` — exercise complete → retention release → reopen → same-ID resume, switch away/back, compaction-stable state, ancestor-only continuation, and unrelated-session denial.
13. `feat(pi-subagents): restore sessions-viewer abort action` — adapt the fork's pre-reconciliation Ctrl+C abort feature to the current non-overlay transcript pane without restoring the rejected overlay architecture.
14. `docs: document durable subagent resume` — update current-behavior docs and add the ADR.

Every step leaves its affected package green.
Preparatory step 1 follows the Tidy-First assessor's only recommended extraction; test fixture extensions land with the first feature test that uses them.

## Proof

- `pnpm --filter @gotgenes/pi-subagents exec vitest run <focused files>` after each core step.
- `pnpm --filter @gotgenes/pi-subagents-worktrees exec vitest run <focused files>` after each worktree step.
- `pnpm --filter @gotgenes/pi-subagents run check`
- `pnpm --filter @gotgenes/pi-subagents run lint`
- `pnpm --filter @gotgenes/pi-subagents run test`
- `pnpm --filter @gotgenes/pi-subagents-worktrees run check`
- `pnpm --filter @gotgenes/pi-subagents-worktrees run lint`
- `pnpm --filter @gotgenes/pi-subagents-worktrees run test`
- `pnpm fallow dead-code`
- `pnpm run check`
- `pnpm run lint`
- `pnpm run test`

The completion audit maps every issue acceptance criterion to a focused test and reruns the pre-completion reviewer on the same resumable reviewer ID if it finds defects.
