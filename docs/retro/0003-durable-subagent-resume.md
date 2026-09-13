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
