---
issue_title: "Backlog triage — 2026-09-18"
---

# Retro: Backlog triage — 2026-09-18

The first retro written for a `/triage-backlog` run.
Six prior runs produced no retro, so the observations below have no earlier stage entries to build on.

## Stage: Final Retrospective (2026-09-18T16:04:22Z)

### Session summary

Ran the seventh repo-wide backlog triage (93 open issues, 17 open PRs), producing `docs/triage/2026-09-18-backlog.md` with five keystones and a two-band prioritized list.
Applied one missing label, approved two fork CI runs after the escalation audit, and posted four contributor comments (#936, #928, #931, PR #908) after an `ask_user` gate.
The run's most consequential finding — PR #908 silently acquiring the commit from the declined PR #922 — exposed a gap in the template's own verdict-inheritance rule, which this retro closes.

### Observations

#### What went well

- **The keystone rule fired on a contributor-authored keystone.**
  Issue #928 arrived carrying the identity walkthrough, per-naming-style candidate tables, and rule-author guidance, with PRs #929 and #930 split along the decision's own seam.
  Step 8 is written for keystones *we* own; it worked unchanged when a third party wrote one, and the pairing let #929 be ranked on the issue's evidence rather than on its own diff.
- **The substance-first `ask_user` gate converted four judgment calls into four posted replies in one round trip.**
  The prior run recorded that a decision gate — not more session budget — is what moves the disposition backlog.
  Repeating it deliberately reproduced the result: four comments posted, and two items (#711, #755) pulled out of a third consecutive deferral.
- **Re-asking a three-day-old deferral decision was worth it.**
  The repeat-deferral gate looked wasteful against a 2026-09-15 run that had just decided those items, and it still changed two dispositions.

#### What caused friction (agent side)

- `missing-context` — The template collects a PR's `mergeable`, `statusCheckRollup`, and file counts, but never its head SHA or commit list, so an inherited scope verdict is inherited blind.
  PR #908's verdict (scope-approved 2026-09-15) stopped describing its contents on 2026-09-17 when `9e7a95ae` — the declined PR #922's change — landed on its branch.
  Impact: the finding surfaced from an incidental `gh pr view 908 --json commits` call rather than from any step; a wrong verdict stood for three days, and merging on it would have landed a declined change.

- `instruction-violation` (self-identified, after the commit) — `AGENTS.md` principle 4 says a number a command can produce is never authored.
  Every "days waiting" figure in the Blocked-on-others table was computed mentally.
  Impact: eleven of twelve were right; #519 was written as 110 days against an actual 79, inflating the oldest response-debt item by 40% in a committed document.
  The prior triage had the same item right at "11 weeks", so the error was introduced, not inherited.

- `other` (template asserts a false mechanism) — Step 2 attributes `UNKNOWN` mergeable state to *list* queries specifically.
  Fourteen of seventeen single-PR `gh pr view` calls also returned `UNKNOWN`; all resolved on a second pass three seconds later.
  Impact: one wasted 17-call loop before re-querying.

- `other` (template asserts a gate that does not exist) — Step 3 frames the escalation audit as the precondition for contributor code executing in CI. georgeharker's runs on `mcp-prefix-derivation` and `mcp-proxy-registration` executed from first push with no approval, including the 21-file PR #930.
  The repository's fork-approval setting is not readable through the API (`repos/gotgenes/pi-packages/actions/permissions/fork-pr-workflows` → 404), so a session cannot verify the claim it is told to rely on.
  Impact: no rework — the audit still passed for the two runs actually approved — but the template's security argument was overstated for six runs.

- `other` (scaling) — The template asks for the age since the last maintainer response on *each* item.
  At 93 issues plus 17 PRs that is ~110 `gh` calls, so it was done for roughly a dozen items and silently skipped for the rest.
  Impact: the Blocked-on-others table is complete for PRs and partial for issues; no rework, but a rule that is followed selectively reads as a rule that is followed.

#### What caused friction (user side)

- Nothing that cost the session time.
  One opportunity: the 2026-09-15 run recorded seven closes as "approved for execution" and none were executed, so this run had to re-record them as pending and spend a finding on the gap.
  An execution pass between triages — or a note that the approvals are queued rather than done — would let the next run inherit a true state instead of re-deriving it.

### Diagnostic details

- **Model-performance correlation** — every turn ran on `anthropic/claude-opus-5` (unfiltered `read_session`, 27 turns), which the template pins in its frontmatter.
  No subagent was dispatched.
  The judgment-heavy work (scope verdicts, keystone detection, four contributor replies) matches the model; the mechanical stretch — 17 `gh pr view` calls and 12 date subtractions — does not, and is the part a script should own rather than a cheaper model.
- **Escalation-delay tracking** — no `rabbit-hole` friction point; the longest single-thread sequence was four calls (chasing whether `#927`'s hotkeys had moved `permission-dialog.ts`, resolved by `find` on the fourth).
- **Unused-tool detection** — `colgrep` was never used; every lookup was an exact symbol or path match (`addDerivedMcpServerTargets`, `PI_CODING_AGENT_DIR`, `permissions:ready`), which is `grep`'s case.
  No gap.
- **Feedback-loop gap analysis** — `rumdl check` ran against the triage document before the commit and passed.
  No code was touched, so `pnpm run check`/`test` were correctly not run.

### Follow-ups not implemented here

- A `scripts/triage-pr-state.sh` batching the per-PR state queries, the two-pass `UNKNOWN` resolution, and the age arithmetic.
  It would have saved roughly twenty tool calls and prevented the #519 error by construction.
  Deliberately not built inline: it is a new mechanism, and principle 5 prefers the documented rule until a second run feels the same cost.
  File an issue if the 2026-09-2x run repeats the friction.
- The `packages/pi-permission-system/README.md` non-goal bullet for host-specific input formats.
  It has now survived two triages as a recommendation and is blocking answers on PRs #908 and #922.
  It needs an issue or a commit, not a third mention in a triage document.

### Changes made

1. `.pi/prompts/triage-backlog.md` Step 2 — added `headRefOid` to the per-PR query, the rule that a PR's inherited verdict holds only while its head SHA is unchanged, the two-pass `UNKNOWN` resolution, and the `date` one-liner for computing ages.
2. `.pi/prompts/triage-backlog.md` Step 3 — recorded that approval does not gate every fork run and that the setting is not readable through the API, so the audit gates the runs approved rather than all contributor code.
3. `.pi/prompts/triage-backlog.md` Output § Scope alignment — the **Carried forward** subsection now records the head SHA each PR verdict was taken against.
4. `docs/triage/2026-09-18-backlog.md` — corrected #519's wait from 110 days to 79, the figure `date` produces.
5. `docs/retro/triage-2026-09-18-backlog.md` — this file, establishing that a triage run gets a dated retro with no `issue` field.
