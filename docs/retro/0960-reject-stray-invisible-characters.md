---
issue: 960
issue_title: "Reject stray control characters in tracked files before they reach a commit"
---

# Retro: #960 — Reject stray control characters in tracked files before they reach a commit

## Stage: Planning (2026-09-20T22:29:19Z)

### Session summary

Planned a repo-level gate that rejects stray invisible characters in tracked text files, wired into `prek`, `pnpm run lint` (hence CI), `lint:fix`, and the `pi-autoformat` chain.
Both decisions the issue flagged as open dissolved under measurement, and a corpus sweep of all 1764 session transcripts corrected the issue's central attribution: the corruption is model-side, not an `Edit` tool defect.
The plan landed as `docs/plans/0960-reject-stray-invisible-characters.md` with no preparatory refactoring, per the Tidy-First assessor.

### Observations

- **Both of the issue's stated decisions were non-decisions.**
  Exit-status inversion needs no wrapper (a Node script's `process.exitCode` is natural, and prek even ships a builtin `deny-pattern` hook that handles it); `grep -P` portability is moot once the check is Node.
  The issue's third suggestion — configure Biome's `noIrregularWhitespace` for comments — is measurably impossible: `NoIrregularWhitespaceOptions` in the Biome 2.5.11 schema is `{"type": "object", "additionalProperties": false}`, zero options.
- **Biome's blind spot is wider than [#863] recorded.**
  A probe run confirmed a form feed is clean inside a `/** */` comment *and* inside a string literal, not just in comments.
- **prek's builtin `deny-pattern` was the cheapest option and lost anyway.**
  It works (verified in a scratch repo, hex-escape character class and all) and would have been ~4 lines of config, honoring the "mechanism is forever; docs are reversible" principle.
  It was rejected because it only runs at the pre-commit stage — CI does not run prek, and this repo has 15 open third-party PRs whose commits never see a local hook.
  Wiring prek into CI was offered as a third option and declined.
- **The corpus sweep overturned an argument I had already given the operator.**
  I claimed the `erence2`→em-dash signature's only evidence was retro prose, since the corrupt blob was fixup-rebased out of git.
  That was wrong: 122 decoded U+000C occurrences survive in session transcripts, and the mapping is mechanically verifiable by diffing a transcript context against the repaired file.
  Disclosed and re-asked rather than left standing.
- **The field-path breakdown is the plan's most load-bearing measurement.**
  62 of the 122 occurrences sit in `message.content[].text` — plain assistant prose, no tool involved — and the same corrupted string appears in `text` and `arguments.edits[].newText` in one turn.
  So the em-dash is never encoded and then damaged; `Edit` is a faithful courier.
  The retro's "the `Edit` tool mangling an em-dash" framing is wrong, and step 7 corrects it in two skills.
- **A signature-based check would have missed 42%.**
  Residues: `erence2` 65, `erence6` 4, and 51 with no signature (43 bare, 8 followed by an ordinary word).
  That is why the design matches the character, not the visible text — and it retroactively justifies the retro's warning that grepping the residue passes on a corrupt file.
- **Three repair classes, not two.**
  U+200C/U+200D/U+2060 are detected but deliberately *not* repairable: ZWJ is load-bearing in emoji sequences and ZWNJ is semantically required in Persian and Indic scripts, so deletion is not universally correct.
  Only U+200B and U+FEFF are deleted by `--fix`.
  This came from checking U+200D's tree-wide count before writing the repair set, not from the original design.
- **The classifier is a code-point `Set`, not a regex literal.**
  Biome's `noControlCharactersInRegex` is in the `recommended` preset and rejects `/[\x00-\x08…]/` with one error per escape — measured.
  Building the set programmatically avoids both a lint suppression and any literal control character in the source.
- **Scope decisions.**
  U+00A0 stays legal (2 sites in `packages/pi-autoformat/docs/configuration.md:312`, both after `e.g.`, reading as deliberate typography).
  CR is excluded — `mixed-line-ending` is a separate prek builtin, not enabled here.
  Auto-restoration of `\x0cerence2`→`—` was offered three ways and settled on print-the-suggestion-but-never-apply.
- **The plan file failed its own gate on the first draft.**
  It carried two U+200B, copied verbatim from the corrupted files while quoting them as examples.
  Caught by running the candidate scan over the draft before committing.
  A document introducing this gate cannot quote the defect literally; the plan now says so, and the same constraint governs the test fixtures (escapes only).
- **Measured baselines recorded for `/tdd-plan`:** 2003 tracked files scanned in 0.43 s (exit 0); `pnpm run lint` 29.0 s, predicted ~29.4 s; root suite 8 files / 130 tests; 5 tracked binary files, of which `packages/pi-subagents/media/demo.mp4` contains `0x0c` and is the case `isBinary` exists to exclude.

#### Deferred tidyings

- `scripts/permission-config/tripwire-rules.mjs`, `scripts/agent-docs/always-loaded.mjs`, `scripts/agent-docs/doc-growth.mjs`, `scripts/agent-docs/model-usage.mjs` — four identical `parseArgs(argv)` pairwise-loop definitions.
  The new script's grammar (a boolean `--fix` plus positional paths) cannot reuse the `--name value` shape, so extracting now would build an abstraction for one caller.
  Trigger for extraction is a fifth script needing the pairwise shape.
- `test/roadmap/roadmap-check.test.mjs`, `test/agent-docs/model-usage.test.mjs` — duplicated `mkdtempSync`/`rmSync` `beforeEach`/`afterEach` workspace fixtures.
  Would have become a third copy; the design sidesteps it by injecting `readFile` into `scanFiles` instead, following `measure(sha, run)`.

## Stage: Implementation — TDD (2026-09-21T02:59:49Z)

### Session summary

All seven TDD steps landed in seven commits, adding `scripts/lint/invisible-characters.mjs` and its test, wiring the gate into `prek.toml`, `pnpm run lint`, `lint:fix`, and the `pi-autoformat` chain, repairing the two live U+200B sites, and refreshing four docs.
The root suite went from 8 files / 130 tests to 9 files / 178 tests (+48).
The pre-completion reviewer returned PASS.

### Observations

- **Three deviations from the plan, all disclosed in commit bodies.**
  Step 3 was planned as `repairInvisibleCharacters` plus "the CLI's `--fix` branch", but the step's own killing mutation (`--fix` exiting 0 whenever it repaired something) needed a test, and root `test/` has no CLI-spawn harness by convention.
  Extracted `run()` and `repairFiles()` so the composition and exit semantics are testable, leaving the CLI body a four-line shell; the reviewer judged the decomposition sound on ISP grounds.
  Step 4 was retyped from the plan's `fix:` to `docs:` — the files are internal plan and retro documents, so nothing user-observable changes and `fix:` would have put "remove stray zero-width spaces" in a package changelog.
  Step 2 required updating step 1's `toEqual` expectations to carry the new `suggestion` field, which the plan had anticipated as a consequence of adding a field to a produced object.
- **Two mutations killed far more tests than the plan predicted, for a structural reason.**
  Making the form feed repairable reddened 10 tests against a predicted 1, and returning a suggestion unconditionally reddened 15 against a predicted 1.
  Both because `REPAIRABLE` and the suggestion's null path are shared with the classifier rather than local to the repair.
  Treated as a pass, since the rule is that *fewer* reds than predicted is the finding.
  The plan would have been more accurate had it noted which sets the classifier and the repair share.
- **Step 5's verification was the most valuable one in the plan.**
  Planting a form feed in a staged file showed the hook rejecting it, `pnpm run lint` exiting 1, and `git commit` blocked; removing the hook entry let the same byte reach a commit, reproducing #863's failure exactly.
  That is a falsifying test of the gate rather than a happy path, and it also turned up a fact the plan did not have: `types = ["text"]` covers `.mjs` and `.toml`, which the existing `biome` hook's `types_or` does not, so `.mjs` files were previously outside the pre-commit formatter entirely.
- **Step 6's mutation could not be run as written and was simulated instead.**
  The plan already warned that the running Pi loaded `pi-autoformat`'s config at session start, so a live turn cannot exercise the chain change.
  Ran the `.md` chain's commands in order instead, with and without the entry: `rumdl fmt` alone leaves a planted U+200B intact, and the entry prepended removes it.
  That measures the claim without needing a restart.
- **A three-way class split replaced the plan's two-way one during planning and paid off under review.**
  U+200C/U+200D/U+2060 are detected but never repaired.
  The reviewer verified this against a real family emoji ZWJ sequence: both joiners are reported, `--fix` leaves the byte sequence unchanged, and the command still exits 1.
- **The `pi-subagents` release probe reports a pending `v21.7.3`, and it is not this issue's doing.**
  `next-version.sh` compares `git-cliff`'s bumped version against the globally highest tag, and this worktree is 9 commits behind `origin/main`, which already carries `v21.7.4`.
  Confirmed by running the probe in a scratch worktree at the plan commit, before any implementation step: it printed the same `pi-subagents-v21.7.3`.
  `/sync-worktree` resolves it; the plan's "no package release is triggered" claim holds for this change.
- **Filed [#964]** — the gate inspects file contents and never the path string, so an invisible character in a *filename* is undetected.
  Surfaced by the reviewer, which probed start-of-file, end-of-file without a trailing newline, CRLF, a single-character file, an empty file, and a symlink, all of which are caught.
  Not #960's symptom, which is corrupt content, so it was filed rather than folded in.
  Measured 0 of 2007 tracked paths carry a non-ASCII or control character today, and `prek` ships a builtin `deny-filename-pattern` that may cover the pre-commit half as pure config.
  `roadmap-fit` exited at its first step: `scope:repo` with no resolvable package, so there is no open phase to disposition against.
- **Reviewer warnings:** one WARN, on evidence provenance.
  The suggestion table's corpus counts (122 form feeds across 1764 transcripts; 65 `erence2`, 4 `erence6`, 51 with no residue) could not be independently re-derived cheaply, and the reviewer named both reasons precisely: a JSON transcript stores a raw form feed as the two-character escape `\f` rather than `\u000c`, so a naive scan under-counts, and the sessions written while working #960 discuss the literal strings `erence2`/`erence6` in prose, which over-counts in the other direction.
  Both effects are real — the first is a bug I hit and fixed mid-sweep during planning.
  The counts stand as reported from one organic sweep, not as verified, and the table only ever prints a suggestion.
- **Re-derived numbers.**
  The reviewer confirmed the suite delta (8/130 → 9/178) by running the baseline in a scratch worktree, and the 3-bytes-per-file doc repair by `wc -c`.
  Its lint wall-clock differed in absolute terms (32.9 s → 34.4 s against my 27.0 s → 28.2 s) but the delta matched at ~1.2–1.5 s, so the machine differs and the scan cost does not.

[#964]: https://github.com/gotgenes/pi-packages/issues/964

## Stage: Sync (worktree) (2026-09-21T15:45:09Z)

### Session summary

Pre-push checks pass clean (`pnpm run lint`, `pnpm fallow dead-code`), so the branch is ready to hand off to the root.
The plan's marker is `**Release:** ship independently`, but no `packages/*/src/` file changed in this issue, so no package release is actually triggered (confirm this at land time rather than dispatching one reflexively).

**Peer session transcript:** `/Users/chris/.pi/agent/sessions/--Users-chris-development-pi-pi-packages-worktrees-issue-960--/2026-09-20T20-59-12-591Z_01a0c09d-a74e-7657-a7e6-b1c9a33d93ee.jsonl` (read with `read_session_file({ path: "<path>" })` for message-level verification at land/retro time).

### Observations

- The TDD stage note already flagged that `next-version.sh pi-subagents` reports a pending `v21.7.3` purely because this worktree sat 9 commits behind `origin/main` (which carries `v21.7.4`), verified as pre-existing and not caused by this issue.
  Step 4's `git fetch` + `git rebase main` below should resolve that gap; recheck the probe once rebased if it matters at ship time.
- Filed [#964] during TDD (the gate does not inspect filenames) with no open package phase to disposition against, and nothing further needed at land time beyond what `/ship`'s normal close-comment flow does.
- No conflicts anticipated: every file this branch touches is new or a small targeted edit (two doc repairs of 3 bytes each, four doc/skill sections, `prek.toml`, `package.json`, one new script pair), none of it in a hot path another peer is likely to be touching concurrently.

## Stage: Final Retrospective (2026-09-21T16:42:48Z)

### Session summary

Shipped the invisible-character gate through the worktree lane: fast-forward-merged 11 commits, ran both pre-push gates on the merged tree, verified CI green on `d1227e32`, closed the issue with a seven-commit close comment, and tore down the worktree.
Nothing released, matching the plan's own prediction: the range touched `packages/` only under `docs/plans` and `docs/retro`, and `next-version.sh` reported nothing releasable for either candidate package.
The single notable event was a 300-second `pnpm run lint` timeout that resolved as a cold-start anomaly rather than a regression in the gate this issue added.

### Observations

#### What went well

- **The peer's pre-emptive diagnosis of the release probe cost the ship zero investigation.**
  The TDD stage had already established, in a scratch worktree at the plan commit, that `next-version.sh pi-subagents` reported a pending `v21.7.3` because the worktree sat 9 commits behind `origin/main`.
  At the root the probe reported `pi-subagents-v21.7.4` with nothing to release, so the breadcrumb converted what would have been a mid-ship anomaly into a one-line confirmation.
  This is the cross-session context bridge working as designed.
- **An unpushed root commit was present at ship time and the fast-forward merge still succeeded.**
  `a53dc527` (the #963 roadmap disposition) sat unpushed on `main` when `/ship` started, which the `worktrees` skill names as the sharper form of the staleness hazard because a peer rebasing onto `origin/main` cannot see it.
  It worked because `/sync-worktree` rebases onto **local** `main`, exactly as the skill prescribes: the peer's own check was `git rev-list --count main..origin/main`, then `git rebase main`.
  The near-miss validates a rule that already exists rather than exposing a gap.
- **The new gate was immediately used as its own self-check.**
  Both the TDD and Sync stages ran `node scripts/lint/invisible-characters.mjs` against the retro file they had just written, before committing it.
  A gate whose subject is authored prose earning its keep on the very prose that documents it is a good sign for the mechanism.
- **Step 2's plan-and-retro read paid for itself before any irreversible action.**
  Reading both in full established the release marker, the absence of any third-party PR close target, and that [#964] was a follow-up to leave open, so steps 8 through 10 confirmed decisions rather than deriving them under pressure.

#### What caused friction (agent side)

- `other` (environment anomaly) — the first `pnpm run lint` exceeded the 300-second tool timeout with only the `pnpm` command echo in the log, against a recorded baseline near 29 seconds.
  I bisected it: the new script (1.2 s), `biome check .` (2.8 s), `eslint packages/` (29.7 s), and `rumdl check .` (4.1 s) were each clean, and a re-run of the whole script passed in 32.2 s.
  Impact: about 7 minutes and 7 tool calls, no rework, and no defect found.
  The cheaper first move was a single re-run (32 s) before decomposing into stages (about 70 s of gate runs plus the reasoning) — bisection was defensible only because this issue had just **added** a stage to `lint`, which made the new script the live suspect.
  The root cause remains unexplained; the log's emptiness places the hang before `biome` emitted its summary line, which it normally reaches in under half a second.
- `other` (shell exit-status handling) — the first gate invocation was `pnpm run lint >/tmp/lint.log 2>&1 || tail -30 /tmp/lint.log; echo "--- lint rc=$?"`.
  In that form `$?` reports `tail`'s status on the failing branch, so the `rc=` line would have printed `0` for a failed gate.
  The `/ship` prompt's prescribed recipe stops at the `|| tail` and is correct as written; the ambiguity came from the `rc=` echo I appended to it.
  Impact: none here, since the gate ultimately passed and I read the log tail rather than the `rc=` line — but it is a masking construct one step removed from the pipeline trap `shell-traps` already documents.
  Subsequent calls used `timeout … ; echo rc=$?`, which reports the command's own status.
- `instruction-violation` (self-identified, peer Sync stage) — writing the sync stage note, the peer emitted hand-written `\u2014` escape sequences into the `Edit` body, which landed in the retro file as the literal six characters instead of em-dashes.
  It took three greps and two corrective edits to clear, resolved by rephrasing to avoid the character entirely.
  Impact: about 6 tool calls, no rework beyond that file, caught before the commit.
  Both governing rules were already on the books and neither was applied: the root `AGENTS.md` addendum says to include such characters literally rather than as escape sequences, and `markdown-conventions` prescribes a placeholder plus a scripted substitution pass.
  The likely conflation is that the skill's recipe shows `'\u2014'` inside the substituting **script**, which reads as license to write the same escape in an `Edit` body.
  That this happened in the retro for the invisible-character issue makes it the most on-theme failure of the whole issue.
  It then recurred **in this retro**, about a minute after the corrective rule was drafted: the `git-workflow` edit below was written with `\\u2014` and landed the literal token, caught by grepping the two lines I had just written.
  Two data points now say the same thing, which is why the landed rule says write the character and says nothing about escaping it correctly.

#### What caused friction (user side)

- Nothing material.
  The ship ran unattended end to end with no correction needed, and the release decision was settled from the plan's marker rather than requiring an operator question.
- One opportunity, framed as such: the model switch from `claude-sonnet-5` to `claude-opus-5` landed mid-turn at turn 7, truncating that turn's text to `Sk` in the transcript.
  No work was lost and the switch itself was well targeted (see the model lens below); switching at a tool-call boundary rather than mid-generation would leave a cleaner transcript for exactly this kind of retro reading.

### Diagnostic details

- **Model-performance correlation** — no mismatch found, and the split tracked task character well.
  This ship session: `anthropic/claude-sonnet-5` for turns 2 through 7 (root and branch confirmation, lane detection, issue title, skill loading), then `anthropic/claude-opus-5` from turn 8 onward for the judgment-heavy remainder (the release decision, the plan-and-retro read, the anomaly diagnosis, and the close-comment draft).
  Peer session: `anthropic/claude-opus-5` through the TDD stage, switching to `anthropic/claude-sonnet-5` for the Sync stage, whose work is largely deterministic (two gates, a stage note, a rebase).
  The one quality event on the cheaper model was the `\u2014` escape slip during Sync, which is a rule-application failure rather than a reasoning one.
  No subagent ran in this session; the pre-completion reviewer ran in the peer's TDD stage and returned PASS.
- **Escalation-delay tracking** — 7 consecutive tool calls on the lint timeout (turns 16 through 22), which exceeds the 5-call threshold.
  The flag is worth recording with its nuance: this was systematic bisection with a named a-priori suspect, not thrash on a repeating error, and it terminated with a correct conclusion.
  Neither an `Explore` subagent nor an operator question would have helped, since the evidence was purely local timing.
  A secondary 6-call run in the peer's Sync stage (turns 14 through 19) on the `\u2014` literal sits just under the threshold and does indicate a rule that was not consulted.
- **Unused-tool detection** — nothing material.
  The friction points were an environment timing anomaly and a rule-application slip, neither of which a subagent, `colgrep`, or a web search would have shortened.
- **Feedback-loop gap analysis** — no gap.
  `/ship` positions both gates after the fast-forward merge by design, so they ran on exactly the tree being pushed, which the prompt argues for explicitly because `/sync-worktree` checks before it rebases.
  CI verification followed the push immediately, and the release probe ran before the close rather than after.

### Changes made

1. `docs/retro/0960-reject-stray-invisible-characters.md` — added this Final Retrospective stage entry (summary, observations, and the four diagnostic lenses).
2. `.pi/skills/markdown-conventions/SKILL.md` — after the placeholder recipe, added two lines: write the character itself in an `Edit`/`Write` body and never a `\uXXXX` token, and the recipe's escape belongs to the substituting script because hand-written in an edit body it arrives over-escaped and lands as literal text.
   The operator redirected the first draft, which had stated that a single-backslash escape does decode — true, but it reads as license to hand-write escapes, so the landed rule omits it.
3. `.pi/skills/git-workflow/SKILL.md` — after the redirect recipe in § Gating a commit on a check, added one line: do not append `; echo $?` to it, because `$?` on the failing branch is `tail`'s and a failed gate prints `0`.

Proposed and declined: a `/ship` step 5 line advising a single re-run before bisecting a gate that vastly exceeds its baseline.
The root cause of the 300-second timeout is still unexplained, so the rule would encode a guess from one incident, and a change that has just added a stage to `lint` makes bisection the correct instinct rather than the wrong one.
Also considered and rejected: any `AGENTS.md` addition (all three findings are topic-skill facts that fail the admission test's second question), a `/ship` revision to the close-comment anchor rule (its broader "the commit carrying the behavior" phrasing already covers a `build:` landing commit), and a second copy of the unpushed-root-commit rule that had just proven itself.
