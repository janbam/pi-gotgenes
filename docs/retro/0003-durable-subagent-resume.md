---
issue: 3
issue_title: "Keep subagents resumable across compaction and session continuation"
---

# Retro: #3 — Keep subagents resumable across compaction and session continuation

## Stage: Planning (2026-09-13T16:13:20Z)

### Session summary

Reconciled Jan's fork with upstream, traced the current resume, retention, child-session, and workspace lifecycles, and wrote `docs/plans/0003-durable-subagent-resume.md`.
The selected design uses Jan's Pi session-global JSON state as the authoritative parent registry, filters persisted records by parent branch ancestry, lazily reopens child JSONL sessions, and extends the workspace seam so worktree-backed children can checkpoint and restore rather than becoming a hidden exception.

### Observations

- The issue was filed in `janbam/pi-subagents`, while implementation lives in the `janbam/pi-gotgenes` fork; no upstream issue or pull request should be created.
- Pi's session-global state deliberately ignores `/tree`, so a session ID alone is insufficient for isolation; every record needs a spawn-leaf anchor checked against the active branch.
- The user's parent-session-lifetime decision changes existing retention windows from resume-expiry clocks into memory-release thresholds.
- Worktree restoration requires a third lifecycle state between live and disposed: suspended with a provider-owned checkpoint.
- A path-only worktree token would retain one checkout per completed agent; checkpointing the exact revision before removing the checkout bounds live resources and preserves coherent resume.
- Clean session switching must stop and settle active children before activating another parent's registry, or notifications and records can cross session boundaries.
- The Tidy-First assessor `ab29e9bb-ae68-4e7` was explicitly resumed after its first completion and retained its context and identity, directly exercising the workflow this issue protects.

#### Deferred tidyings

- Large-file decomposition in `subagent.ts` and `subagent-manager.ts` was rejected as unrelated cleanup; only boundaries directly needed by durable hydration should change.
- Generic persistence adapters, migration frameworks, and provider chains were rejected as speculative abstractions for one registry and one active workspace provider.

## Stage: Implementation — TDD (2026-09-14T01:09:45Z)

### Session summary

Implemented a session-global durable registry, active-branch ancestry filtering, lazy child-session reopening, stable tombstones and restoration failures, and resumable workspace checkpoints.
Extended the worktree provider to commit dirty terminal state, remove idle checkouts, reconstruct the same path and revision, and preserve crash-left live worktrees.
Reconciled the fork's transcript-viewer abort affordance with the upstream non-overlay pane, keeping the architectural boundary while restoring the user-visible action.

### Observations

- Separating fresh session allocation from shared child activation made persisted reopening a narrow factory change instead of a second assembly path.
- The manager must preserve hidden sibling records on every write because Pi's session-global state intentionally remains unchanged across `/tree` navigation.
- Workspace restoration must finish before `SessionManager.open()` so the persisted effective cwd exists when the child SDK session binds.
- A provider-owned opaque JSON checkpoint keeps Git policy out of the core while still allowing stable `unavailable` and `incompatible` refusals.
- Linking `pi-subagents-worktrees` to the local core requires its typecheck to build the core's ignored declaration bundle first on a clean checkout.
- One dynamic-import type assertion consistently consumed Vitest's per-test timeout after linking the fork SDK; a static namespace import moved module transformation outside the timed test without weakening the assertion.

## Stage: Pre-completion review (2026-09-14T09:34:59Z)

### Session summary

Completed three review-and-fix rounds with the same resumable reviewer `54cb1f7f-fbf8-452`.
The final review passed all six acceptance criteria after asynchronous parent-transition guards and live tombstone lineage filtering closed the two remaining sibling-visibility races.
The reviewer independently passed the complete repository suite at 6,867 tests, package and repository checks, lint, dead-code analysis, packed public types, and Mermaid rendering.

### Observations

- Registry projection alone cannot enforce branch privacy because Pi updates its live leaf before asynchronous `session_tree` handlers finish; records and tombstones must both consult the live ancestry at every public lookup.
- Session and workspace restoration are preflight work, not resumed execution; navigation waits for the preflight, then the manager revalidates lineage before permitting a turn.
- A workspace reconstructed before a child JSONL reopen failure must be suspended again immediately so no live checkout remains without an owning turn.
- Process-global child lifecycle registration requires balanced `session-created` and `disposed` events even when parent-facing events are suppressed after a branch change.
- Mutation checks proved the new race tests fail when live record filtering, post-restore revalidation, workspace resuspension, session-switch waiting, or tombstone filtering is removed.
