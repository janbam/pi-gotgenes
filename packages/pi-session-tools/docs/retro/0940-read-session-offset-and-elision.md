---
issue: 940
issue_title: "read_session has no offset: attributing early turns in a long session re-renders the whole tail"
---

# Retro: #940 — read_session has no offset: attributing early turns in a long session re-renders the whole tail

## Stage: Planning (2026-09-19T07:54:30Z)

### Session summary

Planned `packages/pi-session-tools/docs/plans/0940-read-session-offset-and-elision.md`: a new pure `src/entry-selection.ts` owning type filtering, phantom `model_change` pruning, and a clamped `offset`/`limit` window, plus an `elide_user_text` rendering option and `session_info` rendering, across seven TDD steps.
The operator's gate settled three things: build both capabilities from the issue (not one), fold in the newly-found `session_info` rendering gap, and close [#950] in the same pass since `offset` rewrites the exact slice it reports.
The Tidy-First assessor contributed one Recommended preparatory step — relocating `collectEffectiveModelChangeIndices` before the behavior change — which leads the TDD Order.

### Observations

- **Measured before framing the gate.**
  Ran the package's own `formatTranscript` over the real #934 session (246 entries) rather than reasoning about cost: 99,905 rendered chars full; 78,001 for the three calls `/retro` actually made; ~34,000 for the same coverage paged with `offset`; 53,377 for all 246 entries with user bodies elided.
  That showed the two proposals are complementary rather than alternatives — `offset` flattens the re-read, elision flattens the per-entry cost — which is what turned "either would do" into "both, sequenced".
- **The issue's own fix would have broken its own use case.**
  Eliding user bodies destroys stage attribution, because stage boundaries are only visible in the user-message text — `formatMetadataEntry` drops `session_info` entries on its `default:` arm.
  The measured session carries four such entries naming `#934 Ship` and `#934 Retrospective`.
  Rendering them (+309 chars, 0.3%) is what makes elision non-lossy rather than merely cheaper; it became the third goal.
- **Pruning order is the design's load-bearing decision.**
  `collectEffectiveModelChangeIndices` reads "end of array" as "no turn followed", which is only sound because `limit` always yields a suffix.
  With `offset` the window ends mid-session, so an in-window suppression pass would silently drop a real model switch at the trailing edge — for the one reader whose job is noticing model switches.
  Pruning on the unwindowed array removes the failure mode structurally; the cost is that `formatTranscript` and `summarizeEntries` both get simpler, and five test cases move layers.
- **Two observable output changes were classified rather than hidden.**
  Non-breaking (no default, name, or result shape changes), but an unparameterized `read_session` call does render four new `[session]` lines and report `241 entries` instead of `246` on the measured session.
  Both are written into Goals with their measured magnitudes.
- **Conventions confirmed against the repo, not assumed.**
  Multi-word tool params are snake_case here (`run_in_background`, `expected_sha`), so `elide_user_text`; "elide" is already this repo's word for a budget-driven omission (`pi-permission-system`); `Math.max(0, …)` mirrors [#916]'s `boundListingPaths`; `TNumberOptions.minimum` verified in the pinned typebox 1.1.38.
- **Rejected: a shared entries fixture across the three tool tests** (the assessor's one Optional item).
  The three deliver entries through structurally different seams (`sessionManager.getEntries()` vs. a mocked `node:fs`), and moving the windowing matrix into `entry-selection.test.ts` drops each file to 2-3 new cases — under the threshold where the duplication would justify the abstraction risk.
- **Nothing was filed as a follow-up.**
  Both Open Questions (eliding assistant prose; a session-size probe) are deferred deliberately without an issue — neither is concretely named deferred work, and filing them now would be speculative.

## Stage: Implementation — TDD (2026-09-19T08:24:22Z)

### Session summary

Executed all seven TDD steps from the plan, each as its own commit leaving the tree green: the preparatory move of `collectEffectiveModelChangeIndices`, the new `selectEntries` pipeline, the wiring that closes [#950], `offset`, `session_info` rendering, `elide_user_text`, and the docs.
Test count in `pi-session-tools` grew from 144 to 183 across 12 files (up from 10).
Pre-completion reviewer: WARN — no FAILs.

### Observations

- **The planned `offset` tool tests were green during Red, and the planned killing mutation could not have reddened them.**
  A tool test calls `execute` directly, so it never sees the declared TypeBox schema; `buildTranscriptResult` already forwarded the whole `params` bag to `selectEntries`, so `offset` worked the moment the pipeline landed.
  Step 4's mutation ("drop `offset` from `read_parent_session`'s `Type.Object`") would have left every test green.
  Added `test/transcript-tool-parameters.test.ts`, which reads each captured tool's `parameters.properties` — the only assertions in the package that see a declared schema at all.
  The mutation then killed exactly the `read_parent_session` case and nothing else.
- **Deviation: `test/helpers/capture-tools.ts` changed**, which the plan listed as a predicted-unchanged file.
  Its reasoning covered `execute` only; the new tests also reach `renderCall` and `parameters`, so `CapturedTool` gained both.
  The prediction was falsifiable and got falsified, which is the point of listing it.
- **Deviation: three `entry-summary.test.ts` phantom-count tests were deleted rather than moved.**
  As raw-count tests they would have duplicated cases already in `entry-selection.test.ts` at two layers.
  The reviewer traced each and confirmed no claim lost its only pin.
- **Step 1's mutation killed 2 of 6 tests where the plan predicted all six.**
  Four of the moved tests have identical expected values under both branches for their inputs (empty array, a single effective marker, interleaved switches, and the zero-assistant guard itself), so only two can discriminate.
  The plan's prediction was over-broad, not the tests.
- **A measured baseline that looked like drift was a unit mismatch.**
  Planning recorded 99,905 rendered chars; the re-measured baseline read 100,938.
  The first is JS code units, the second `wc -c` bytes, and the file holds em-dashes and arrows — the same render.
  The step-5 verification that mattered was the byte diff, which showed exactly four inserted `[session] → …` lines and nothing else.
- **Reordering pruning ahead of windowing turned out to fix a second defect the plan did not claim.**
  The reviewer's re-derivation found that the old in-window zero-assistant guard could misclassify a genuinely phantom trailing marker as effective whenever a small `limit` happened to slice off every assistant turn.
  Evaluating the guard on the full type-filtered array is strictly more correct.
  Unpinned by a test; recorded here rather than expanded into scope.
- **Reviewer warnings:** the plan's two Open Questions (eliding assistant prose; a session-size probe) remain deliberately unfiled — confirm that disposition still holds at ship time.

## Stage: Sync (worktree) (2026-09-19T15:07:50Z)

### Session summary

`pnpm run lint` and `pnpm fallow dead-code` both pass clean from the worktree root.
The plan (`packages/pi-session-tools/docs/plans/0940-read-session-offset-and-elision.md`) marks `**Release:** ship independently` — no architecture roadmap governs this package, so nothing to check at land time on that front.
The two Open Questions the TDD-stage reviewer flagged (eliding assistant prose; a session-size probe) are still unfiled by design; confirm that disposition at `/ship`.

**Peer session transcript:** `/Users/chris/.pi/agent/sessions/--Users-chris-development-pi-pi-packages-worktrees-issue-940--/2026-09-19T07-25-29-859Z_01a0b88e-5182-7717-8089-b7977c26dc3e.jsonl` — read with `read_session_file({ path: "<path>" })` for message-level verification at land/retro time.

### Observations

No new friction since the TDD stage note (commit `docs(retro): add TDD stage notes for issue #940`).
Branch is otherwise ready to rebase onto local `main` and hand off.

**Re-run (2026-09-19T15:11:34Z):** local `main` unchanged since the first sync (`git rev-list --count main..origin/main` reports 0), so this is a no-op re-check.
`pnpm run lint` and `pnpm fallow dead-code` still pass clean.
No new commits since `docs(retro): add sync stage notes for issue #940`.

## Stage: Final Retrospective (2026-09-19T15:21:43Z)

### Session summary

Shipped #940 through the worktree lane: fast-forward-merged the peer branch, ran both pre-push gates on the merged tree, pushed, verified CI green, closed #940 and the co-shipped [#950], dispatched and verified the release of `pi-session-tools-v2.2.0`, and tore down the worktree.
The ship ran end to end with no corrections, no rework, and no follow-up commits.
The retrospective's own model-attribution lens then became the session's one friction point — it is instructed to use the `offset` and `elide_user_text` parameters this issue shipped, which the session's running copy of the extension predates.

### Observations

#### What went well

- **The retro file earned its keep as the ship-time close-target source.**
  `/ship` step 2 reads the plan and retro in full before any irreversible action; the planning stage note named [#950] ("close [#950] in the same pass since `offset` rewrites the exact slice it reports") well before the commit-range grep independently surfaced it.
  A step that only grepped the plan for `**Release:**` would have shipped the `limit: 0` fix and left [#950] open.
- **An unpushed root commit on `main` was absorbed rather than breaking the ff-merge.**
  `git rev-list --count origin/main..main` reported 1 — `b0cea285 docs(pi-permission-system): disposition #952 against Phase 15`, committed to the root while a worktree branch was pending, which the `worktrees` skill names as the sharper hazard.
  It was harmless because `/sync-worktree` rebases onto **local** `main`, not `origin/main`: `PRE_MERGE` resolved to exactly that commit and `git merge-base --is-ancestor main "$BRANCH"` predicted the fast-forward correctly.
  The design absorbed an operator slip that the earlier `origin/main` formulation would have turned into a peer round-trip.
- **Every SHA in both close comments was resolved and ancestor-checked before publishing.**
  Four commits (`93d1653a`, `39a4104f`, `d0302df2`, `006d8f7f`) went through `git rev-parse <sha>^{commit}` and `git merge-base --is-ancestor <sha> main` in one batch, and the landing commit was chosen as the one fixing the issue's **title** defect (`offset`), not the newest or largest in range.

#### What caused friction (agent side)

- `missing-context` — **the retrospective's model-attribution lens used the parameters this session had just shipped, on a copy of the extension that predates them.**
  `.pi/prompts/retro.md` lens 1 now recommends paging with `offset` and setting `elide_user_text: true` (Refs #940, added by this very issue's docs step).
  Pi loads each extension once at session start, and this session started before the ff-merge, so the running `read_session_file` is the pre-#940 build.
  Both parameters were **silently ignored** rather than rejected: `{ offset: 5, limit: 3 }` returned the trailing three entries, and `{ elide_user_text: true }` rendered every user-prompt body in full.
  `AGENTS.md` § Stale in-process extension code carries the general rule, but its worked case is a *removed* tool, which fails loudly; an *added parameter* fails silently and looks like a correct result.
  Impact: two wasted probe calls, and the model-attribution lens ran against the transcript's tail (the sync stage) instead of the full 500-entry peer session, so per-stage attribution for planning and TDD came from the subagent transcripts rather than the main one.
  Self-identified — the second probe's output disclosed it.

#### What caused friction (user side)

- None this session.
  The operator invoked `/ship 940` and `/retro 940` and made no corrections; every decision gate the prompt defines was answered by a deterministic source (the plan's `**Release:** ship independently` marker, `next-version.sh`), so no clarification was needed.

### Diagnostic details

- **Model-performance correlation** — the peer implementation session and both of its subagents ran on `anthropic/claude-sonnet-5`, attributed from the transcripts themselves (`read_session_file` on the recorded peer path; `list_subagent_sessions` for the two task transcripts, per [#943]) rather than from the agent definitions.
  Both dispatches were judgment-heavy — a `tidy-first-assessor` that read ten files and produced one Recommended preparatory commit with call-site counts, and a `pre-completion-reviewer` that re-derived the pruning/windowing interaction by hand and returned WARN with no FAILs — so a reasoning-strong model was the right fit; no mismatch found.
  Coverage caveat: the main peer transcript is 500 entries and only its tail could be read, per the friction point above.
- **Escalation-delay tracking** — no `rabbit-hole` friction points; no error was retried, and the longest same-target sequence was the two `offset`/`elide_user_text` probes.
- **Unused-tool detection** — none; the lens's gap was a stale build of an available tool, not an undispatched one.
- **Feedback-loop gap analysis** — `pnpm run lint` and `pnpm fallow dead-code` both ran unpiped (redirect-and-tail) on the post-merge tree at step 5, before the push, which is the point that covers the tree CI will see; CI and the release run were each watched to completion.

### Changes made

1. `packages/pi-session-tools/docs/retro/0940-read-session-offset-and-elision.md` — added this Final Retrospective stage entry.

Two documentation changes were proposed and **declined by the operator**, recorded here so a later session does not re-derive them as new:

1. A one-line caveat in `.pi/prompts/retro.md` lens 1, noting that a retro for `pi-session-tools` itself runs the pre-merge build and ignores `offset`/`elide_user_text` silently.
2. A one-clause addition to `AGENTS.md` § Stale in-process extension code, naming an **added parameter** as the silent case alongside the existing changed-tool and removed-tool cases.

The general rule already lives in `AGENTS.md`; the operator's call is that it covers this case without a second copy at the point of use.

[#916]: https://github.com/gotgenes/pi-packages/issues/916
[#943]: https://github.com/gotgenes/pi-packages/issues/943
[#950]: https://github.com/gotgenes/pi-packages/issues/950
