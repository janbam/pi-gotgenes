---
issue: 966
issue_title: "Use fallow as design feedback across the workflow: boundaries, review brief, snapshots, coverage"
---

# Retro: #966 — Use fallow as design feedback across the workflow

## Stage: Planning (2026-09-22T04:02:08Z)

### Session summary

Verified every surface the issue names against the 3.22.0 binary (`--help`, `config-schema`, and live runs on this checkout) rather than the 3.27.0 docs, spiked a boundaries config to the point of a zero-violation ratchet with a killing mutation, and measured the snapshot, coverage, and type-aware behaviors the design rests on.
A bundled three-question gate settled the rule model (ratchet narrowed by documented principles), the review depth (`decision-surface` JSON in the reviewer; `guard`/`inspect`/`symbol-impact` in the assessor), and the coverage scope (add `@vitest/coverage-istanbul`, after a timing spike the operator asked for).
Plan committed as `docs/plans/0966-fallow-design-feedback.md`, seven `/build-plan` steps.

### Observations

- Three issue premises did not survive the real surface: the `coverage-gaps` rule at `warn` is inert on 3.22.0 (the `--coverage-gaps` flag works without it); a snapshot records no workspace and `--trend` reads only the gitignored `.fallow/snapshots/`, so per-package trending needs a copy recipe; and `boundaries.coverage.requireAllFiles` does not report a new unzoned `src/` directory, so `autoDiscover` covers that case instead.
- Two measured findings for the skill refresh: `--type-aware --symbol-impact` misses a consumer that receives the symbol as an object-literal shorthand property (`index.ts` for `buildAgentPrompt`) while reporting `confidence: high` (syntactic `--trace` finds it), and `--type-aware` clears 3 of the repo's 5 `unused-class-member` suppressions but abstains on the 2 reached through a field typed by a structural interface.
- The coverage spike was cheap to run (install, measure, revert in about a minute) and moved the decision: real coverage flipped `agent-tool.ts` from 13.8 to 42.0 CRAP and dropped seven estimated flags, at +0.6 s test time.
- The boundary derivation is fallow-native (empty `allow` lists, read `boundary_violations`), so the plan carries a recompute recipe and a verify count rather than a script; the derived table is in the plan for cross-checking only.
- `decision-surface`'s `coupling-boundary` category fires only on an edge a rule forbids, which is why the ratchet (every zone ruled) rather than principle-only rules was the recommended option.
- Tidy-First assessment skipped: no `src/` or `test/` file changes.
- Not filed anywhere: the `--symbol-impact` miss is a candidate upstream report (`fallow-rs/fallow`), left as an Open Question for the operator.

#### Deferred tidyings

- `packages/pi-subagents/src/lifecycle/subagent.ts` — the only `lifecycle → observation` value import (`subscribeSubagentObserver`); the ratchet allows it, the doc states no ordering.
- `packages/pi-subagents/src/observation/renderer.ts` — the only `observation → ui` imports (`display`, `glyphs`).
- `packages/pi-permission-system/src/config/config-loader.ts` — `config → policy` value import (`mergeFlatPermissions`) against the doc's "consumed by `policy/`".
- `packages/pi-permission-system/src/path/pi-infrastructure-read.ts` — `path → policy` value import (`wildcardMatch`).
- `packages/pi-permission-system/src/service/bash-advisory-check.ts` — `service → handlers` value import (`resolveBashCommandCheck`).

## Stage: Implementation — Build (2026-09-22T09:36:19Z)

### Session summary

Executed all seven plan steps as separate commits: the boundary zones and 22 ratchet rules in `.fallowrc.json`, the architecture-doc and package-skill records of them, `fallow decision-surface` in the `pre-completion-reviewer`, `guard`/`inspect`/`symbol-impact` in the `tidy-first-assessor`, `@vitest/coverage-istanbul`, per-package vital-signs snapshots with the trend recipe, and the `fallow` skill rewrite.
Every number the plan predicted reproduced on execution, and the `pre-completion-reviewer` re-derived each one independently and returned PASS.

### Observations

- One deviation: the plan predicted Biome ignores `packages/*/docs/fallow-snapshot.json` (a planning probe reported the path as ignored, which was wrong).
  Biome does check it, and fallow writes no trailing newline, so `biome.json` now excludes the generated file rather than every writer having to fix it up.
  Recorded in the `bc8bbc34` commit body; the reviewer byte-compared a fresh snapshot against the committed one to confirm the defect is real and the exclusion correctly scoped.
- The boundary allow lists were re-derived from an empty-allow run at build time rather than copied from the plan's table, per the plan's own instruction; the derived edges matched the table.
- The step 1 killing mutation needed a second attempt: the first appended an unused `export`, which is an `error`-severity finding of its own and made `fallow dead-code` exit 1, masking the question being asked.
  With the import actually consumed, the boundary violation is reported and the exit code stays 0, confirming that `warn` leaves the `main` gate intact.
- New fact recorded in both the architecture doc and the skill: `allowTypeOnly` reads the `import type` **syntax**, not the imported symbol's kind, so a plain `import { SomeType }` on a type-only edge is still a violation.
- Emitting em-dashes into `Edit` `oldText` failed repeatedly in this session (arriving as stray characters and rejecting the whole atomic batch).
  Three prose edits were made with the `markdown-conventions` scripted-substitution path (Python with `\u2014` escapes) instead; the pattern worked first try each time.
  Corrected in the Final Retrospective below: a spike refuted the "corrupted in transit" reading of this — `Edit` matches and writes a real em-dash without complaint, and the failures were the model emitting the wrong token.
- Pre-completion reviewer: PASS, no WARN findings.
  It independently reproduced the full Test Impact Analysis table, including the `--symbol-impact` false negative (one consumer vs `--trace`'s two), and confirmed no other fallow-describing doc (`AGENTS.md`, `README.md`, the ship/sync prompts, four other skills) went stale.

## Stage: Final Retrospective (2026-09-22T15:46:52Z)

### Session summary

One session carried #966 end to end: planning (measuring every fallow surface the issue named against the pinned 3.22.0 binary), seven `/build-plan` commits, ship, and this retrospective.
The change wires fallow into the workflow as design feedback — boundary zones, a decision surface in review, per-package health snapshots, real coverage — and released `pi-subagents-v21.7.6` and `pi-permission-system-v33.0.6`.

### Observations

#### What went well

- **Deriving the ratchet from fallow's own output.**
  The plan specified writing 22 rules with empty `allow` lists, reading `boundary_violations` (502, the whole cross-directory matrix), and filling the lists from that.
  No hand-written script produced the data, so the build session re-derived it rather than trusting a planning-time table — and the two agreed.
  This is a pattern worth reusing whenever a config's content is a fact about the codebase rather than a preference.
- **The operator's "let's spike the timing" on the coverage gate.**
  The `ask_user` option priced `@vitest/coverage-istanbul` as an estimate.
  One instruction turned it into a measurement (install, run, revert, about a minute), which both confirmed the cost was negligible (3.96 s vs 3.33 s, same 1830 tests) and surfaced the finding that sold the option: real coverage moves `agent-tool.ts` from an estimated 13.8 CRAP to 42.0 and drops the above-threshold count from 12 to 5.
  The estimate would have shipped a weaker justification.
- **Three planning premises died against the real binary before the plan was written.**
  The `coverage-gaps` rule is inert at `warn` on 3.22.0, `boundaries.coverage.requireAllFiles` does not report a genuinely new unzoned directory, and `--trend` has no configurable snapshot directory (checked the config schema *and* the binary's strings).
  Each would have become a plan step that quietly did nothing.

#### What caused friction (agent side)

- `missing-context` — the plan asserted "Biome ignores the file (measured: `biome format` reports the path as ignored by configuration)".
  The probe ran against `packages/pi-subagents/docs/fallow-snapshot.json`, and `packages/pi-subagents/biome.json` sets `formatter.enabled: false` — so a package-local config answered a question the plan then generalized to `packages/*`.
  The build-time failure came from the `pi-permission-system` path, which has no nested config.
  Impact: one lint failure mid-step, an unplanned `biome.json` edit, and a deviation to record in the commit body and the plan's own prediction table.
- `missing-context` — the plan's Release Recommendation reasoned that nothing would release because the snapshot sits outside every package's `files` allowlist.
  That is true and irrelevant: the allowlist governs the npm tarball, while `CLIFF_EXCLUDED_DOC_DIRS` governs release scope, and it excludes `docs/<sub>/**`, not a file sitting directly in `docs/`.
  Impact: `/ship` predicted "releases nothing" and then released two packages.
  No rework — `next-version.sh` was consulted before dispatch, exactly as `/ship` step 8 requires — but the plan and the build summary both carried a wrong claim to the operator.
- `other` (token selection) — ten `Edit` batches failed because U+2014 left the model as a tab plus `a`, as a bare newline, or as the literal escape `\u2014`, each rejecting a whole atomic batch.
  My first reading, recorded in the build stage above, was that something corrupted the character in transit; the operator challenged it and a three-trial spike refuted it.
  `Edit` matched and wrote a real em-dash every time, the `Read` result the model saw held a real U+2014, and trial 2 reproduced the bug live when I emitted the escape instead of the character.
  The cause is in our own documentation: `markdown-conventions` § Non-ASCII taught the scripted-escape recipe one line *before* forbidding the escape token, so the wrong token was the one in front of the reader.
  Impact: about ten extra tool calls, plus a wrong diagnosis that reached the operator twice before it was tested.
- `instruction-violation` (self-identified, twice) — used `echo ===` and `echo ======` as output separators, which AGENTS.md's Shell section explicitly forbids because zsh's `equals` expansion aborts the command and discards the rest of the chain.
  Impact: two wasted tool calls, each losing the commands after the separator.
  The rule exists and is prominent; this is a salience failure, not a documentation gap.

#### What caused friction (user side)

- Nothing blocking.
  The single `ask_user` gate resolved all three open design questions in one round, and the one follow-up instruction ("let's spike the timing") was the highest-value intervention of the session.

### Diagnostic details

- **Model-performance correlation** — four models across the stages, attributed from the transcript's inline labels: planning on `anthropic/claude-fable-5-1`, build and this retrospective on `anthropic/claude-opus-5`, ship on `anthropic/claude-sonnet-5`, and the `pre-completion-reviewer` subagent on `anthropic/claude-sonnet-5` (read from its own transcript under `tasks/`, matching its agent definition).
  No mismatch: the measurement-heavy planning and the judgment-heavy review both ran on capable models, and the mechanical ship sequence on the cheapest of the three.
- **Pre-completion review cost** — the reviewer ran 93 tool uses, about 1.1M tokens, and roughly 5.2 hours of wall clock for a change touching no `src/` file.
  The dispatch prompt named three claims to re-derive (per the `delegation` skill's "hand a reviewer the raw source and a mandate to re-derive"), and it did re-derive them, including byte-comparing a fresh snapshot against the committed one.
  The cost is the price of that rule rather than a defect, but it is worth knowing that a full re-derivation mandate on a docs change is a multi-hour dispatch.
  It also emitted its report twice — a first, truncated copy followed by a complete one.
- **Escalation delay** — no sequence exceeded two consecutive failures on the same error.
  The em-dash batches failed twice before the strategy changed, which is inside the threshold.
- **Feedback-loop gaps** — none.
  `pnpm run lint` ran after every step and before every commit, the plan's verification battery ran inside the step that created each claim, and the full suite plus `check` ran once at the end (the only `src/`-adjacent change was the lockfile).

### Changes made

1. `.pi/skills/markdown-conventions/SKILL.md` § Non-ASCII in authored prose — reordered so the "write the character, never a `\uXXXX` token" prohibition comes before the scripted-placeholder recipe it was previously stated after, and extended the rule to `oldText` *matching* with the three failure shapes measured here.
2. `.pi/skills/releasing/SKILL.md` § What cuts a release — a file directly under `packages/<pkg>/docs/` cuts a release, because the exclusions match `docs/<sub>/**`; tarball scope and release scope are different lists.
3. `.pi/skills/reproduction/SKILL.md` § Place the control on the far side of the system under test — a monorepo probe answers only for the package it ran in; re-run under a package with no local override before generalizing to `packages/*`.
4. `docs/retro/0966-fallow-design-feedback.md` — this entry, plus a correction pointer on the build-stage em-dash observation the spike refuted.
