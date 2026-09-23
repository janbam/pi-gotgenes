---
issue: 916
issue_title: "pi-session-tools: list_session_files has no limit, returning every session path for a cwd"
---

# Retro: #916 — pi-session-tools: list_session_files has no limit, returning every session path for a cwd

## Stage: Planning (2026-09-19T04:05:20Z)

### Session summary

Planned a `limit` parameter for `list_session_files`, defaulting to 10, with the count line still reporting the true total.
The plan lands in `packages/pi-session-tools/docs/plans/0916-list-session-files-limit.md` as three TDD steps: a `refactor:` extracting listing presentation into a new `src/session-listing.ts`, a `test:` fixture helper, and a `feat!:` behavior change.
Filed [#950] for a mirror-image defect found on the transcript side while designing the clamp.

### Observations

- The issue explicitly deferred the default question, so it went to an `ask_user` gate with measured numbers: this repo's own session directory holds 608 files totaling 88,160 chars of path text, against 1,450 for the newest ten.
  The operator chose a default of 10 (breaking, `feat!:`), the count-line disclosure form (`608 session files, newest first (showing 10):`), and a new `details.shown` field driving the collapsed TUI row.
  The plan records that this cuts **2.0.0** from `1.2.1` — worth re-confirming at ship time, since a major bump for a one-parameter addition is the kind of cost that reads differently a week later.
- The `tidy-first-assessor` recommended reshaping `renderListing` into a `buildListingResult` mirroring `buildTranscriptResult`, and an n-file fixture helper for the test suite.
  Both became TDD steps 1 and 2.
  It also verified the design's claim that the existing one- and two-file tests stay green under a default of 10.
- I extended step 1 beyond the assessor's recommendation: the presentation moves into a **new module** `src/session-listing.ts` rather than staying in `index.ts`.
  Reason: the collapsed-row phrasing lives in `formatResultText`, which calls `keyHint`, which reads `getKeybindings()` and a module-level `theme` (verified in the pinned `@earendil-works/pi-coding-agent@0.79.1` dist).
  No test anywhere in this repo exercises a tool's `renderResult`, so leaving the phrasing there would have shipped a behavior change with no killing mutation available.
  The package already keeps pure presentation in sibling modules with their own suites (`entry-summary.ts`, `format-transcript.ts`), so this follows existing structure rather than inventing one.
- Measured rather than reasoned about the slice directions: `buildTranscriptResult` slices the **tail** (`slice(-limit)`, oldest-first entries), the listing slices the **head** (`slice(0, limit)`, newest-first paths).
  They are not the same operation and the plan says not to share them.
- Scope check: the package README says "A new capability arrives as a new tool rather than as another parameter on an existing one", which reads like a collision.
  `docs/triage/2026-09-18-backlog.md:73` already recorded the verdict that a bound is not a new capability — the triage entry named #916 by number, so no fresh adjudication was needed.
- [#943] (recursive `tasks/` listing) is the sibling issue; the plan's Non-Goals record that bounding first means [#943] inherits the bound by construction.
- `roadmap-fit` exited at Step 1 for [#950]: `pi-session-tools` has no `docs/architecture/architecture.md`, so no open phase exists to record a disposition against.

#### Deferred tidyings

- `packages/pi-session-tools/src/index.ts` — the assessor declined a shared pluralization helper for "N session file(s)", used in two spots today and three after this change; the three strings diverge enough that extracting it mostly relocates a ternary.
- `packages/pi-session-tools/test/list-session-files.test.ts` — the assessor declined adding `renderResult`-level coverage for the collapsed row as a pre-existing module-wide gap rather than preparation for this change.

## Stage: Implementation — TDD (2026-09-19T04:26:37Z)

### Session summary

Executed all three TDD steps: the `refactor:` extracting `src/session-listing.ts`, the `test:` fixture helper, and the `feat!:` adding `limit` with a default of 10.
Test count went from 116 to 130 (+14), across a new `test/session-listing.test.ts` (16 tests) and a new `describe("limit")` plus a `details.shown` case in `test/list-session-files.test.ts`.
Every file the plan listed was touched and no file outside the list was.

### Observations

- One deviation, recorded in the step-1 commit body: the plan specified `formatListingSummary(directory, shown, total)` from step 1, calling it with `shown === total` until step 3.
  That leaves an unused parameter for a whole commit, and an unused parameter cannot be pinned by a mutation.
  Step 1 shipped `formatListingSummary(directory, total)` and step 3 widened it.
- All six of step 3's killing mutations behaved as the plan predicted, with one addition worth recording: the `params.limit ?? files.length` mutation killed **two** tests, not one — the `details.shown` test uses a 12-file fixture with no explicit `limit`, so it rides the default too.
  That is the plan under-predicting, not a test misfiring.
- The `(showing N)` mutation killed five tests and the slice-direction mutation six; in both cases the `limit >= total` test stayed green, which is what makes the truncated and untruncated arms separable.
- `formatListingText` builds its output through an array join rather than string concatenation specifically so `limit: 0` emits no trailing newline after the count line.
  Concatenating `\n${pathLines}` would have left a dangling blank line in exactly the degenerate case.
- Pre-completion reviewer: **PASS**.
  It independently verified the byte-identical untruncated output by diffing against `src/index.ts` as it stood at the plan commit (`docs: plan a limit for list_session_files (#916)`), and checked the one untested line in the change — `formatResultText`'s `formatListingSummary(details.directory, details.shown, details.count)` delegation — for swapped arguments, which was the plan's named accepted residual.
  It also ran `boundListingPaths` against `2.5`, `-0.5`, `NaN`, and `Infinity`, none of which produce an oldest-N or near-full listing.
  No warnings.

## Stage: Sync (worktree) (2026-09-19T04:31:39Z)

### Session summary

Pre-push checks are clean: `pnpm run lint` and `pnpm fallow dead-code` both pass on the worktree tree with no findings.
The branch carries five commits ahead of the plan commit: the plan, its planning retro, the `refactor:`, the `test:`, and the `feat!:` (with a `BREAKING CHANGE:` footer, cutting `2.0.0` from `1.2.1` per the plan's Release Recommendation — ship independently, no roadmap batch).

**Peer session transcript:** `/Users/chris/.pi/agent/sessions/--Users-chris-development-pi-pi-packages-worktrees-issue-916--/2026-09-19T03-56-30-839Z_01a0b7ce-fcf7-7251-bc6b-33385c9185fd.jsonl` — read with `read_session_file({ path: "..." })` for message-level verification at land/retro time.

### Observations

Nothing deferred beyond what the TDD stage already recorded ([#943], [#950]).
Ready for `/ship 916` at the root.

## Stage: Final Retrospective (2026-09-19T05:37:45Z)

### Session summary

Shipped the bound on `list_session_files` through the worktree lane: fast-forward-merged five branch commits onto `main`, verified CI, closed the issue, and released `pi-session-tools` 2.0.0 (from `1.2.1`).
The whole issue ran clean across four stages — one `ask_user` gate at planning, three TDD steps with every predicted killing mutation behaving, a PASS from the pre-completion reviewer, and no CI failure, merge rejection, or release retry.
This retrospective read the peer session's transcript through the package's own `read_session_file`, using the path the sync stage recorded.

### Observations

#### What went well

- The step-1 deviation is the clearest instance of mutation discipline changing a plan rather than being satisfied by it.
  The plan specified `formatListingSummary(directory, shown, total)` from step 1, called with `shown === total` until step 3.
  The implementing session shipped `(directory, total)` and widened it in step 3 instead, recording the reason in the commit body: an unused parameter cannot be pinned by a mutation.
  A plan signature was revised because it was unverifiable, not because it was wrong.
- The package under change served the retrospective that reviewed it.
  The worktree was torn down before this session ran, and the peer transcript was still one `read_session_file` call away because the sync stage recorded its absolute path under `~/.pi/agent/sessions/`.
  That breadcrumb is what made the model-attribution lens below cost one call instead of a directory hunt.
- The pre-completion reviewer did not take the session's coverage claim as a premise.
  It reconstructed `src/index.ts` as it stood at the plan commit and diffed the untruncated output against it to prove byte-identity, then checked the one untested delegation for swapped arguments and ran `boundListingPaths` against `2.5`, `-0.5`, `NaN`, and `Infinity`.
  Each is a check the implementing session could not have graded itself on.

#### What caused friction (agent side)

- `other` — the TDD stage note cited the plan commit's SHA, and `/sync-worktree`'s step-5 check correctly flagged it: at that moment the plan commit was on the branch and not yet an ancestor of `main`.
  The peer then grepped for it, resolved its subject, rewrote the citation, re-ran the check, and amended — and narrated the reason as "not safe long-term" rather than "not yet reachable from `main`", which is the condition the check actually tests.
  `/sync-worktree` forbids a branch SHA in its own note and its step 5 says the check "covers the TDD stage note as well", so detection is by design; `/tdd-plan` carries no corresponding rule at the point the SHA is written.
  Impact: seven tool calls and one amend at sync time, no rework on `main`.
- `instruction-violation` (self-identified) — the sync stage wrote a placeholder timestamp into its entry, then corrected it against `date -u`.
  The `markdown-conventions` skill states the rule without hedging: get each stage timestamp from `date -u` — never write one from memory.
  Impact: one extra `Edit`; the committed timestamp is correct.
- `other` — two `Edit` calls in the TDD stage failed on a non-matching `oldText` and each needed a re-read of the region first.
  This is the `pi-autoformat` reflow hazard `AGENTS.md` already names; the rule was not applied pre-emptively after writing the same region.
  Impact: four extra tool calls, no rework.
- `other` — the ship stage appended `echo "EXIT:$?"` to `pnpm run lint >/tmp/lint.log 2>&1 || tail -30 /tmp/lint.log`, where `$?` reports the status of the `||` list rather than the gate's.
  `EXIT:0` was therefore uninformative and the log had to be read separately to confirm the gate passed; the `pnpm fallow dead-code` call immediately after used the correct `rc=$?` capture.
  Impact: one extra tool call, no rework.

#### What caused friction (user side)

- The planning note invited a re-confirmation that the workflow cannot deliver.
  It recorded that a major bump for a one-parameter addition "is the kind of cost that reads differently a week later" and called it "worth re-confirming at ship time".
  But `/ship` only asks when the plan's marker reads `mid-batch — defer`, and this one read `ship independently`, so the release was dispatched without reopening the question.
  The invitation was addressed to a gate that does not exist.
  Nothing went wrong here — 2.0.0 was the operator's own choice at the planning gate — but a stage note asking a later stage to re-decide something needs to name the mechanism that would carry it, or it is a note to nobody.

### Diagnostic details

- **Model-performance correlation** — planning and implementation ran on `anthropic/claude-opus-5`, the two judgment-heavy stages: a measured `ask_user` gate, the breaking-change classification, and six killing mutations with per-class predictions.
  The sync stage ran on `anthropic/claude-sonnet-5` against a mechanical checklist (two gates, one stage note, a rebase) and still caught the unreachable plan SHA.
  Ship and this retrospective ran on `anthropic/claude-opus-5`.
  Both subagents are pinned to `anthropic/claude-sonnet-5` by their definitions; the `pre-completion-reviewer`'s work was judgment-heavy verification and it returned PASS with specific, independently-derived evidence, so no mismatch was observed in either direction.
- **Escalation-delay tracking** — no `rabbit-hole` friction point arose, so this lens has nothing to flag.
  The longest run of same-target calls was step 3's mutation sweep (six mutations, each an `Edit`, a suite run, and a restore), which is the plan's prescribed verification rather than thrash.
- **Feedback-loop gap analysis** — verification was incremental throughout.
  A four-gate green baseline ran before step 1, a per-file `vitest` run after each Red and Green, `pnpm run check` mid-step-3 when the schema changed, the full suite plus lint plus `fallow` after the last step, and `pnpm run lint` and `pnpm fallow dead-code` again at ship on the merged tree — the tree neither the peer's pre-rebase checks nor the branch's own CI had covered.
  No end-only verification to flag.

### Changes made

1. `.pi/prompts/tdd-plan.md` — added one line to the `## Write stage notes` section: name a commit by its subject rather than its SHA on an `issue-<N>-*` branch, since `/sync-worktree`'s rebase rewrites every branch SHA.
   This adds prevention where the SHA is written; `/sync-worktree`'s step-5 dangling-SHA check stays in place as the backstop.
2. `packages/pi-session-tools/docs/retro/0916-list-session-files-limit.md` — this Final Retrospective stage entry.

[#943]: https://github.com/gotgenes/pi-packages/issues/943
[#950]: https://github.com/gotgenes/pi-packages/issues/950
