---
issue: 934
issue_title: "Audit and prune the agent documentation, then make the pass periodic"
---

# Audit and prune the agent documentation, then make the pass periodic

## Release Recommendation

**Release:** ship independently

This change touches only repo-root tooling: `AGENTS.md`, `.pi/skills/*/SKILL.md`, `.pi/prompts/`, `scripts/agent-docs/`, `test/agent-docs/`, and `docs/agent-docs-audit/`.
None of those paths ship in any package tarball, and no package architecture roadmap references this issue (verified: `grep -rn "934" packages/*/docs/architecture/architecture.md` finds nothing), so it participates in no batch and cuts no package release.

## Problem Statement

The agent-facing documentation has grown monotonically since the repo opened and has never been pruned.
`AGENTS.md`, loaded into every session unconditionally, is 8,760 words; the 16 skills total 34,608.
The accretion rate of `AGENTS.md` nearly tripled (+233 → +635 words/wk) at the moment Opus 5 took majority token share, so we are writing the most direction for the model that needs it least.
The issue asks for a deliberate audit-and-prune of `AGENTS.md` and the skills, a written admission test for what earns a line where, and a manually-triggered `/audit-agent-docs` command so the pass recurs.

## Goals

- Write the admission test — the rule for what belongs in `AGENTS.md`, what belongs in a skill body, and what belongs in neither — and place it where every writer of `AGENTS.md` sees it.
- Close the regrowth pump: `/retro` produced 44 of the last 60 commits to `AGENTS.md`, and its Step 7 governs an addition's shape but never its admission.
  Step 7 gains the admission test as a gate.
- Make the two measurement scripts committed in 8c9bb3c6 testable and tested, and add a third that reports the always-loaded word count directly.
- Add `/audit-agent-docs`: measures, classifies every passage in scope, writes a dated inventory, gates it with the operator, applies the approved `delete` and `compress` verdicts in place on the current branch, and commits.
- Run it once, in a fresh session, and land the first prune.

## Non-Goals

- No numeric budget for always-loaded words this round.
  Each audit records the number; a budget set before one audit has run is a guess (operator decision at planning).
- Prompt templates (29,635 words) and subagent definitions (4,933 words) are not audited here — [#935] owns them, after this issue's admission test has been exercised once.
- The command does not apply `offload` verdicts.
  Moving a passage into a skill is a design choice about that skill's shape; the inventory names the destination and the move is manual.
- `model-usage.mjs`'s `DEFAULT_PREFIX` stays hardcoded to this checkout's session-store name.
  `transcriptPaths` already takes `prefix` as a parameter, so the default is not a testability blocker, and making it portable is an unrelated decision (Tidy-First assessor, rejected as scope creep).
- `plot.py` stays Python under `docs/agent-docs-audit/<date>/`, run with `uv`.
  Matplotlib is not a repo dependency and the figure is evidence, not a gate.
- No edits to the historical plan and retro archives that cite the rules being pruned — those are point-in-time records.
- No retest of any rule against the current model.
  The recurrence heuristic below is the substitute, with its confound stated.

## Background

### The file boundary is a cost boundary

Pi loads `AGENTS.md` into every session.
It also loads each skill's frontmatter `description:` into every session — that is how the agent knows a skill exists — but a skill's **body** is paid for only when a session reads it.
Measured on HEAD: `AGENTS.md` is 8,760 words and the 16 skill descriptions total 454, so **9,214 words are always loaded**; the 34,608 words of skill bodies are on demand.

This is the mechanism the admission test rests on.
"Belongs in `AGENTS.md`" has a precise meaning: needed before the agent could know to load a skill.
Everything else has a cheaper home.

### The growth pump

`git log --format=%s -60 -- AGENTS.md` shows 57 `docs:` commits, 44 of them `docs(retro):`.
`/retro` Step 7 ("Verbosity check") already asks whether a retro-driven addition is *rule + tight example* rather than *rule + rationale + worked example* — but it never asks whether the rule belongs in `AGENTS.md` versus a skill versus nowhere.
That is why 89 of `AGENTS.md`'s prose lines end in `(Refs #N)`, 69 distinct issues are cited, and 45 of those are cited exactly once: each retro appended one incident's lesson to the always-loaded file, and no gate asked where it should go.

### The measurement scripts as committed

`scripts/agent-docs/doc-growth.mjs` and `scripts/agent-docs/model-usage.mjs` landed in 8c9bb3c6 as exploratory derivations.
Both run their whole body at module top level — `parseArgs(process.argv)` and the output loop execute on import — so neither can be imported by a test without running against real git history or the real `~/.pi/agent/sessions` store.
The repo's precedent for a testable root script is `scripts/roadmap-check.mjs`: pure functions exported, CLI body under `if (process.argv[1] === fileURLToPath(import.meta.url))`, tests in `test/roadmap/` against a `mkdtempSync` workspace, picked up by the root `vitest.config.mjs` (`include: ["test/**/*.test.mjs"]`).

One measurement caveat to carry: `doc-growth.mjs`'s `agents_md` bucket matches `*/AGENTS.md` as well as the root file, which is correct for the pre-consolidation series (the per-package files were real then) but over-reads the current always-loaded number by the nine ~45-word sentinel files under `packages/*/AGENTS.md`.
Those fire only when Pi is launched from a package subdirectory.
The new `always-loaded.mjs` reads the root file alone, which is why it exists as a separate script rather than a column.

### Precedent for the command

`/triage-backlog` is the read half's twin: a dated artifact under `docs/`, reads the prior one first, scores every item, commits.
`/finish-phase` is the mutating half's twin: a hard gate (`ask_user` in one pass over the whole set), then in-place edits, then a single verify-and-commit step.
`/audit-agent-docs` is both halves in one template.

### AGENTS.md constraints that apply

- **A new prompt template is not runnable in the session that creates it.**
  Pi registers commands at startup, so the first `/audit-agent-docs` run needs a fresh session (the `#869` rule for renamed templates applies identically to new ones).
  This is a sequencing constraint on the plan: the implementing session lands the command and stops; the first audit is a separate session.
- `pi-autoformat` reflows every `Edit`/`Write` to markdown.
  The command's in-place edits go through `Edit`, so a compress verdict that rewrites a line must re-read before a second edit to the same region.
- `rumdl` caches per file on content, so a prune that moves or deletes a linked-to file needs `find .rumdl_cache -type f -delete` before `pnpm run lint` is trusted.
- Retro-file and plan conventions from `markdown-conventions`: one sentence per line, reference-style `[#N]` links in long-lived docs, sequential numbering under each heading.

## Design Overview

### The admission test

Three questions, applied to every passage.
A passage is a sentence or a tightly bound group of sentences making one claim.

1. **Could a current model act correctly without it?**
   If yes, it does not belong anywhere — `delete`.
   This covers generic best practice, restatements of what a tool's own output says, and rules a capable model already follows.
2. **Is it needed before the agent could know to load a skill?**
   If yes, `AGENTS.md`.
   If no, a skill body — `offload`, naming the skill.
   The test is the loading mechanism itself: a rule about how to write markdown is needed only once the agent is writing markdown, at which point it has loaded `markdown-conventions`.
   A rule about *which* skill to load, or about a hazard that fires before any skill is loaded (a tool's atomic-batch behavior, a shell quirk that corrupts the first command), passes.
3. **Is the incident load-bearing, or only the rule?**
   A rule that stands on its own keeps the rule and drops the story — `compress`.
   `(Refs #N)` stays only when the issue encodes an active constraint the reader might need to trace; a citation that merely proves the rule was once needed is provenance, and provenance lives in git log and the retro record.

A passage that passes all three is `keep`.

The recurrence heuristic, stated as guidance: a rule whose incident has not recurred in any retro since 2026-07-20 (the week Opus 5 took majority token share) is a `delete` candidate.
The confound is survivorship — the rule may be why it has not recurred — so the heuristic is a prompt to look, not a verdict.
The cut is cheap to reverse, and a post-prune recurrence in a retro is the restoration signal.

The test itself lives in `AGENTS.md`, compact (under 150 words), because regrowth happens in every session that writes there; the procedure and rationale live in the command.
That is the `#607` placement argument applied to itself.

### The command

`/audit-agent-docs` runs in a fresh session, takes no arguments, and proceeds:

1. **Sync** — `git pull --ff-only`, stop on any failure; `set_session_name` to `Agent-doc audit — <YYYY-MM-DD>`.
2. **Measure** — run the three scripts into `docs/agent-docs-audit/<date>/`, and read the prior audit's `inventory.md` for verdicts it deferred.
3. **Classify** — walk `AGENTS.md` and every `.pi/skills/*/SKILL.md` section by section, writing one inventory row per passage: file, section, first words, verdict, one-line rationale, and for `offload` the destination skill.
   The `package-pi-permission-system` skill is 12,907 words with a 2,571-word `## Debugging` section; it is walked like the rest but gets its own summary line.
4. **Gate** — put the whole inventory to the operator in one `ask_user` pass: apply as written, or edit the inventory first and re-gate.
   No per-passage round trips.
5. **Apply** — execute every approved `delete` and `compress` in place with `Edit`, on the current branch.
   `offload` and `keep` are not applied; the inventory records them for manual follow-through.
6. **Verify and commit** — clear the rumdl cache, `pnpm run lint`, count always-loaded words again, write the before/after into the inventory's header, commit the inventory and measurements as `docs(agent-docs): audit <date>` and the prune as `docs: prune agent docs per <date> audit`.
   Two commits, so the inventory is reviewable independently of what it caused.

The inventory's shape:

```markdown
# Agent-doc audit — 2026-09-18

Always loaded before: 9,214 words (AGENTS.md 8,760 + skill descriptions 454).
Always loaded after: <filled at step 6>.

| File | Section | Passage | Verdict | Rationale |
| --- | --- | --- | --- | --- |
| AGENTS.md | Commits | "Do not gate a commit…" | compress | rule stands; drop #885 story |
| AGENTS.md | Shell and search | "`rg -r` is `--replace`…" | delete | no retro recurrence since 07-20; model reads `--help` |
| .pi/skills/package-pi-permission-system/SKILL.md | Debugging | whole section | offload → docs/retro | retro spillover, not package context |
```

### The scripts

```javascript
// scripts/agent-docs/doc-growth.mjs — exported surface after the refactor
export function classify(path);                 // → "agents_md" | "skills" | "prompts" | "subagent_defs" | null
export function countWords(text);               // → number
export function snapshotDates(since, everyDays, now); // → ISO date[]
export function measure(sha, git);              // git: (args: string[]) => string
```

```javascript
// scripts/agent-docs/model-usage.mjs — exported surface after the refactor
export function weekOf(timestamp);              // → "YYYY-MM-DD" (Monday, UTC)
export function accumulateLines(rows, sessionId, lines); // ordered attribution
export function transcriptPaths({ sessionsDir, prefix });
```

```javascript
// scripts/agent-docs/always-loaded.mjs — new
export function skillDescription(skillMarkdown); // frontmatter description: block → string
export function alwaysLoadedWords({ agentsMd, skillDescriptions }); // → { agentsMd, descriptions, total }
```

`always-loaded.mjs` imports `countWords` from `doc-growth.mjs`; the CLI guard makes that import side-effect-free.
Every CLI guard is spelled `process.argv[1] === fileURLToPath(import.meta.url)`, matching `roadmap-check.mjs`.

### Edge cases

- A skill whose frontmatter has no `description:` contributes zero always-loaded words and is listed in the inventory as a defect, since Pi cannot advertise it.
- A `compress` on a line that also carries a `(Refs #N)` the admission test says to keep: the rationale column names the constraint the citation encodes, and the citation survives.
- An inventory row the operator edits from `delete` to `keep` at the gate is applied as `keep`; the re-gated inventory is what gets committed, not the draft.

## Module-Level Changes

| File                                         | Change                                                                                                                                                                                                        |
| -------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `scripts/agent-docs/doc-growth.mjs`          | Export `classify`, `countWords`, `snapshotDates`, `measure`; thread `now` into `snapshotDates` and `git` into `measure`; CLI body under the import-guard                                                      |
| `scripts/agent-docs/model-usage.mjs`         | Export `weekOf`, `transcriptPaths`; extract `accumulateLines(rows, sessionId, lines)` from `accumulate`, inlining the read at its single call site; CLI body under the guard                                  |
| `scripts/agent-docs/always-loaded.mjs`       | New: `skillDescription`, `alwaysLoadedWords`, CLI printing the three numbers                                                                                                                                  |
| `test/agent-docs/doc-growth.test.mjs`        | New: `classify` over both layouts and exclusions; `snapshotDates` with an injected `now`; `measure` with a fake `git`                                                                                         |
| `test/agent-docs/model-usage.test.mjs`       | New: `weekOf` Monday/UTC; `accumulateLines` ordered attribution; `transcriptPaths` against a `mkdtemp` store                                                                                                  |
| `test/agent-docs/always-loaded.test.mjs`     | New: `skillDescription` on multi-line and missing blocks; `alwaysLoadedWords` sums                                                                                                                            |
| `AGENTS.md`                                  | Add the admission test as a `### Admission test` subsection under `## Monorepo Structure`, ahead of `### Releasing`; add `/audit-agent-docs` to the workflow list and the session-naming table                |
| `.pi/prompts/retro.md`                       | Step 7 gains the admission test as question 0, before the shape questions; the "Don't duplicate" bullet in Step 8 points at it                                                                                |
| `.pi/prompts/audit-agent-docs.md`            | New command                                                                                                                                                                                                   |
| `docs/agent-docs-audit/2026-09-17/README.md` | Add the always-loaded script to the regeneration block; note the sentinel caveat                                                                                                                              |
| `docs/agent-docs-audit/<date>/`              | Written by the first run: three CSVs, `inventory.md`                                                                                                                                                          |
| `README.md`                                  | Predicted unchanged: its command table covers the issue lifecycle only, and the periodic commands it omits (`/triage-backlog`, `/finish-phase` — verified absent by grep) are the convention this one follows |
| `vitest.config.mjs`                          | Predicted unchanged: `test/**/*.test.mjs` already includes `test/agent-docs/`                                                                                                                                 |

No file in the table above is also claimed unchanged in Non-Goals.

## Test Impact Analysis

The scripts had no tests; the extraction enables three surfaces that were impractical while the CLI ran on import.

- `classify` is the function with the real input domain: four buckets, two layouts, two exclusions.
  The test enumerates one path per (layout × bucket) cell plus `node_modules/` and a non-matching `.md`.
- `accumulateLines` has one discriminating behavior — ordered attribution.
  The test feeds a `session_info` rename between two assistant messages and asserts the first lands under the old stage and the second under the new; a `thinking_level_change` gets the same shape.
  This is the bug the first draft had, and it is invisible to any test that only checks totals.
- `measure` with a fake `git` pins bucket summing without touching a repo.
  A real-repo test would depend on this repo's own history and drift with every commit.

The command's prose prescribes shell commands; each was dry-run at planning time:

| Command                                                         | Expected                                                        |
| --------------------------------------------------------------- | --------------------------------------------------------------- |
| `node scripts/agent-docs/doc-growth.mjs`                        | 23 CSV rows, last dated today or the prior Monday; runs in ~5 s |
| `node scripts/agent-docs/model-usage.mjs`                       | ~390 CSV rows; runs in ~2 s                                     |
| `git log --format=%s -60 -- AGENTS.md \| grep -c 'docs(retro)'` | 44 on HEAD                                                      |
| `find .rumdl_cache -type f -delete && pnpm run lint`            | clean on HEAD                                                   |

`always-loaded.mjs` does not exist yet; its expected output on HEAD is `agentsMd=8760 descriptions=454 total=9214`, which the test pins by fixture and step 6 verifies against the real tree.

## Invariants at risk

- **`/retro`'s existing Step 7 questions keep their order and meaning.**
  The admission test is inserted as a leading question, not a replacement; the four existing questions are unchanged text.
  Pinned by reading the diff — there is no test over prompt prose.
- **`doc-growth.mjs`'s CSV output is byte-identical before and after the refactor.**
  Measured at planning: `node scripts/agent-docs/doc-growth.mjs > /tmp/before.csv` on HEAD; step 1's verify re-runs and diffs.
  Same for `model-usage.mjs` at step 3, with the caveat that the current session's own row moves between runs — diff with the current week excluded.
- **The evidence commit's CSVs are not rewritten.**
  `docs/agent-docs-audit/2026-09-17/*.csv` are the 2026-09-17 record; the first audit writes a new dated directory.

## TDD Order

1. **`refactor(scripts): export doc-growth's pure functions and guard its CLI`**.
   Prepares step 2 — nothing in the file is importable today.
   Add `export` to `classify`, `countWords`, `snapshotDates`, `measure`; `snapshotDates` takes `now`; `measure` takes `git`; the argv/loop/stdout tail moves under `if (process.argv[1] === fileURLToPath(import.meta.url))`.
   Verify: `node scripts/agent-docs/doc-growth.mjs | diff - /tmp/before.csv` is empty.
2. **`test(scripts): pin doc-growth's classifier, snapshot dates, and measure`**.
   `test/agent-docs/doc-growth.test.mjs`.
   Red is the file not existing; green is the exports from step 1.
   Killing mutations, one per class: make `classify` return `"skills"` for `packages/p/.pi/skills/x/SKILL.md` only when the path has no `packages/` prefix (kills the pre-consolidation cell); drop the `node_modules/` early return (kills the exclusion test); make `snapshotDates` use `Date.now()` again (kills the injected-`now` test, which fixes `now` to a date in 2026-05); make `measure` add every bucket to `agents_md` (kills the summing test).
3. **`refactor(scripts): export model-usage's pure functions and guard its CLI`**.
   Prepares step 4.
   Export `parseArgs`, `transcriptPaths`, `weekOf`; move the tail under the guard.
   No change to `accumulate` yet.
   Verify: output diff against `/tmp/before-usage.csv` with the current week's rows excluded is empty.
4. **`refactor(scripts): split accumulateLines out of accumulate in model-usage.mjs`**.
   Prepares step 5 — the assessor's one non-mechanical extraction.
   `accumulateLines(rows, sessionId, lines)` takes an iterable of lines; the `readFileSync` and `sessionId` derivation inline at the single call site; no `accumulate` wrapper remains.
   Verify by hand before step 5 exists: same diff as step 3.
5. **`test(scripts): pin model-usage's ordered attribution and week bucketing`**.
   `test/agent-docs/model-usage.test.mjs`.
   Killing mutations: in `accumulateLines`, hoist the `session_info` handling out of the loop so only the last name applies (kills the ordered-attribution test — the exact bug from the first draft); make `weekOf` use local `getDay()` instead of `getUTCDay()` (kills the Monday test, which uses a Sunday-23:30Z timestamp); make `transcriptPaths` ignore `prefix` (kills the `mkdtemp` test, which plants a decoy directory).
6. **`test(scripts): pin always-loaded's description extraction and sum`**.
   `test/agent-docs/always-loaded.test.mjs` first, red because the module does not exist.
   Then `scripts/agent-docs/always-loaded.mjs` with `skillDescription` (a `description: |` block ends at the next top-level key or `---`) and `alwaysLoadedWords`.
   Killing mutations: make `skillDescription` return only the first line of the block (kills the multi-line test); make it return the whole frontmatter when `description:` is absent (kills the missing-block test, which expects `""`).
   Commit as `feat(scripts): report the always-loaded word count` — the CLI is user-observable.
   Verify: `node scripts/agent-docs/always-loaded.mjs` prints `agentsMd=8760 descriptions=454 total=9214` on HEAD.
7. **`docs: state the admission test for agent documentation`**.
   `AGENTS.md` gains `### Admission test` under `## Monorepo Structure`.
   Under 150 words: the three questions, the recurrence heuristic with its confound, and one sentence naming `/audit-agent-docs` as the periodic pass.
   Verify: `pnpm run lint` clean; `node scripts/agent-docs/always-loaded.mjs` reports the delta this step added, recorded in the commit body.
8. **`docs: gate retro-driven AGENTS.md additions on the admission test`**.
   `.pi/prompts/retro.md` Step 7 gains question 0: "Admission — does this pass the `AGENTS.md` admission test?
   If it fails question 2, name the skill; if it fails question 1, do not land it."
   Step 8's "Don't duplicate" bullet points at the test.
   Verify: the four existing Step 7 questions are unchanged text (diff shows insertions only).
9. **`feat: add /audit-agent-docs`**.
   `.pi/prompts/audit-agent-docs.md` per the Design Overview; `AGENTS.md`'s workflow list and session-naming table gain the command; `docs/agent-docs-audit/2026-09-17/README.md` gains the third script and the sentinel caveat.
   Verify: `pnpm run lint` clean; the template's frontmatter parses (`description:` and `model:` present, matching `triage-backlog.md`'s form).
   Stop here.
   The pre-completion reviewer runs on steps 1–9; the command cannot be run in this session.
10. **First audit — in a fresh session, `/audit-agent-docs`.**
    Not a step the implementing session executes.
    The command produces `docs/agent-docs-audit/<date>/inventory.md`, gates it, applies the approved verdicts, and lands two commits (`docs(agent-docs): audit <date>`, `docs: prune agent docs per <date> audit`).
    The plan's acceptance is met when both are on `main` and the inventory header's "after" number is below its "before".

## Risks and Mitigations

- **The prune lands and the file re-grows anyway.**
  Step 8 is the mitigation: `/retro` is 73% of `AGENTS.md`'s commit history, and it now has to answer the admission test before appending.
  The next audit's `doc-growth.csv` is the measurement; if the post-prune slope is unchanged, the gate is not being honored and that is the next issue.
- **A `delete` removes a rule that was load-bearing.**
  The recurrence heuristic is stated as guidance with survivorship named, the inventory records every verdict with a rationale, and the prune is one commit — reverting a single passage is a one-line `git show <sha>:AGENTS.md`-and-`Edit`.
  A recurrence in a later retro is the signal, and `/retro` Step 7's new question 0 is where it gets restored with its citation.
- **The command's in-place edits fight `pi-autoformat`.**
  Every applied verdict re-reads the region before editing it.
  The template says so explicitly, because a compress that rewrites a line changes what the next `oldText` must match.
- **The `accumulateLines` extraction silently reorders attribution.**
  Step 4 is verified by output diff before step 5's test exists, and step 5's ordered-attribution test then pins it.
  Both, not one — the diff catches a regression on real data, the test catches it on the shape.
- **The inventory is too large to gate in one pass.**
  `AGENTS.md` has 113 paragraphs and the skills perhaps 400 more; a row per passage is a 500-row table.
  The gate is per-inventory, not per-row, and the operator's option is "edit the file, then re-gate" — which is what a 500-row review actually looks like.
  If it proves unworkable on the first run, the second audit is where the command learns to gate per file.

## Open Questions

- Whether the inventory's `offload` rows should become filed issues automatically, one per destination skill.
  Deferred: see what the first inventory's `offload` set looks like before deciding.
- Whether `doc-growth.mjs` should split the sentinel `packages/*/AGENTS.md` files out of `agents_md` into their own bucket.
  Deferred: it is a constant ~400-word offset since consolidation and does not move the trend; changing it would make the pre-May series wrong.
- Whether a future audit should carry a budget.
  Deferred to after the first run, per the operator's planning decision; the inventory header records the number a budget would be set against.

[#935]: https://github.com/gotgenes/pi-packages/issues/935
