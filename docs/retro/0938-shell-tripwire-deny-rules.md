---
issue: 938
issue_title: "Turn the three recurring shell tripwires into pi-permission-system deny rules with reasons"
---

# Retro: #938 — Turn the three recurring shell tripwires into pi-permission-system deny rules with reasons

## Stage: Planning (2026-09-17T22:15:10Z)

### Session summary

Measured every candidate deny pattern against the real command corpus — 7,578 unique bash commands from the local permission review log — using the package's own `BashProgram.parse` and `compileWildcardPattern` rather than reasoning about the wildcard grammar.
The measurement reshaped the change: only one of the issue's three named tripwires is expressible, a fourth rule the issue used as a throwaway illustration measures perfectly clean, and three of the issue's four proposed pattern spellings match nothing at all.
Wrote `docs/plans/0938-shell-tripwire-deny-rules.md` for two deny rules plus a repo-root validator, filed [#941] for the enumeration fact the second rule rests on, and recorded its Phase 15 disposition.

### Observations

**The spike was the whole planning session.**
Three of the issue's four proposed patterns are wrong as written, and none of that is visible from the schema or the docs.
`git rev-parse * | wc -c` matches 0 commands because a bash rule matches one command *unit* and a pipeline enumerates into several.
`git commit -F -*` matches 0 because a heredoc absorbs the `-` operand, so the unit text is exactly `git commit -F` — which, spelled that way, is a perfect discriminator: 14 true positives, 0 false positives against 85 corpus uses of the legitimate `git commit -F <file>` form.
Reading `bash-command.ts` gave the first fact; only running the parser gave the second.

**A three-part admission test fell out of the measurement** and is written into the plan's Design Overview: expressible (single command unit), clean (near-zero measured false positives), escapable (the reason names a correct spelling the pattern does not match).
`wc -c*` fails two of the three — 14 legitimate byte counts against 4 tripwire hits, and no escape on the `bash` surface.
The unquoted-glob rule fails the first outright: the matcher compiles to an anchored regex with no negation, so `--include=*.ts` and `--include='*.ts'` are indistinguishable.

**A deny-then-`allow` carve-out was considered and rejected as a bypass**, not as inelegant.
`*--include=*` deny followed by `*--include='*` allow is expressible, but `sudo grep --include='*.ts' …` is one unit matching both `sudo *` (ask) and the carve-out (allow), and last-match-wins hands it `allow`.
Worth remembering the shape: under last-match-wins, an `allow` written to carve an exception out of a lint-style deny is a hole in every *other* rule that matches the same unit.

**Operator decisions:** admit only the two clean rules; compress the `AGENTS.md` prose to a one-line pointer rather than deleting it (the deny only fires in a trusted project with the extension loaded, so the prose is the copy that survives); record the negative result in the plan and the close comment rather than annotating the dated audit snapshot.

**The measured word saving is −38 of 8,083 (−0.47%)** and the plan says so plainly.
The parent issue [#934] was about size, so it would be easy to oversell this; the value is enforcement, not words.

**Two `AGENTS.md`-adjacent facts worth carrying forward.**
`reasonClause` appends its own full stop, so a config `reason` ending in a period renders `..` — the operator's existing `find / *` reason already gets this right.
And config is re-read every turn from the policy files' mtimes, so the rules go live for the session that writes them, mid-session.

**Tidy-First:** the assessor returned *no preparatory refactoring warranted* (both new files are greenfield, the `AGENTS.md` edit is a flat prose trim), but it caught a real design error — every existing root test imports a pure function from `scripts/` and performs zero filesystem reads, and the design as summarized would have been the first to break that.
The plan now specifies a `scripts/permission-config/` + `test/permission-config/` pair.
That is the second time this assessor has paid for itself through a contradiction rather than a recommendation.

**Follow-up filed:** [#941] — a heredoc absorbs the command's `-` operand, an enumeration fact nothing asserts and the `git commit -F` rule now depends on.
Recorded as out of scope for pi-permission-system Phase 15 (operator decision): it is a test-only pin over `command-enumeration.ts`'s output, not the phase's token-role cause.

#### Deferred tidyings

None — the Tidy-First assessor rejected only two candidates as scope creep, and both were "do not restructure `AGENTS.md` beyond the two named passages" and "do not build schema-driven validation instead of hand-asserting the limits", neither of which is latent debt in a file.

## Stage: Implementation — TDD (2026-09-17T22:52:49Z)

### Session summary

Four TDD cycles: the pure validator and its fixtures, the config file plus the integration case over the real file, the `AGENTS.md` compression, and a fourth cycle added after the pre-completion review closed a gap where the validator was looser than the schema it backstops.
Root test suite went 107 → 130 tests; nothing under `packages/` changed, so no package version is cut.
Every predicted killing mutation landed its predicted red count (8/3/2/4 in cycle 1, 1/1/1 in cycle 2, 1/1/2/1 in cycle 4).

### Observations

**The plan's measurements reproduced exactly.**
Re-running the corpus spike against the committed patterns gave `rg -r*` → 9, `git commit -F` → 14, `git commit -F *` → 85, `git rev-parse * | wc -c` → 0 over the same 7,578 commands.
The live check was the better evidence though: `rg -rn 'x' /dev/null` came back denied, naming `rule 'rg -r*'`, carrying the full reason, with exactly one terminating full stop — and `rg --replace 'GAMMA' 'alpha' /tmp/rg938.txt` ran normally, so the escape hatch the reason names really is unmatched.
Config is re-read every turn, so the rule was live on the turn after the commit without a restart.

**The reviewer found a real hole, and it was in the guardrail rather than the feature.**
`findConfigProblems` reported no problems for `permission.bash: "alow"` — the realistic typo — and for `[]`, `null`, and a deny object with an unknown key, all four of which `unifiedConfigSchema` rejects.
A validator whose entire job is catching a typo before it floors the repo's policy `allow`→`ask` was looser than the schema on the most likely typo of all.
Cycle 4 closed it and the parity was then verified by parsing all six shapes through the real schema rather than reasoning about it.

**Two residual disagreements are known and accepted**, both pre-dating cycle 4 and both outside the properties the validator claims: an empty-string pattern key (`{"": "allow"}`) and `permission` itself typed as a non-object both pass the validator and fail the schema.
Neither is reachable from a plausible hand-edit of a two-rule file, and the Tidy-First disposition already recorded "do not build schema-driven validation" as rejected scope creep.
Also noted: `{"bash": undefined}` is flagged by the validator and accepted by the schema, which JSON cannot express, so `loadProjectPermissionConfig` can never produce it.

**One file outside the plan's table was touched**, under the plan's own step-3 instruction to grep the prompts and skills.
`.pi/prompts/audit-agent-docs.md` used the `rg -r` passage as a worked `delete` example with the rationale "no retro since 07-20", while the real 2026-09-17 inventory records that exact passage as `keep`, "recurred in 0914 with the rule loaded".
The example contradicted the audit it illustrates and the fact this issue opens with, so it was swapped for a real `delete` row from that audit.
The first review round flagged the missing rationale, which is now in the commit body.

**The package skill already documents the heredoc-absorption fact in prose** (`package-pi-permission-system` SKILL.md, the `floorUnparsedUnit` passage cites `git add`/`git commit -F` as the enumeration of a heredoc command).
That does not weaken [#941] — nothing *asserts* it — but it is worth knowing the fact was written down and still had no test.

**Pre-completion reviewer: WARN, then PASS on re-review.**
Round 1's two findings (the schema-looseness gap, and the missing commit-body rationale for the `audit-agent-docs.md` swap) were both fixed before round 2, which returned PASS with the two residuals above recorded as informational.

## Stage: Final Retrospective (2026-09-18T03:40:44Z)

### Session summary

Planning, four TDD cycles, ship, and this retrospective ran in one trunk-lane session.
The change turned two of the issue's three named shell tripwires into project-scope `pi-permission-system` deny rules with agent-facing reasons, compressed the two `AGENTS.md` passages they now enforce, and added a repo-root validator guarding the config against a typo that would floor the whole repo's policy `allow`→`ask`.
Nothing under `packages/` changed, so no release was cut; [#941] was filed and dispositioned against Phase 15.

### Observations

#### What went well

1. **Measuring against the real corpus is what made this issue answerable.**
   Running the package's own `BashProgram.parse` and `compileWildcardPattern` over 7,578 logged commands overturned three of the issue's four proposed patterns, and every one of those was invisible to the schema, the docs, and the wildcard grammar.
   The plan's numbers then reproduced exactly at implementation time (9 / 14 / 85 / 0), which is the property that made the spike worth committing to prose.
2. **The live denial was better evidence than the measurement.**
   `rg -rn 'x' /dev/null` came back denied with the rule named and the reason rendered, and `rg --replace` ran normally — a two-call check that verified the mechanism, the reason text, the single terminating full stop, and the escape hatch at once.
   Worth reaching for whenever the change is a config rule the running session itself is subject to.
3. **The `tidy-first-assessor` paid for itself through a contradiction, not a recommendation — again.**
   It returned "no preparatory tidying warranted" and, on the way past, caught that every root test imports a pure function from `scripts/` and does zero filesystem reads.
   The design as summarized would have been the first to break that convention.
4. **The `pre-completion-reviewer` found a hole in the guardrail rather than the feature.**
   `findConfigProblems` reported no problems for `permission.bash: "alow"` — the most likely typo of all — which the real schema rejects.
   A validator that exists to catch a typo was looser than the schema on that typo; cycle 4 closed it, with parity then verified by parsing six shapes through `unifiedConfigSchema` rather than reasoning about it.

#### What caused friction (agent side)

1. `instruction-violation` (self-identified at retro) — **the unquoted-glob rule was violated during the session whose subject is that rule.**
   `ls packages/*/docs/retro/$f-*.md docs/retro/$f-*.md` inside a `for` loop aborted with `zsh:1: no matches found`, discarding the rest of the chain; it was retried with `find`.
   Impact: one wasted tool call, no rework.
   This is the strongest possible evidence for the issue's own premise, and for the decision to record the glob rule as unmechanizable rather than force a pattern: the rule was in loaded context, was the explicit subject of the work, and still failed.
2. `instruction-violation` (self-identified at retro) — **the `testing` skill was not loaded at planning, and the session then ran a disposable spike test.**
   `/plan-issue` names that exact trigger ("or if investigation will run a disposable spike test").
   Two of the three calls lost to the spike are documented in that skill: a `grep`-filtered Vitest run printed empty, and `console.log` output was suppressed by the default reporter until the spike was rewritten to `appendFileSync`.
   Impact: three wasted tool calls, no rework.
3. `other` — **an `Edit` batch was rejected because `pi-autoformat` had reflowed the target region.**
   A five-edit call failed on `if (typeof value !== "object" || value === null) return [...]`, which biome had already wrapped across two lines.
   Re-reading the region and re-issuing all five edits fixed it.
   Impact: one wasted tool call, no rework.
   `AGENTS.md` documents this under Tool-injected messages; it fired anyway on a file edited four turns earlier.
4. `other` — **the `pre-completion-reviewer` subagent ran `pnpm add tsx`**, briefly modifying `package.json`, `pnpm-lock.yaml`, and `pnpm-workspace.yaml` before reverting it and reporting the revert.
   Its own definition declares it read-only and gives a bash allowlist that does not include `pnpm add`.
   Impact: none — the revert was verified clean with `git diff --name-only package.json pnpm-lock.yaml pnpm-workspace.yaml` before the push.
   The hazard is real regardless: a lockfile mutation from a review agent is exactly the kind of change that rides along unnoticed into a push.

#### What caused friction (user side)

Nothing to flag.
All three clarification gates were answered decisively, and two of the answers changed the outcome: compressing the `AGENTS.md` prose rather than deleting it (which is what keeps the guidance alive for an untrusted project or a session without the extension), and fixing the reviewer's WARN inline rather than deferring it to a follow-up.

### Diagnostic details

- **Model-performance correlation** — all three subagent dispatches (one `tidy-first-assessor`, two `pre-completion-reviewer` rounds) ran `anthropic/claude-sonnet-5` per their locked frontmatter, and all three returned substantive structural findings, so no mismatch.
  Directly observed from the transcript's inline labels: the Ship stage ran `claude-sonnet-5` and this retrospective runs `claude-opus-5`.
  The Planning and TDD stages were not sampled — reading far enough back in an unfiltered `read_session` to reach them costs more context than the attribution is worth, and `scripts/agent-docs/model-usage.mjs` rolls up by week rather than by issue, so it cannot isolate this session.
  Recording the gap rather than inferring one.
- **Escalation-delay tracking** — no `rabbit-hole` friction points; the longest run on a single obstacle was three calls (the spike's output plumbing), under the five-call threshold.
- **Unused-tool detection** — `colgrep` was never used, and the `/plan-issue` skill list names it.
  The exploration here was exact-symbol work (`denyWithReason`, `isSurfaceFullyDenied`, `mergeFlatPermissions`), which is `grep`'s case, so this is not a miss — but the skill went unloaded rather than being loaded and judged unnecessary, which is the same lapse as friction point 2.
- **Feedback-loop gap analysis** — healthy.
  `pnpm run test:scripts` ran inside every TDD cycle rather than only at the end, each cycle applied its planned killing mutations with a `cp`-based green-file backup, and `pnpm run lint` plus `pnpm fallow dead-code` ran at cycle boundaries as well as before the push.

### Changes made

1. `.pi/extensions/pi-permission-system/config.json` — added `"pnpm add*": "ask"`, so a dependency install prompts the operator instead of landing silently.
   Prompted by the `pre-completion-reviewer` running `pnpm add tsx` during round 2 (friction point 4).
   Measured 1 occurrence in the same 7,578-command corpus, against 26 for `pnpm install`, which is deliberately not gated.
2. This retro entry.

#### A correction worth recording

The rule was proposed, and approved, as an `ask` **carrying a reason string** — and that shape does not exist.
`denyWithReasonSchema` pins `action: z.literal("deny")`, so a reason is a property of a deny alone; parsing both shapes through `unifiedConfigSchema` returned `ask+reason => REJECTED`, `plain ask => ACCEPTED`.
Had it landed as drafted, the project scope would have been rejected fail-closed and floored the whole repo's policy `allow`→`ask` — the precise hazard `findConfigProblems` was written for, and it would have caught it (`action !== "deny"` → malformed value).
The first real edit after shipping the guardrail was the one the guardrail was for, which is the strongest evidence for cycle 4 that the session produced.
It also repeats the session's own dominant lesson in miniature: the shape was inferred from the neighbouring entries rather than read off the schema.

[#934]: https://github.com/gotgenes/pi-packages/issues/934
[#941]: https://github.com/gotgenes/pi-packages/issues/941
