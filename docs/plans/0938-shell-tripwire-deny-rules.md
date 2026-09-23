---
issue: 938
issue_title: "Turn the three recurring shell tripwires into pi-permission-system deny rules with reasons"
---

# Shell tripwires as project-scope deny rules

## Release Recommendation

**Release:** ship independently

Nothing under `packages/` changes, so no package version is cut at all.
The change touches `AGENTS.md`, a new `.pi/extensions/` config file, and the repo-root `scripts/` + `test/` harness — all outside every package's release scope.
The issue is not a step in any package's improvement roadmap.

## Problem Statement

Three `AGENTS.md` shell rules recurred in retros *while the rule sat in loaded context*: `rg -r` (retro 0914), an unquoted glob (0640 four times, 0806, 0883), and `git rev-parse … | wc -c` (0927 twice, where that retro declines a third restatement outright).
The 2026-09-17 agent-docs audit kept all three on the recurrence heuristic, which leaves them as prose that demonstrably does not work for this class of mistake.

A rule with a mechanical trigger and a mechanical fix is a hook, not a sentence.
`pi-permission-system` already gates `bash` on `tool_call` and supports a deny carrying a `reason` that reaches the agent, so a rule of this class can become a project-scope config entry whose reason says what to do instead.

The issue's own framing named the implementation question correctly: which of the three are expressible as bash command patterns is a thing to verify against the running extension before relying on it.
Planning verified it, and the answer reshapes the change.

## Goals

- Add `.pi/extensions/pi-permission-system/config.json` with the tripwire deny rules that **measure clean** against the real command corpus: `rg -r*` and `git commit -F`.
- Give each rule a `reason` that is self-sufficient (the agent never sees the command it ran) and names an escape hatch the rule's own pattern does not match.
- Compress the two `AGENTS.md` passages those rules now enforce to a one-line pointer each, leaving the remedy to the reason string.
- Guard the repo against a malformed project scope, which floors the whole repo's composed policy `allow`→`ask`.
- Record why the other two tripwires stay prose, with the measurement behind it.

This change is **not breaking**: it adds repo-local configuration and edits repo-local docs.
No published package's behavior, output shape, or default changes.

## Non-Goals

- **Mechanizing the unquoted-glob rule.**
  It is not expressible.
  The wildcard matcher compiles to an anchored regex with `*`→`.*` and `?`→`.` and no negation (`src/policy/wildcard-matcher.ts`), so nothing distinguishes `--include=*.ts` from `--include='*.ts'`.
  Measured over 7,578 unique logged commands, `*--include=*` matches 175 command units, of which 153 are the correctly quoted form.
  A deny-then-`allow` carve-out (`*--include=*` deny, `*--include='*` allow) is expressible and is a genuine bypass: `sudo grep --include='*.ts' …` is one command unit matching both `sudo *` (ask) and the carve-out (allow), and last-match-wins hands it `allow`.
- **Mechanizing the `git rev-parse … | wc -c` rule.**
  It is not expressible either, for two independent reasons.
  A bash rule matches one **command unit**, never the pipeline — `resolveBashCommandCheck` (`src/handlers/gates/bash-command.ts`) enumerates `git rev-parse HEAD | wc -c` as two units and consults the whole-string surface only when the primary parse yields nothing.
  The issue's proposed `git rev-parse * | wc -c` therefore matches **0** of 7,578 corpus commands.
  The only expressible approximation, `wc -c*`, matches 18 command units of which 14 are legitimate byte counts (`wc -c /tmp/docs-tree.json`, `wc -c AGENTS.md`), a measured 78% false-positive rate, and it has no escape hatch on the `bash` surface for a caller who genuinely wants a byte count.
- **Generalizing this into a "tripwire" category in the agent docs.**
  Out of scope per the issue.
  Two rules is not a category.
- **Moving or restructuring the rest of `AGENTS.md`'s `##### Shell and search` section.**
  Issue [#937] owns that split and is open.
  If [#937] lands first, this change's two passages will live in a topic skill instead; the edits are the same either way.
- **Asserting the pattern-matching behavior in CI.**
  The root harness is plain `.mjs` and cannot reach the package's tree-sitter parser or wildcard matcher without a dependency on the package.
  The enumeration fact the `git commit -F` rule rests on is filed as [#941] against the package, where it belongs.

## Background

### Where the config goes, and how it merges

`pi-permission-system` reads one unified config per scope.
Project scope is `<cwd>/.pi/extensions/pi-permission-system/config.json` (`packages/pi-permission-system/docs/configuration.md`), and it does not exist in this repo yet — `.pi/extensions/` holds only `pi-autoformat/config.json` and `worktree.ts`.

The operator's global config already carries the shape this change adds, including a `denyWithReason` entry:

```json
{
  "bash": {
    "*": "allow",
    "find / *": {
      "action": "deny",
      "reason": "Run against a more specific directory; find / walks every mounted volume and consumes too many resources"
    },
    "rm -rf *": "ask",
    "sudo *": "ask"
  }
}
```

`mergeFlatPermissions` (`src/policy/permission-merge.ts`) shallow-merges two pattern maps and appends keys the base does not have, so the project's rules land **after** the global `"*": "allow"` and win under last-match-wins.
Verified by reading the merge; no measurement needed, the function is eight lines.

### What the agent sees

`renderPolicyDenial` (`src/presentation/agent-renderer.ts`) produces:

```text
[pi-permission-system] Denied by policy: 'bash' (rule 'rg -r*'). Reason: <reason>.
```

Two properties shape the reason strings.
The **command is never rendered** — `identification` bounds the agent-supplied values that reach the agent, and the command is not among them — so the reason must stand alone.
`reasonClause` appends its own full stop (`` ` Reason: ${reason}.` ``), so a reason ending in a period renders `..`; the operator's existing `find / *` reason ends without one.

### Constraints from `AGENTS.md` and the package skill

- JSONC is not supported (issue [#856] is open), so the file is plain JSON with no comments.
  `biome check .` covers `**`, so a stray comment fails `pnpm run lint`.
- An invalid **non-global** scope is rejected fail-closed and additionally floors the composed policy `allow`→`ask` with origin `fail-closed`.
  A typo in this file therefore makes every surface in the repo prompt.
  This is loud rather than silent, but whether the explanatory notice reaches the user is not something to rely on ([#933]).
- `deny` survives `yoloMode` (`src/handlers/gates/helpers.ts`: "A `deny` matches neither arm, so an explicit deny survives yolo").
- The project scope is withheld entirely when the project is untrusted (`ConfigStore.refresh` passes `includeProjectScope: projectTrusted`).
  The root checkout is trusted and `scripts/worktree-new.sh` launches `pi --approve`, so worktrees are covered; a contributor who has not trusted the repo gets none of these rules.
- Config is re-read on **every turn** (`SessionTurnPrep`'s trust-gated `refreshConfig` at `before_agent_start`), from the policy files' mtimes.
  So the rules go live on the next turn after the file is written — including for the session that writes it.

### The root test harness

`vitest.config.mjs` includes `test/**/*.test.mjs` only and never descends into `packages/`.
Every existing root test imports a pure function from a matching `scripts/` module and performs **zero** direct filesystem reads — confirmed by `grep -rn "readFileSync\|readFile(" test/`, which returns nothing across all seven test files.
The two tests that touch a filesystem (`model-usage.test.mjs`, `roadmap-check.test.mjs`) use `mkdtempSync` fixtures.
`eslint packages/` does not reach `test/` or `scripts/`, so new `.mjs` files there answer to `biome check .` alone.

## Design Overview

### The admission test for a tripwire rule

A recurring prose rule earns a deny rule when all three hold:

1. **Expressible** — the offending form appears in a single bash *command unit*, not across a pipe or a `&&`.
2. **Clean** — measured against the real command corpus, its false-positive count is zero or near it.
3. **Escapable** — the reason names a correct spelling that the rule's own pattern does **not** match, so the agent can act on the refusal in one step.

Measured with the package's own `BashProgram.parse` and `compileWildcardPattern` over the 7,578 unique bash commands in `~/.pi/agent/extensions/pi-permission-system/logs/pi-permission-system-permission-review.jsonl`:

| Pattern                    | Unit hits | True | False | Verdict                           |
| -------------------------- | --------- | ---- | ----- | --------------------------------- |
| `rg -r*`                   | 9         | 9    | 0     | admit                             |
| `git commit -F`            | 14        | 14   | 0     | admit                             |
| `wc -c*`                   | 18        | 4    | 14    | reject (not clean, not escapable) |
| `git rev-parse * \| wc -c` | 0         | 0    | 0     | reject (not expressible)          |
| `git commit -F -*`         | 0         | 0    | 0     | wrong spelling                    |
| `*--include=*`             | 175       | 22   | 153   | reject (not clean)                |

All six rows are **measured**, not estimated.

### The two mechanism facts the admitted rules rest on

Both were established by running the real enumerator, not read off documentation.

1. **A pipeline enumerates into separate units.**
   `git rev-parse HEAD | wc -c` yields `["git rev-parse HEAD", "wc -c"]`.
   So any pattern containing `|` matches nothing.
2. **A heredoc absorbs the operand preceding it.**
   `git commit -F - <<'EOF'\nfeat: x\nEOF` yields `["git commit -F"]`, while `git commit -F /tmp/msg.txt` yields `["git commit -F /tmp/msg.txt"]`.
   So the exact pattern `git commit -F` matches the heredoc form and **only** the heredoc form, and the issue's proposed `git commit -F -*` matches nothing.
   This fact is otherwise unasserted; filed as [#941].

Two further forms are **not** covered and are accepted residual: `printf … | git commit -F -` (piped stdin, unit text `git commit -F -`) and `git commit -F /dev/stdin <<'EOF'`.
Neither appears in the corpus.

### The config file

```json
{
  "$schema": "https://raw.githubusercontent.com/gotgenes/pi-packages/main/packages/pi-permission-system/schemas/permissions.schema.json",
  "permission": {
    "bash": {
      "rg -r*": {
        "action": "deny",
        "reason": "`-r` is `--replace`, not `--recursive`: it rewrites every match and drops the line numbers. `rg` recurses by default, so drop the `-r`. If you do mean a replacement, spell it `--replace` — this rule does not match that"
      },
      "git commit -F": {
        "action": "deny",
        "reason": "This is `git commit -F -` with a heredoc body, which trips an approval prompt the operator must clear by hand. Write the message to a file with the `Write` tool, then `git commit -F <file>` — this rule does not match that spelling"
      }
    }
  }
}
```

Both reasons are 218 and 230 characters, under the schema's 500-character cap, and neither ends in a period.
The whole object was validated against `unifiedConfigSchema` at planning time and parses clean, `$schema` included.

The file carries **only** `permission.bash`.
It sets no runtime knob (`yoloMode`, `debugLog`, `permissionReviewLog`, …), so an operator's global preferences are untouched, and `mergeScopesWithOrigins` visits only the `bash` surface.

### The validator

The repo-root harness gets a `scripts/permission-config/` + `test/permission-config/` pair, matching the `scripts/agent-docs/` + `test/agent-docs/` and `scripts/roadmap/` + `test/roadmap/` precedent.

```javascript
// scripts/permission-config/tripwire-rules.mjs
export const MAX_REASON_LENGTH = 500;

/** Parse the repo's project-scope permission config. Throws on malformed JSON. */
export function loadProjectPermissionConfig(root) { /* readFileSync + JSON.parse */ }

/** The repo-relative path a raw.githubusercontent `$schema` URL names, or null. */
export function schemaRepoPath(schemaUrl) { /* strip the .../main/ prefix */ }

/** Human-readable problems with a parsed config; an empty array means valid. */
export function findConfigProblems(config) { /* … */ }
```

Call site, from the test:

```javascript
const config = loadProjectPermissionConfig(repoRoot);
expect(findConfigProblems(config)).toEqual([]);
expect(existsSync(join(repoRoot, schemaRepoPath(config.$schema)))).toBe(true);
```

The I/O sits in the `scripts/` module and the pure predicates beside it, so the test performs no `readFileSync` of its own and the harness convention holds.

`findConfigProblems` checks four things, three of them stricter than the published schema:

1. Every `permission.bash` value is a permission-state string or an object `{ action: "deny", reason }`.
2. A deny object **must** carry a non-empty `reason` — the schema makes it optional; a tripwire rule without one is pointless, since the agent is told nothing.
3. A reason is at most `MAX_REASON_LENGTH` characters and does not end in `.` — `reasonClause` supplies the full stop.
4. No `bash` pattern contains `|`.
   A pipeline enumerates into separate command units, so such a pattern matches nothing and is a silent no-op.
   This is the single check that would have caught the issue's own `git rev-parse * | wc -c` proposal.

Check 4 is the non-tautological one: it encodes a mechanism fact about the extension, not a restatement of the file it reads.

### The `AGENTS.md` compression

Both passages keep the fact and drop the remedy, which now lives in the reason string.

Before and after, in `##### Shell and search`:

| Passage         | Before                                                   | After               |
| --------------- | -------------------------------------------------------- | ------------------- |
| `rg -r`         | two lines (29 words)                                     | one line (14 words) |
| `git commit -F` | two lines (49 words, plus the unrelated `-m` line, kept) | one line (26 words) |

Measured net: **−38 words** against `AGENTS.md`'s 8,083, or −0.47%.
The size saving is negligible and is not the point; the enforcement is.
Stating that plainly matters, because the parent issue [#934] was about size.

## Module-Level Changes

| Path                                              | Change                                                                                               |
| ------------------------------------------------- | ---------------------------------------------------------------------------------------------------- |
| `.pi/extensions/pi-permission-system/config.json` | **new** — `$schema` plus `permission.bash` with the two deny rules                                   |
| `scripts/permission-config/tripwire-rules.mjs`    | **new** — `loadProjectPermissionConfig`, `schemaRepoPath`, `findConfigProblems`, `MAX_REASON_LENGTH` |
| `test/permission-config/tripwire-rules.test.mjs`  | **new** — fixture cases for each problem class, plus one case over the real file                     |
| `AGENTS.md`                                       | two `##### Shell and search` passages compressed                                                     |

### Greps run before finalizing this list

No export is removed or renamed, so the symbol-grep rules do not apply.
The mechanism-prose rule does: the two `AGENTS.md` passages are reworded, not deleted, so a mechanism-name grep is the right instrument.

- `grep -rn "AGENTS.md" test/ scripts/ --include='*.mjs'` — the agent-docs tests reference `AGENTS.md` only as a **fixture path string** (`doc-growth.test.mjs`, `always-loaded.test.mjs`) and read the real file only through `scripts/agent-docs/always-loaded.mjs`, which word-counts it rather than asserting its content.
  No root test breaks when the prose changes.
- `grep -rn "rg -r\|git commit -F" .pi/skills/ .pi/prompts/` — must be run at implementation time and any hit listed; the two rules are `AGENTS.md`-only as far as planning saw, but a prompt template restating one would go stale.
  `/ship` step 7.1 restates the `| wc -c` rule, which this change does not touch.

### Predicted unchanged, with the claim each rests on

- `packages/pi-permission-system/**` — nothing under `packages/` changes.
  The rules are configuration the shipped extension already reads; the claim rests on `denyWithReason` and `permission.bash` both being existing schema surface, verified by parsing the candidate config against `unifiedConfigSchema`.
- `.pi/extensions/pi-autoformat/config.json` — a different extension's file; the two are read by different loaders.
- `docs/agent-docs-audit/2026-09-17/*` — a dated snapshot.
  The three `keep` rows recording these rules stay as they were; per the operator's decision the negative result is recorded in this plan and the issue close comment, not written back into the snapshot.

## Test Impact Analysis

This is not an extraction, so questions (2) and (3) of the standard framing do not apply — no existing test becomes redundant, and none must stay for a layer being extracted.

What the change **enables** that was previously impractical: nothing about the repo's project config was checkable at all, because the file did not exist.
The new pair makes four properties deterministic, of which three are stricter than the published JSON Schema and one (check 4) is not expressible in JSON Schema at all.

The commands the plan prescribes were dry-run at planning time and their expected output recorded:

| Command                                                                 | Expected                                                   |
| ----------------------------------------------------------------------- | ---------------------------------------------------------- |
| `pnpm run test:scripts`                                                 | includes the new `test/permission-config/` file; all green |
| `pnpm exec biome check .pi/extensions/pi-permission-system/config.json` | clean (this is what rejects a JSONC comment)               |
| `pnpm exec rumdl check AGENTS.md`                                       | clean                                                      |

The behavioral surface — which command units each pattern matches — is **not** covered by the root harness and cannot be without a dependency on the package.
It was measured at planning time with a disposable vitest file inside `packages/pi-permission-system/test/`, over `/tmp/bash-corpus-938.json` (7,578 unique commands extracted from the review log).
The implementing session re-runs that measurement as a verify criterion rather than committing it.

## Invariants at risk

This change touches no surface a prior improvement-phase step refactored, so there is no roadmap `Outcome:` to regress.
Three invariants belong to the repo rather than a package, and each is named with what pins it.

1. **A project scope must never be invalid**, or the repo's composed policy floors `allow`→`ask` everywhere.
   Pinned by `findConfigProblems` over the real file (step 2), plus `biome check` for JSON syntax.
   Constituency: every session in this repo, including peer worktrees and subagent children.
2. **A deny rule must be escapable**, or the agent is stuck.
   Pinned by measurement, not a test: `rg --replace '' src/` and `git commit -F /tmp/msg.txt` were both confirmed **not** to match their rules at planning time (the 85 corpus uses of `git commit -F <file>` are unaffected).
   Re-verified in step 2's verify criterion.
   Constituency: the agent mid-task; a rule with no escape converts one wasted call into an unbounded loop.
3. **A `bash` pattern must be matchable at all.**
   Pinned by `findConfigProblems` check 4 for the pipeline case.
   Not pinned for the heredoc-operand case, which is [#941]'s job; the residual is fail-open in the harmless direction — the tripwire goes inert, and nothing is authorized that was not before.

The `AGENTS.md` word-count series in `docs/agent-docs-audit/` is a measurement, not an invariant: it is re-derived by `scripts/agent-docs/` on demand and no test asserts a value.

## TDD Order

The Tidy-First assessment ran (`tidy-first-assessor`, over the root harness) and returned **no preparatory refactoring warranted**: files 1–3 are greenfield and the `AGENTS.md` edit is a same-shape prose trim with no structure to prepare.
It did return one correction to the design, which is folded in above — the root harness convention is a `scripts/` pure module plus a fixture-driven test, not a self-contained test doing its own file reads.

The mechanism half (the validator) and the data half (the two rules) are sequenced as separate steps, and the check that verifies one row is written before the rows.

1. **`test: add a validator for the project-scope permission config`**

   Add `scripts/permission-config/tripwire-rules.mjs` and `test/permission-config/tripwire-rules.test.mjs`.
   Fixtures only — the real config does not exist yet, so no integration case.
   Cover, as inline object fixtures: a valid config; a `bash` value that is neither a state string nor a deny object; a deny object missing `reason`; an empty `reason`; a `reason` over 500 characters; a `reason` ending in `.`; a pattern containing `|`; a `$schema` URL that is not a `raw.githubusercontent.com/gotgenes/pi-packages/main/` path.

   Killing mutations, one per equivalence class:
   - Make `findConfigProblems` return `[]` unconditionally — every malformed fixture case must go red.
   - Make the reason check accept a missing or empty `reason` — the two reason-presence cases go red, the others stay green.
   - Delete the `|` check — that one case goes red, the others stay green.
   - Make `schemaRepoPath` return its argument unchanged — the `$schema` case goes red.

   Verify: `pnpm run test:scripts`, `pnpm run lint`.

2. **`build: add project-scope permission rules for two recurring shell tripwires`**

   Add `.pi/extensions/pi-permission-system/config.json` with the two rules exactly as given in Design Overview.
   Add the integration case to the test: `loadProjectPermissionConfig(repoRoot)` yields no problems, and `schemaRepoPath(config.$schema)` names a file that exists.

   Write the test case **first** — it fails because the file does not exist — then add the config.

   Killing mutations:
   - Delete the `reason` key from the `git commit -F` entry — the integration case goes red.
   - Add `"git rev-parse * | wc -c": {"action": "deny", "reason": "…"}` to the config, which is the issue's own proposal — the integration case goes red on check 4.
   - Change the `$schema` URL's `schemas/` segment to `schema/` — the existence assertion goes red.

   Verify, beyond the suite:
   - Re-run the planning measurement: with `/tmp/bash-corpus-938.json` present, a disposable vitest file in `packages/pi-permission-system/test/` using `BashProgram.parse` and `compileWildcardPattern` must reproduce `rg -r*` → 9 hits, `git commit -F` → 14 hits, `git commit -F *` → 85 hits (the file form, which must **not** be the configured pattern), and `git rev-parse * | wc -c` → 0 hits.
     Delete the file afterwards; it is not committed.
   - Live check, on the turn after the commit (config is re-read every turn): run `rg -rn 'x' /dev/null` and confirm the refusal names `rule 'rg -r*'` and carries the reason, with no doubled full stop.
     Do **not** live-check the `git commit -F` rule — it names a state-mutating command, and a broken rule would let it run.

   Implementation note: from this commit onward the session itself is denied `git commit -F - <<'EOF'`.
   The repo's own commit workflow already uses `Write` plus `git commit -F <file>`, which is the allowed spelling.

3. **`docs: compress two shell rules now enforced by permission rules`**

   Edit `AGENTS.md` `##### Shell and search`:
   - Replace the two `rg -r` lines with: ``` `rg -r` is `--replace`, not `--recursive`; `rg` recurses by default, so drop the `-r`. ```
   - Fold "written with `Write`" into the `git commit` line and delete the "Create that file with `Write`, never a shell heredoc …" line.
     Keep the `-m` line — it is a different rule, unmatched by any deny.

   No killing mutation applies; this step adds no test.
   Verify: `pnpm exec rumdl check AGENTS.md`; `grep -c 'approval prompt the operator must clear' AGENTS.md` returns 0; `wc -w AGENTS.md` reports 8,045 (8,083 − 38).

   Run the skill and prompt grep named in Module-Level Changes here, and fold any hit into this commit.

## Risks and Mitigations

| Risk                                                              | Mitigation                                                                                                               |
| ----------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------ |
| A typo in the new config floors the whole repo `allow`→`ask`      | Step 1's validator runs in `pnpm run test:scripts`, which `pnpm run test` invokes; `biome check` catches malformed JSON  |
| `rg -r*` denies a genuine `--replace`                             | Measured 0 occurrences in 7,578 commands, and the reason names `rg --replace`, which the pattern does not match          |
| `git commit -F` reads as denying all `-F` usage                   | The reason says otherwise explicitly; the 85 corpus uses of `git commit -F <file>` were confirmed unmatched              |
| The heredoc-operand fact changes and the rule goes inert          | Fail-open in the harmless direction. Filed as [#941] so the package asserts it                                           |
| A contributor who has not trusted the repo gets none of the rules | Accepted. The prose stays (compressed), which is the copy that survives an untrusted project                             |
| [#937] lands first and moves the two passages into a skill        | The edits are identical wherever the passages live; step 3 greps for the current text rather than assuming a line number |

One risk was checked by spike rather than argued.
`findConfigProblems` rejecting a deny object with no `reason` is stricter than the published schema, which marks `reason` optional — verified by reading `denyWithReasonSchema` in `src/config/config-schema.ts` and by parsing a reason-less object against `unifiedConfigSchema`, which accepts it.
So the check is doing real work the schema does not.

## Open Questions

- Should `scripts/permission-config/tripwire-rules.mjs` gain a CLI entry point, the way `scripts/roadmap-check.mjs` has one?
  Deferred until something other than the test wants to call it.
- If a third rule later earns admission under the three-part test in Design Overview, does that test itself belong somewhere durable?
  The issue puts generalization out of scope, and two rules is not a category.
  Revisit at the third.

[#856]: https://github.com/gotgenes/pi-packages/issues/856
[#933]: https://github.com/gotgenes/pi-packages/issues/933
[#934]: https://github.com/gotgenes/pi-packages/issues/934
[#937]: https://github.com/gotgenes/pi-packages/issues/937
[#941]: https://github.com/gotgenes/pi-packages/issues/941
