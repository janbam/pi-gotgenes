---
issue: 966
issue_title: "Use fallow as design feedback across the workflow: boundaries, review brief, snapshots, coverage"
---

# Use fallow as design feedback across the workflow

## Release Recommendation

**Release:** ship independently

The issue is `scope:repo` and belongs to no package roadmap.
Nothing under `packages/*/src` changes; the only package-tree files touched are architecture docs and a snapshot JSON, both outside release scope, so `/ship` dispatches no release.

## Problem Statement

The fallow integration dates from `543d41a4` and uses four surfaces: `dead-code` as the `main` gate, `audit` on PRs, `health --score --hotspots --targets` for phase planning, and `dupes`.
Fallow 3.22.0 (our pin) also ships architecture boundaries, a type-aware companion, a change-review brief with a decision surface, static test-reachability analysis, and vital-signs snapshots — none of which the workflow uses, and the `fallow` skill still describes the tool as "syntactic analysis only".
The issue asks for fallow to feed design decisions across the workflow, not only to gate cleanup.

## Goals

- Encode the two domain-partitioned packages' directory trees as fallow boundary zones with allow-list rules, so `guard`, `audit`, and `decision-surface`'s `coupling-boundary` category have something to check.
- Hand the `pre-completion-reviewer` the decision surface of the range it reviews, and hand the `tidy-first-assessor` fallow's per-file evidence for the files a change will touch.
- Commit a per-package vital-signs snapshot and make `/finish-phase` trend against it, retiring the prose about which `--score` form produced a baseline.
- Add the Istanbul coverage feed so `/plan-improvements` reads real CRAP scores, and document `--coverage-gaps` as a planning input.
- Refresh the `fallow` skill to describe the current surface, with the measured limits of the type-aware companion.

Not breaking: no package source, default, or published contract changes.

## Non-Goals

- `fallow decision-surface` in `/ship`.
  The template lands and releases; it reads no diff for review purposes today, so there is no step for a decision surface to inform.
- Zones for the seven packages with a flat or two-directory `src/` (`pi-colgrep` and `pi-github-tools` have `lib/` + `tools/`; the rest have no subdirectories).
  No architecture doc states a layering for them.
- Promoting `boundary-violation` from `warn` to `error`, and `boundaries.coverage.requireAllFiles`.
  A spike showed `requireAllFiles` does not report a new unzoned `src/newdir/a.ts` on 3.22.0 (it reported only root-level `test/*.mjs` and config files), so it pins nothing useful; `autoDiscover` covers the new-directory case instead.
- Resolving the measured edges that deviate from the documented layering (listed under Design Overview).
  The ratchet allows them; they are leads for each package's next `/plan-improvements` discovery, not this change.
- Turning on the `coverage-gaps` rule.
  Setting it to `warn` produced no finding in `fallow`, `fallow audit`, or `fallow health` on 3.22.0 (measured); the `--coverage-gaps` flag works without it.
- Bumping the fallow pin.
  3.28.0 was published today and 3.27.0 five days ago; nothing in this plan needs a flag 3.22.0 lacks, and the CHANGELOG through 3.28.0 records no fix for the `--symbol-impact` miss below.
- `fallow similar-code` setup.
  It needs an explicit local model download (`similar-code setup`), so the skill records it as opt-in and nothing installs it.
- `fallow agent install`, runtime coverage, Fallow Cloud (issue's own exclusions).
- The full walkthrough contract (`review --walkthrough-guide` / `--walkthrough-file`) in the reviewer.
  The operator chose the lighter `decision-surface` JSON; the walkthrough loop is available if the decision surface proves useful and a hash-pinned anti-hallucination check is wanted later.

## Background

- `.fallowrc.json` declares entry points, ignore patterns, a test-file `maxUnitSize` override, and ten rules at `error`.
  It has no `boundaries`, so `fallow guard <file>` reports every file as unrestricted.
- Root `package.json` scripts: `fallow`, `fallow:audit`, `fallow:health` (`--score --hotspots --targets`), `fallow:dead-code`, `fallow:dupes`.
  CI runs `fallow audit --base origin/<base>` on PRs and `fallow dead-code` (gate) plus `fallow` (report, `continue-on-error`) on `main`.
- `.pi/agents/pre-completion-reviewer.md` runs four deterministic checks and ten judgment sections; its Bash allowlist names the commands it may run.
  `.pi/skills/pre-completion/SKILL.md` computes the modified-files list and dispatches it.
- `.pi/agents/tidy-first-assessor.md` reads target files by hand; `.pi/skills/tidy-first/SKILL.md` dispatches it with a target-files list and a design summary.
- `.pi/prompts/finish-phase.md` Step 3 carries two bullets explaining that `fallow health --score` and the `fallow:health` script disagree (78 B vs 88 A for pi-subagents) and how to reproduce a doc baseline.
- `.pi/skills/improvement-discovery/SKILL.md` Step 3 lists the three fallow commands `/plan-improvements` runs for corroboration and baseline.
- `.pi/skills/fallow/SKILL.md` gotcha 1 says fallow is syntactic with no TypeScript compiler; gotcha 6 says class-member liveness is keyed off `implements`.
- `packages/pi-subagents/docs/architecture/architecture.md` § Current layout lists eight domain directories plus six root modules; its health-metrics table says every non-LOC row "is a `fallow health` field".
  `packages/pi-permission-system/docs/architecture/architecture.md` § Module structure lists twelve domain directories plus five root modules and states per-directory constraints (`policy/` "depends on `config/` for loading and on nothing above it"; `permission-manager.ts` must not import `AccessPath`, lint-guarded by ESLint `no-restricted-imports`).
- `.gitignore` ignores `.fallow/` and `coverage/`.
- AGENTS.md constraints that apply: never `npx`; a number a command can produce is never authored (the snapshot, the zone file counts, the timings below); mechanism is forever, docs are reversible (every step here is config or prose except one devDependency).

### What was measured on fallow 3.22.0

All numbers below were measured on this checkout at `d7c0311d` unless labeled estimated.

- Boundaries: a config with every zone's `allow: []` reports **502** `boundary_violations`, which is the whole cross-directory import matrix; filling each zone's `allow` from that list yields **0** violations, and appending a value import from `authority/decision-source` to `policy/rule.ts` yields **1**.
  Zone names from `autoDiscover: ["packages/pi-subagents/src"]` are `pi-subagents/<dir>`; root `src/*.ts` files are not covered by `autoDiscover` (63 of 69 files), so a `core` zone with an explicit pattern is needed.
  `allowTypeOnly` admits an `import type` edge and rejects a value import on the same edge.
  `decision-surface`'s `coupling-boundary` question fires only when a rule forbids the new edge; a new edge into an unruled zone asks nothing.
- Decision surface: `pnpm --silent fallow decision-surface --base HEAD~15 --format json --quiet` on the #864 range returns one `public-api-contract` decision (`AgentWidget` in `ui/agent-widget.ts`, one consumer outside the diff) with `signal_id`, `question`, `anchor_file`, `anchor_line`, `blast`, `consequence`, `tradeoff`.
  Human format prints nothing under `--quiet`; JSON is the surface.
- Snapshots: `health --save-snapshot <path> --workspace @gotgenes/pi-subagents` runs in 3 s and writes an 11-metric JSON (score 77.8 B, 165 files) that does **not** record its workspace scope.
  `--trend` reads only `.fallow/snapshots/` (gitignored; no config key or env var overrides the directory — checked the config schema and the binary's strings) and compares against the most recent file there.
  Copying the committed snapshot into an emptied `.fallow/snapshots/` and running `--trend --workspace @gotgenes/pi-subagents` reports "All 11 metrics unchanged".
  The snapshot's score is the hotspot-inclusive one (`--save-snapshot` "forces file-scores, hotspot, and score computation"), which is the number the architecture docs already carry (78 B).
- Coverage: `pnpm --filter @gotgenes/pi-subagents exec vitest run --coverage --coverage.provider istanbul --coverage.reporter json --coverage.reportsDirectory /tmp/cov-pi-subagents` takes 3.96 s against 3.33 s without coverage (1830 tests both) and writes a 552 KB `coverage-final.json` (80 files, absolute paths) that fallow matches without `--coverage-root`.
  `fallow health --coverage <file> --workspace @gotgenes/pi-subagents` takes 2.6 s and reports "CRAP from Istanbul coverage data (813/13539 functions matched)"; `crap_max` changes in 59 of 66 `src/` files, `src/tools/agent-tool.ts` moves 13.8 (estimated) → 42.0 (real, above the 30 threshold), and the above-threshold file count drops 12 → 5.
  `@vitest/coverage-istanbul@4.1.11` (published 2026-08-18) matches the catalog's `vitest: ^4.1.11`; installed at the root it resolves from a package directory and `fallow dead-code` reports no `unused-dev-dependencies` finding for it.
- Coverage gaps: repo-wide `health --coverage-gaps` reports 8 untested files and 50 untested exports; 24 of the exports are `packages/pi-autoformat/src/index.ts` barrel re-exports whose tests import the source module directly.
- Type-aware: the companion is installed (`type-aware status`: 3.22.0, protocol 7, TypeScript 7.0.2).
  `dead-code --type-aware` takes 16 s against 2 s syntactic.
  With all five `unused-class-member` suppressions removed, syntactic reports 5 findings; `--type-aware` reports 2 ("5 candidates, 1 confirmed use, 2 preserved contracts, 2 abstained") — the survivors are `SubagentManager.hasRunning` / `waitForAll`, called through `this.manager` typed as the structural `SubagentManagerLike`.
  `health --type-aware --type-coupling --workspace <PKG>` reports "no-coupling-found (Unavailable)" unless `--type-aware-project packages/<PKG>/tsconfig.json` is passed; with it, pi-permission-system shows 15 edges across 11 of 341 files and `src/service.ts` "depends on 5, used by 1".
  `dead-code --type-aware --symbol-impact packages/pi-subagents/src/session/prompts.ts:buildAgentPrompt` reports `consumers-found (complete, confidence: high)` with **only the test** as a direct consumer; it misses `src/index.ts`, which imports `buildAgentPrompt` and passes it as an object-literal shorthand property.
  Syntactic `dead-code --trace` on the same symbol lists both.
  `--symbol-impact` on `runtime.ts:createSubagentRuntime` (called directly from `index.ts`) and `ui/display.ts:formatTokens` finds every consumer.

## Design Overview

### Boundaries (the unlock)

Zones mirror the directory trees the architecture docs already document, one logical group per package with `autoDiscover` plus an explicit `core` zone for root modules:

```jsonc
"boundaries": {
  "zones": [
    { "name": "pi-subagents", "autoDiscover": ["packages/pi-subagents/src"] },
    { "name": "pi-subagents/core", "patterns": ["packages/pi-subagents/src/*.ts"] },
    { "name": "pi-permission-system", "autoDiscover": ["packages/pi-permission-system/src"] },
    { "name": "pi-permission-system/core", "patterns": ["packages/pi-permission-system/src/*.ts"] }
  ],
  "rules": [ /* 22 entries, one per zone, derived below */ ]
},
"rules": { /* existing ten */, "boundary-violation": "warn" }
```

`autoDiscover` means a new domain directory becomes a zone the moment it exists (unruled, so unrestricted, but visible to `guard` and `list --boundaries`).

The rule model is a **ratchet narrowed by the documented principles**: each zone's `allow` list is exactly the set of zones it imports today, so the baseline is zero violations and every *new* cross-zone edge is a finding and a `decision-surface` question.
Where the architecture doc constrains a directory and the measured edges are type-only, the edge moves to `allowTypeOnly`: `policy/` imports `authority`, `exposure`, and `session` only as types (`permission-gate.ts` lines 1–3, `permission-resolver.ts` lines 7–8), which is how "depends on `config/` for loading and on nothing above it" holds at the value level.

Derivation is fallow-native, so no script is needed: write every rule as `{ "from": "<zone>", "allow": [] }`, run `pnpm --silent fallow dead-code --format json --quiet 2>/dev/null || true`, and read `boundary_violations[].from_zone` / `to_zone` into the allow lists.
The result at `d7c0311d`, one row per zone (zone names drop the package prefix):

| Package              | Zone            | `allow`                                                                                                     |
| -------------------- | --------------- | ----------------------------------------------------------------------------------------------------------- |
| pi-subagents         | `config`        | `core`                                                                                                      |
| pi-subagents         | `session`       | `config`, `core`                                                                                            |
| pi-subagents         | `lifecycle`     | `config`, `core`, `observation`, `session`                                                                  |
| pi-subagents         | `observation`   | `core`, `lifecycle`, `ui`                                                                                   |
| pi-subagents         | `service`       | `config`, `core`, `lifecycle`, `session`                                                                    |
| pi-subagents         | `tools`         | `config`, `core`, `lifecycle`, `observation`, `session`, `ui`                                               |
| pi-subagents         | `ui`            | `config`, `core`, `lifecycle`                                                                               |
| pi-subagents         | `handlers`      | `core`                                                                                                      |
| pi-subagents         | `core`          | `config`, `handlers`, `lifecycle`, `observation`, `service`, `session`, `tools`, `ui`                       |
| pi-permission-system | `access-intent` | `config`, `core`, `path`, `tool-input`                                                                      |
| pi-permission-system | `authority`     | `access-intent`, `config`, `core`, `logging`, `path`, `presentation`, `service`, `session`, `tool-input`    |
| pi-permission-system | `config`        | `core`, `logging`, `path`, `policy`                                                                         |
| pi-permission-system | `exposure`      | `core`, `path`                                                                                              |
| pi-permission-system | `handlers`      | every other zone                                                                                            |
| pi-permission-system | `logging`       | `access-intent`, `config`, `core`, `service`                                                                |
| pi-permission-system | `path`          | `access-intent`, `policy`                                                                                   |
| pi-permission-system | `policy`        | `access-intent`, `config`, `core`, `path`; `allowTypeOnly`: `authority`, `exposure`, `session`              |
| pi-permission-system | `presentation`  | `access-intent`, `authority`, `config`, `core`, `exposure`, `session`, `tool-input`                         |
| pi-permission-system | `service`       | `access-intent`, `authority`, `core`, `handlers`, `path`, `policy`, `presentation`, `session`, `tool-input` |
| pi-permission-system | `session`       | `access-intent`, `authority`, `config`, `exposure`, `handlers`, `path`, `policy`, `tool-input`              |
| pi-permission-system | `tool-input`    | `access-intent`, `core`, `logging`                                                                          |
| pi-permission-system | `core`          | every other zone                                                                                            |

The build session re-derives the table from the empty-allow run rather than copying it — an import landed since planning changes a row, and the verify criterion is the violation count, not the table.

Edges the ratchet allows that the documented layering does not sanction, recorded in each architecture doc as leads for the next discovery round, not resolved here:

- pi-permission-system: `config → policy` value import (`config-loader.ts` imports `mergeFlatPermissions` from `policy/permission-merge`) against "consumed by `policy/`"; `path → policy` (`pi-infrastructure-read.ts` imports `wildcardMatch`); `service → handlers` (`bash-advisory-check.ts` imports `resolveBashCommandCheck`).
- pi-subagents: `lifecycle → observation` (`subagent.ts` imports `subscribeSubagentObserver`) and `observation → ui` (`renderer.ts` imports `display` and `glyphs`); the doc states no ordering between these directories.

The existing ESLint `no-restricted-imports` rule on `permission-manager.ts` stays: it is file-level and finer than a zone.

Extending a rule is the intended path for a new edge: add the zone to `allow` in the same commit as the import and say in the commit body why the coupling is intended.
That commit is the record the `coupling-boundary` decision asks for.

### Review wiring

The `pre-completion` skill's Step 1 already anchors on the plan commit; it adds the base ref to what it passes:

```bash
PLAN=$(git log --format=%H --grep="^docs: plan .*(#N)$" -1)
BASE_REF="$PLAN^"
```

The reviewer gains a Bash-allowlist entry and a judgment section `2k. Decision surface`:

```bash
pnpm --silent fallow decision-surface --base "$BASE_REF" --format json --quiet 2>/dev/null || true
```

For each entry in `decisions[]` the reviewer answers the `question` against the diff, cites the `signal_id`, and classifies: **PASS** when the range itself answers it (a `public-api-contract` whose out-of-diff consumers are updated or covered by a test in the range; a `coupling-boundary` whose rule edit lands in the same range with a commit body naming the intent); **WARN** otherwise, quoting the question.
An empty `decisions` array is **PASS — no decisions surfaced**; a non-JSON result (fallow absent, exit 2) is **SKIP** with the reason.
The output block gains a matching `### Decision surface` section, and the severity model lists an unanswered decision under WARN.
The section is judgment, not a gate — `decision-surface` "always exits 0 (advisory, never a gate)".

The assessor has no diff to run `decision-surface` on; its evidence is per-file.
It gains three allowlisted commands and a line in Step 1:

```bash
pnpm --silent fallow guard <target files> --quiet
pnpm --silent fallow inspect --file <target> --quiet
pnpm --silent fallow dead-code --trace <file>:<symbol> --quiet
pnpm --silent fallow dead-code --type-aware --symbol-impact <file>:<symbol> --quiet
```

`guard` answers which zones a target may import, so a preparatory extraction that would add a cross-zone edge is reported as a design signal rather than proposed as a tidying; `inspect` gives fan-in, fan-out, and export counts; the `--trace` / `--symbol-impact` pair answers who consumes a symbol the design renames or narrows.
The `tidy-first` skill's dispatch prompt adds one input — **symbols the design alters** (renamed, narrowed, removed) — so the assessor has targets for the pair.

### Snapshots

Each package with a health-metrics table commits `packages/<PKG>/docs/fallow-snapshot.json`, written by:

```bash
pnpm --silent fallow health --save-snapshot packages/<PKG>/docs/fallow-snapshot.json --workspace @gotgenes/<PKG> --quiet >/dev/null 2>&1 || true
```

The path sits outside every package's `files` allowlist (`docs/*.md` matches markdown only; `docs/architecture` is a directory entry), so nothing ships in a tarball.
Biome ignores the file (measured: `biome format` reports the path as ignored by configuration), so `pnpm run lint` is unaffected.

Reading a trend is a three-line recipe that lives in the prompts, not a mechanism:

```bash
rm -rf .fallow/snapshots && mkdir -p .fallow/snapshots
cp packages/<PKG>/docs/fallow-snapshot.json .fallow/snapshots/baseline.json
pnpm --silent fallow health --trend --workspace @gotgenes/<PKG> --quiet 2>&1 | grep -A 12 'Trend'
```

The `rm` is load-bearing: a snapshot records no workspace, and `--trend` picks the most recent file, so a stale sibling snapshot would be compared silently.

`/finish-phase` Step 3 reads the trend for delivered-vs-baseline, then rewrites the snapshot as part of the reconciliation commit so the next phase starts from the closed one.
`/plan-improvements` Step 3 reads the trend as the drift since phase close.
The two `finish-phase.md` bullets about reproducing a doc baseline under the `--score` form collapse to the recipe; the recorded per-metric recompute commands in the phase findings tables are untouched.

The pi-permission-system snapshot taken in this issue is dated mid-Phase 15; its `/finish-phase` measures Phase 15 against the table's recorded recompute commands as today and trends only from this snapshot's date, then overwrites it.

### Coverage

`@vitest/coverage-istanbul` enters the catalog (`"@vitest/coverage-istanbul": "^4.1.11"`) and the root `devDependencies` as `catalog:`.
No per-package `package.json` changes (each is in release scope and would trigger a release for tooling).
The `improvement-discovery` skill's Step 3 gains the recipe:

```bash
pnpm --filter @gotgenes/<PKG> exec vitest run --coverage --coverage.provider istanbul --coverage.reporter json --coverage.reportsDirectory /tmp/cov-<PKG>
pnpm --silent fallow health --coverage /tmp/cov-<PKG>/coverage-final.json --score --hotspots --targets --workspace @gotgenes/<PKG> 2>&1 || true
```

For pi-autoformat the first command adds `--project unit` (its acceptance project spawns the real `pi`).
The skill's existing CRAP caveat ("run `fallow health --coverage <file>` with a real coverage file") becomes the instruction rather than a warning.
`health --coverage-gaps --workspace @gotgenes/<PKG>` joins the same step as a reachability input, with the barrel caveat: an export re-exported from `index.ts` whose tests import the source module reads as untested, so the finding is about the barrel, not the code.

### Type-aware coupling and the skill refresh

`health --type-aware --type-aware-project packages/<PKG>/tsconfig.json --type-coupling --workspace @gotgenes/<PKG>` joins Step 3 of `improvement-discovery` as an ISP/DIP signal (a file that "depends on N, used by 0" is a dependency-bag lead), with the `--type-aware-project` requirement stated.
`similar-code` is listed as opt-in with its `setup` requirement and no instruction to run it.

The `fallow` skill is rewritten around the current surface:

- Quick reference keeps the scripts and adds the subcommands this plan wires (`guard`, `list --boundaries`, `decision-surface`, `review --brief`, `health --save-snapshot` / `--trend`, `--coverage`, `--coverage-gaps`, `--type-aware`).
- A **Boundaries** section: zones mirror directories; extending `allow` in the same commit is the sanctioned path; `guard <file>` before adding an import.
- A **Type-aware companion** section replacing gotcha 1: opt-in per invocation (`--type-aware`), 16 s vs 2 s measured, `--type-coupling` needs `--type-aware-project`.
- Gotcha 6 rewritten with the measurement: `--type-aware` clears a suppression whose consumer is reached through a declared contract (3 of 5 here) and abstains when the call goes through a field typed by a structural interface (2 of 5); the suppression guidance stands for the latter.
- A **Proving "nothing else calls this"** entry: run `--trace` and `--type-aware --symbol-impact` together and trust the union; `--symbol-impact` missed a consumer that passes the symbol as an object-literal shorthand property while reporting `confidence: high` (measured on 3.22.0; CHANGELOG through 3.28.0 records no fix).
- The three "it is syntactic" parentheticals elsewhere (`plan-improvements.md` line 35, `improvement-discovery` lines 16 and 305, `craftsmanship-scout.md` line 19) are reworded to say what they mean — fallow measures structure, not intent — since the companion makes "syntactic" false as a description of the binary.

## Module-Level Changes

- `.fallowrc.json` — add `boundaries` (4 zone entries, 22 rules) and `"boundary-violation": "warn"`.
- `pnpm-workspace.yaml` — catalog entry `"@vitest/coverage-istanbul": "^4.1.11"`.
- `package.json` (root) — `devDependencies["@vitest/coverage-istanbul"]: "catalog:"`.
- `pnpm-lock.yaml` — regenerated by `pnpm install`.
- `packages/pi-subagents/docs/fallow-snapshot.json`, `packages/pi-permission-system/docs/fallow-snapshot.json` — new, command output.
- `.pi/agents/pre-completion-reviewer.md` — Bash allowlist, **Input** gains the base ref, new `2k. Decision surface` section, severity model, output block.
- `.pi/skills/pre-completion/SKILL.md` — Step 1 computes `BASE_REF`; Step 2's example prompt carries it.
- `.pi/agents/tidy-first-assessor.md` — Bash allowlist, Step 1 evidence commands, a sentence in Step 2 on cross-zone extractions.
- `.pi/skills/tidy-first/SKILL.md` — Step 2 prompt input "symbols the design alters".
- `.pi/prompts/finish-phase.md` — Step 3 "Deriving the delivered numbers": the two `--score`-form bullets become the trend recipe plus the snapshot rewrite; the "Health / clone groups / dead exports" reconcile line points at the snapshot.
- `.pi/prompts/plan-improvements.md` — Step 3 names the trend read and the coverage feed as inputs the skills carry; line 35 wording.
- `.pi/skills/improvement-discovery/SKILL.md` — Step 3 commands (trend, coverage feed, `--coverage-gaps`, `--type-coupling`, `similar-code` opt-in); the CRAP caveat at line ~197; lines 16 and 305 wording.
- `.pi/skills/fallow/SKILL.md` — rewritten per Design Overview.
- `.pi/agents/craftsmanship-scout.md` — line 19 wording.
- `.pi/skills/package-pi-subagents/SKILL.md` § Domain organization and `.pi/skills/package-pi-permission-system/SKILL.md` § Where a module goes — one sentence each: `guard <file>` lists what the directory may import; an intended new edge edits the rule in the same commit.
- `packages/pi-subagents/docs/architecture/architecture.md` — § Current layout gains a paragraph on the zones, the ratchet, and the two unsanctioned edges; § Health metrics' "Every other row is a `fallow health` field" names the snapshot as the recompute source.
- `packages/pi-permission-system/docs/architecture/architecture.md` — § Module structure gains the same paragraph with its three deviations and the `allowTypeOnly` narrowing on `policy/`; the "Health / clone groups / dead exports" recompute line names the snapshot.
- Predicted unchanged: `.github/workflows/ci.yml` (audit and dead-code steps already report boundary findings; `warn` does not change exit codes — verified by the zero-violation run exiting 0), `eslint.config.js` (the file-level rule stays), every `packages/*/package.json` (coverage runs via `exec`, not a script), `.gitignore` (`.fallow/` and `coverage/` stay ignored; the snapshot lives under `docs/`).

## Test Impact Analysis

No Vitest tests change.
The testable surface is the set of shell commands the new prose prescribes; each was dry-run at planning time and its expected output recorded:

| Command                                                                                                                             | Expected at planning                                                                                                      |
| ----------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------- |
| `pnpm --silent fallow list --boundaries --quiet`                                                                                    | `Boundaries: 22 zones, 22 rules, 2 logical groups`; pi-subagents zones sum to 69 files, pi-permission-system zones to 158 |
| `pnpm --silent fallow dead-code --format json --quiet 2>/dev/null \| jq '.boundary_violations \| length'`                           | `0`                                                                                                                       |
| `pnpm fallow dead-code`                                                                                                             | exit 0                                                                                                                    |
| `pnpm --silent fallow guard packages/pi-subagents/src/lifecycle/subagent.ts --quiet`                                                | zone `pi-subagents/lifecycle`; may import `config`, `core`, `observation`, `session`                                      |
| `pnpm --silent fallow decision-surface --base <plan-commit>^ --format json --quiet`                                                 | JSON with `decisions` (expected empty on this docs-and-config range)                                                      |
| trend recipe for pi-subagents right after saving                                                                                    | `Trend: → stable`, `All 11 metrics unchanged`                                                                             |
| coverage recipe for pi-subagents                                                                                                    | `CRAP from Istanbul coverage data` in the `fallow health` output; `agent-tool.ts` `crap_max` 42.0                         |
| `pnpm --silent fallow dead-code --type-aware --symbol-impact packages/pi-subagents/src/session/prompts.ts:buildAgentPrompt --quiet` | one direct consumer (the test); `--trace` lists two                                                                       |

`/build-plan` re-runs each as its step's verification.

## Invariants at risk

- **`pnpm fallow dead-code` exits 0 on `main`** (the CI gate, `ci.yml` line 52).
  Constituency: every `/ship`.
  Pinned by the gate itself; the zero-violation baseline and `warn` severity keep it, and the killing mutation in step 1 shows a violation is reported without changing the exit code.
- **Architecture-doc health-metrics baselines** (pi-subagents 78 B; pi-permission-system 78 B).
  Constituency: `/finish-phase` reconciliation.
  The snapshot score is the same hotspot-inclusive number (measured 77.8 B for pi-subagents), so the trend read agrees with the tables.
- **Reviewer output contract** — `/tdd-plan` and `/build-plan` read the last message for an `### Overall` line.
  Adding a section before `### Overall` keeps it; the section must not be appended after.

## TDD Order

No TDD cycles — every step is config or prose with a command as its verification.
Run `/build-plan`.

1. **`build: encode pi-subagents and pi-permission-system boundaries in .fallowrc.json`** Add the four zone entries, 22 empty-allow rules, and `"boundary-violation": "warn"`; run the derivation, fill the allow lists, move `policy/`'s three type-only targets to `allowTypeOnly`.
   Verify: the first three table rows above.
   Killing mutation: append `import { x } from "#src/authority/decision-source";` (any value export) to `packages/pi-permission-system/src/policy/rule.ts` — the JSON count becomes 1 and `pnpm fallow dead-code` still exits 0; revert before committing.
2. **`docs: record the boundary zones and their unsanctioned edges in the architecture docs`** The two architecture-doc paragraphs and the two package-skill sentences.
   Verify: `pnpm exec rumdl check` on the four files; `grep -n 'fallow guard' .pi/skills/package-pi-subagents/SKILL.md .pi/skills/package-pi-permission-system/SKILL.md` finds one line each.
3. **`docs: hand the pre-completion reviewer fallow's decision surface`** Reviewer agent and `pre-completion` skill edits.
   Verify: run the decision-surface command with `--base "$PLAN"^` where `PLAN` is this plan's commit; `jq '.decisions | length'` prints a number; the reviewer's output template still ends with `### Overall`.
4. **`docs: give the tidy-first assessor fallow's guard, inspect, and symbol-impact evidence`** Assessor agent and `tidy-first` skill edits.
   Verify: the `guard` row above; `inspect --file packages/pi-subagents/src/session/prompts.ts` prints `imported_by_count`; the `--symbol-impact` row above reproduces the miss (if it no longer misses, the skill text in step 7 says so instead).
5. **`build: add @vitest/coverage-istanbul for real CRAP scores`** Catalog entry, root devDependency, `pnpm install`.
   Verify: the coverage row above; `pnpm fallow dead-code` exits 0; `pnpm run lint` passes.
6. **`docs: snapshot fallow vital signs per package and trend them at phase close`** Write both snapshots with the command (never by hand), then edit `finish-phase.md`, `plan-improvements.md` Step 3, and the two architecture docs' recompute lines.
   Verify: the trend row above for both packages; `git diff --stat` shows the two JSON files added; `pnpm run lint` passes.
7. **`docs: describe fallow's current surface in the fallow skill`** Rewrite `.pi/skills/fallow/SKILL.md`; the `improvement-discovery` Step 3 additions (trend, coverage, `--coverage-gaps`, `--type-coupling`, `similar-code`); the four "syntactic" rewordings.
   Verify: `grep -rn 'syntactic analysis only' .pi/` is empty; every command in the skill's fenced blocks runs (`--help` exits 0 for each subcommand named); `pnpm exec rumdl check` on every edited file.

Each step is its own commit; steps 1 and 5 are `build:` because they change tooling a user cannot observe in a package, and the rest are `docs:`.

## Risks and Mitigations

- **A row in the derived table is stale by build time.**
  The build session re-derives from the empty-allow run and verifies by count, not by copying the table.
- **`autoDiscover` names a zone differently in a later fallow release.**
  `list --boundaries` in step 1's verify pins the names; a rename shows as 22 rules referencing zones that no longer exist.
- **A committed snapshot drifts from `main` between phases.**
  That drift is the trend; the recipe reports it rather than hiding it, and `/finish-phase` rewrites the file at every close.
- **The trend recipe's `rm -rf .fallow/snapshots` runs from the wrong directory.**
  The path is relative and `.fallow/` exists only at the repo root; the recipe is preceded by the same "run from the repo root" sentence `finish-phase.md` already carries.
- **The reviewer treats a decision as a gate.**
  The section's text states the advisory contract and maps every outcome to PASS/WARN/SKIP only.
- **`--symbol-impact` is trusted alone despite the miss.**
  The skill states the pairing and the measured miss; step 4's verify reproduces it so the build session sees it.
- **Coverage instrumentation changes a test's behavior.**
  Measured: 1830 tests pass with and without `--coverage` for pi-subagents; the recipe writes to `/tmp`, so no repo file changes.

## Open Questions

- Whether to report the `--symbol-impact` shorthand-property miss to `fallow-rs/fallow`.
  The repro is two commands on this repo (`--trace` vs `--type-aware --symbol-impact` on `prompts.ts:buildAgentPrompt`); filing is the operator's call and is not part of this plan.
- Whether a later change tightens the ratchet to `allowTypeOnly` on every edge that is measured type-only today (beyond `policy/`).
  The empty-allow derivation does not distinguish type-only edges, so that tightening needs the per-import grep and is deferred until a package's discovery round wants it.
- Whether `boundary-violation` moves to `error` once a phase has lived with `warn`.
  Deferred; a new edge already asks a decision-surface question in review.
