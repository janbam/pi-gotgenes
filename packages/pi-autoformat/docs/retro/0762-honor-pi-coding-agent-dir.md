---
issue: 762
issue_title: "pi-autoformat: global config path ignores PI_CODING_AGENT_DIR"
---

# Retro: #762 — pi-autoformat: global config path ignores `PI_CODING_AGENT_DIR`

## Stage: Planning (2026-09-19T04:25:35Z)

### Session summary

Confirmed the defect by spike rather than by reading: a disposable `test/spike-762.test.ts` drove `createAutoformatExtension` with no injected `loadConfig` under a stubbed `PI_CODING_AGENT_DIR` and measured the red (`commandTimeoutMs` `10000` instead of the marker `424242`), then measured green with the fix applied plus `tsc` clean and 307/307 unit tests with zero existing-test edits.
Settled the design as boundary injection mirroring [#732], plus this package's first runtime SDK dependency, and wrote `docs/plans/0762-honor-pi-coding-agent-dir.md`.

### Observations

- The interesting divergence from [#732] is the manifest.
  `pi-autoformat` imports the SDK **type-only** and is the only one of the nine workspace packages with no `@earendil-works/pi-coding-agent` peer entry, so a value import of `getAgentDir` is a genuine new runtime dependency rather than a one-word import change.
  Verified at the real surface instead of assuming: Pi's extension loader aliases that specifier to its own bundled copy (`../../pi/packages/coding-agent/src/core/extensions/loader.ts:66` for binary mode, `:122` for jiti/Node mode), and `~/.pi/agent/npm/node_modules/@earendil-works/` contains only `pi-radius` while three installed siblings value-import `getAgentDir` in production today.
  The peer entry is floor documentation, not a resolution mechanism.
- The false-green shape is the mirror image of [#732]'s.
  There, a real `~/.pi/agent` config made a registration-shaped assertion pass pre-fix.
  Here, `PI_CODING_AGENT_DIR` is unset and `~/.pi/agent/extensions/pi-autoformat/` does not exist, so the pre-fix path yields built-in defaults silently — "a config was loaded" and "`createAutoformatter` was called" both pass before and after.
  Both hazards are closed by the same move: assert on a marker config *value* that only the temp scope can supply.
- `ask_user` settled two calls: mirror [#732] by making `cwd` and `agentDir` required (measured zero test churn, so the tidy is free), and declare the peer dependency at `>=0.79.0` rather than leaving the manifest dependency-free.
- Classified `fix:`, not `fix!:`, consistent with [#732] — the behavior change on upgrade is real but narrow, and the old read was accidental.
- The `pkg:pi-permission-system` label is contextual; `packages/pi-permission-system/docs/architecture/history/phase-14-capability-axis.md:105` already recorded this issue as out of scope for that roadmap, so the plan is single-package and ships independently.
- Documentation is in scope here where it was not in [#732]: `README.md:89`, `docs/configuration.md:9`, and `.pi/skills/package-pi-autoformat/SKILL.md:31` all state the global path without the variable.
  They are correct today and become wrong only once the code honors it, so they land in a separate `docs:` commit after the fix.
- Tidy-First assessor returned **no** Recommended preparatory commits and independently verified the three structural claims the design rests on: `createContext()` already accepts a `cwd` override, `test/config-loader.test.ts` already passes both scopes at every call site, and `test/extension.test.ts` has no existing hooks but does have a nested-`describe`-with-local-scaffolding precedent (line 568).

#### Deferred tidyings

- `packages/pi-autoformat/test/extension.test.ts` and `packages/pi-permission-model-judge/test/extension.test.ts` — the temp-`agentDir` global-config fixture (`mkdtempSync` → `mkdirSync(dirname(getGlobalConfigPath(…)))` → `writeFileSync` → `vi.stubEnv`) will be duplicated across two packages; extracting a shared helper means editing a second package's tests for a defect in this one.
- `packages/pi-autoformat/test/config-loader.test.ts` — seven `mkdtempSync` call sites with no teardown at all, relying on OS temp reaping.

## Stage: Implementation — TDD (2026-09-19T05:24:26Z)

### Session summary

Landed the plan's two steps unchanged: one `fix:` commit (the narrowed `config-loader.ts` signatures, the `getAgentDir()` value import and lazy call at the `extension.ts` boundary, the `peerDependencies` entry, and the regression test) and one `docs:` commit naming `PI_CODING_AGENT_DIR` in `README.md`, `docs/configuration.md`, and the package skill.
`pi-autoformat` unit tests went 306 → 307; `check`, root `lint`, workspace `test`, and `fallow dead-code` are green, the real-CLI acceptance suite passes, and the pre-completion reviewer returned PASS.

### Observations

- Both killing mutations behaved exactly as the plan predicted, which is what made them worth running.
  Replacing `getAgentDir()` with a hardcoded `join(homedir(), ".pi", "agent")` at the boundary killed **1** test — the new one — confirming it pins the wiring and nothing else does.
  Making `getGlobalConfigPath` ignore its parameter killed **5**: the new test plus the four global-config cases in `test/config-loader.test.ts`, confirming the new test asserts through the same path the loader actually uses rather than around it.
- Ran the real-CLI acceptance suite (`pnpm --filter @gotgenes/pi-autoformat run test:acceptance`, 2 tests, ~20 s) even though the plan did not ask for it.
  It is the only gate that exercises the new value import under Pi's own extension loader, which is the one risk the unit suite cannot speak to — the monorepo's `devDependency` would satisfy the import either way.
  Green.
- `pnpm install` produced no `pnpm-lock.yaml` change for the added `peerDependencies` block, and `pnpm install --frozen-lockfile` succeeds, so CI's frozen install is unaffected.
- `docs/configuration.md` got a blockquote note naming both the default and the overridden path rather than the inline `(respects PI_CODING_AGENT_DIR)` parenthetical the plan proposed; `README.md` and the skill use the parenthetical.
  The reviewer flagged the divergence and judged the prose accurate — the config reference is the place worth spelling out where the file actually lands.
- Pre-completion reviewer: **PASS**.
  One WARN under evidence provenance: the plan cited 8 `loadAutoformatConfig(` and 4 `getGlobalConfigPath(` call sites in `test/config-loader.test.ts`; the real counts are 7 and 5.
  The numbers came from the Tidy-First assessor's report and were not re-derived at planning time — the conclusion ("every call site already passes both scopes, so zero churn") held and was confirmed by the untouched file, but the figures were wrong.
  Corrected in the "docs: correct the config-loader.test.ts call-site counts in the #762 plan" commit.

## Stage: Sync (worktree) (2026-09-19T05:46:07Z)

### Session summary

Pre-push checks (`pnpm run lint`, `pnpm fallow dead-code`) both pass from the worktree root with no fixes needed.
The branch carries five commits beyond the plan's parent: the `fix:` ("honor PI_CODING_AGENT_DIR when loading the global config"), the `docs:` naming the variable in `README.md`/`docs/configuration.md`/the package skill, a `docs:` correcting a call-site count the pre-completion reviewer WARNed on, and the planning/TDD retro-note commits.
The plan's marker line is `**Release:** ship independently` — no batch, no deferred sibling.

**Peer session transcript:** `/Users/chris/.pi/agent/sessions/--Users-chris-development-pi-pi-packages-worktrees-issue-762--/2026-09-19T04-03-01-774Z_01a0b7d4-f40e-7448-a760-94f02a18ef37.jsonl` — read with `read_session_file({ path: "..." })` for message-level verification at land/retro time.

### Observations

No deferred work beyond what the plan's Open Questions already name (an absence-warning for the global config, and whether `src/index.ts` should stop re-exporting the two loader symbols) — both explicitly left unfiled in the plan itself.
Nothing else for the root session to pick up before rebasing.

## Stage: Final Retrospective (2026-09-19T05:57:47Z)

### Session summary

Shipped this issue through the worktree lane across four sessions: the branch fast-forward-merged onto `main`, CI passed on `b134c9a0`, the issue closed with the landing SHA, and `pi-autoformat-v5.1.10` released and verified.
The defect itself was a three-line fix whose whole cost sat in evidence discipline — a planning spike measured the red before the design was settled, two killing mutations matched their predicted kill counts exactly, and the one piece of rework in the entire issue was a relayed number nobody re-derived.

### Observations

#### What went well

- The planning spike is the reason this issue had no design rework.
  Rather than reading `config-loader.ts` and reasoning about the defect, the planning session wrote a disposable `test/spike-762.test.ts`, drove `createAutoformatExtension` with no injected `loadConfig` under a stubbed `PI_CODING_AGENT_DIR`, and measured red (`commandTimeoutMs: 10000`, the built-in default) against the marker `424242`.
  It then applied the candidate fix, measured green plus `tsc` clean plus 307/307 unit tests, and restored the tree from `/tmp` backups before writing a line of the plan.
  The design that reached the plan was already known to work.
- Both killing mutations matched their predicted kill counts, which is what made them worth applying.
  Hardcoding `join(homedir(), ".pi", "agent")` at the boundary killed exactly **1** test (the new one), pinning the wiring; making `getGlobalConfigPath` ignore its parameter killed exactly **5** (the new test plus four `config-loader.test.ts` cases), confirming the new test asserts through the loader's real path rather than around it.
  A prediction that matches is weak evidence on its own; a prediction that names two different numbers for two different mutations and hits both is not.
- `/sync-worktree`'s dangling-SHA check earned its place on a real case.
  The rebase rewrote `b90ecd11` to `23e1250d`, and the TDD stage note — written before the rebase — cited the old SHA in prose.
  The check caught it, and the citation was rewritten to name the commit by its subject.
  This is the hazard the step was added for (Refs #814, #914), firing for the first time on live input rather than on a constructed test.
- The `ask_user` gate priced its own options before asking.
  Making `cwd`/`agentDir` required was offered with a **measured** "zero test churn" — the spike had already confirmed all existing call sites pass both scopes — so the operator chose a tightening whose cost was known rather than estimated.
- The real-CLI acceptance suite ran unprompted, and it was the right call.
  The plan did not ask for it, but this change adds `pi-autoformat`'s first runtime SDK value import, and the unit suite cannot speak to whether that import resolves under Pi's own extension loader — the monorepo `devDependency` would satisfy it either way.
  Green on 2/2.

#### What caused friction (agent side)

- `missing-context` — the plan cited 8 `loadAutoformatConfig(` and 4 `getGlobalConfigPath(` call sites in `test/config-loader.test.ts`.
  The real counts are 7 and 5 (measured again on `main` at retro time: `grep -c` → 7, 5).
  The numbers came from the `tidy-first-assessor`'s report and were relayed into the plan without re-derivation.
  The assessor's *conclusion* — "every call site already passes both scopes, so zero churn" — was correct and was confirmed by the untouched file, so nothing downstream was wrong; only the figures were.
  Impact: one follow-up `docs:` commit ("docs: correct the config-loader.test.ts call-site counts in the #762 plan") after the pre-completion reviewer WARNed on it.
  No code rework, no design change.
- `instruction-violation` (self-identified, caught by the reviewer rather than the author) — `AGENTS.md` principle 4 says a number a command can produce is never authored, and principle 2 says a subagent's claim is the one to verify.
  Neither fired here because the number was *relayed*, not authored: the planner did not type it from memory, and a specific count is not the "universal claim" the `delegation` skill names.
  Sharper still, `.pi/prompts/plan-issue.md:156` pointed the wrong way — it instructs the planner to treat "a call-site count that is off" reported by the assessor as **a correction to the design**, which grants the assessor's arithmetic authority over the file.
  Here the assessor was the one that was wrong.
  Impact: the same one follow-up commit above; the prompt line would have produced the same outcome again on a re-run.
- `other` — a compound restore command (`cp /tmp/green-ext.ts … && grep -c homedir …`) reported failure because `grep -c` exits 1 on a zero count, which is exactly the post-mutation-revert state being confirmed.
  The `git-workflow` skill already documents this (`grep -c` exits 1 on a zero count).
  Impact: added friction but no rework — the session read the result correctly and continued.

#### What caused friction (user side)

Nothing to flag.
The operator answered the planning gate's two questions and did not intervene again across planning, TDD, sync, ship, or release — no corrections, no redirections, and no rework traceable to missing context.
The one place earlier context could in principle have helped (that `pi-autoformat` alone among the workspace packages carries no SDK peer entry) was discovered by the planning session itself, at the real surface, in one command.

### Diagnostic details

- **Model-performance correlation** — planning and TDD ran on `anthropic/claude-opus-5`, sync on `anthropic/claude-sonnet-5`, ship and this retro on `anthropic/claude-opus-5`.
  Both subagents (`tidy-first-assessor`, `pre-completion-reviewer`) are model-locked to `anthropic/claude-sonnet-5`.
  The one defect and the one catch both came from sonnet-5 subagents: the assessor produced the wrong call-site counts, and the reviewer caught them.
  No mismatch worth changing — the judgment-heavy stages (design, TDD sequencing) ran on the stronger model, and the mechanical stage (sync: two gates, a note, a rebase) ran on the cheaper one.
- **Escalation-delay tracking** — no `rabbit-hole` friction points, so no sequences to count.
  The longest same-target run in the peer transcript was five consecutive calls locating Pi's extension-loader alias for `@earendil-works/pi-coding-agent` (peer turns 30–35, narrowing from `../../pi/src` to `../../pi/packages/coding-agent/src/core/extensions/loader.ts`), which ended in the cited line rather than in a widening search.
- **Unused-tool detection** — nothing applicable; the one `missing-context` point needed no tool that was unavailable, only a `grep -c` the session had already run elsewhere.
- **Feedback-loop gap analysis** — verification ran incrementally throughout, not only at the end.
  The TDD session established a four-gate green baseline (`check`, root `lint`, `test`, `fallow dead-code`) before writing a test, ran the single affected test file at Red and at Green, ran `pnpm run check` after the `package.json` edit, ran `pnpm install --frozen-lockfile` to confirm CI's install was unaffected, and re-ran the four gates at end of cycle.
  `/ship` then re-ran root `lint` and `fallow dead-code` on the post-merge tree — the tree neither the peer's pre-rebase check nor CI had yet seen.

### Changes made

1. `.pi/skills/delegation/SKILL.md` — added two lines to § Reading the report: a **count** the report supplies is re-derived before it lands in a plan, an ADR, or an issue body, because the conclusion can be right while the arithmetic is wrong.
   This closes the gap between the two existing rules that both missed this case — `AGENTS.md` principle 4 governs a number you *author*, and the skill's neighboring line governs a *universal* claim; a relayed specific count is neither.
2. `.pi/prompts/plan-issue.md` — narrowed the Tidy First contradiction clause to *structural* contradictions (a missing function, a different interface shape) and split counts out: a reported count is a lead to re-run, not an authoritative correction to the design.
   The prior wording named "a call-site count that is off" as a design correction, which is what granted the assessor's wrong arithmetic authority over the file.
3. `packages/pi-autoformat/docs/retro/0762-honor-pi-coding-agent-dir.md` — this Final Retrospective stage entry.

[#732]: https://github.com/gotgenes/pi-packages/issues/732
