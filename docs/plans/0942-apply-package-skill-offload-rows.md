---
issue: 942
issue_title: "Apply the 19 package-skill offload rows from the 2026-09-17 agent-doc audit"
---

# Apply the 19 package-skill offload rows

## Release Recommendation

**Release:** ship independently

Issue #942 is not a roadmap step.
Both open phases recorded it in their `#### Open-issue sweep dispositions` lists as out of scope for the roadmap (`packages/pi-permission-system/docs/architecture/architecture.md` line 1177).
One commit in this plan touches `packages/pi-permission-system/docs/subagent-integration.md`, which matches the package's `files` allowlist (`docs/*.md`) and is not one of `scripts/release/lib.sh`'s `CLIFF_EXCLUDED_DOC_DIRS`, so `docs(pi-permission-system):` on that file cuts a patch release.
Measured before planning: `./scripts/release/next-version.sh pi-permission-system` prints `Nothing to release for 'pi-permission-system' (at pi-permission-system-v33.0.0)`.
Every other commit lands in `.pi/skills/`, `docs/architecture/`, or `docs/decisions/`, all of which are outside release scope.
Nothing in `packages/pi-subagents/` changes, so that package releases nothing.

## Problem Statement

The 2026-09-17 agent-doc audit marked 19 passages in the two package skills `offload` — real content that fails the admission test's second question because it fires at a trigger a *package doc* owns, not at a skill's trigger.
[#934] pruned the `delete` and `compress` rows and [#937] created the topic skills that absorbed `AGENTS.md`'s own `offload` rows, but neither touched these 19: their destinations are package architecture docs, ADRs, and `docs/subagent-integration.md`, and `/audit-agent-docs` names a destination without moving anything into it.

Measured now with a `node` word count over the row boundaries:

| Skill                                              | Total words | Words inside the offload regions |
| -------------------------------------------------- | ----------- | -------------------------------- |
| `.pi/skills/package-pi-permission-system/SKILL.md` | 12,859      | 8,406 (18 rows)                  |
| `.pi/skills/package-pi-subagents/SKILL.md`         | 2,681       | 177 (1 row)                      |

The audit's own estimate was "roughly 9,400"; 8,406 is what the row boundaries measure.
These skills are loaded on demand, not always — `scripts/agent-docs/always-loaded.mjs` reports `agentsMd=1863 descriptions=562 total=2425` and will not move.
The cost this change removes is paid by every session that touches `packages/pi-permission-system/`.

## Goals

- Apply all 19 `offload` rows so each passage's mechanism lives in a package doc and the skill retains a pointer to it.
- Leave `.pi/skills/package-pi-permission-system/SKILL.md` a working entry point: every cut leaves a lead sentence, a rule, or a citation naming where the mechanism now lives.
- Produce commits the next `/audit-agent-docs` run can close each row against as `moved (<sha>)`.
- Add no duplicate prose: a claim the destination already makes is cut from the skill and cited, not copied.

Not breaking.
No code, config, schema, or published API changes; the one released file is documentation.

## Non-Goals

- **Re-verdicting the audit's rows.**
  The `keep`, `keep (revisit)`, `compress`, and `delete` verdicts stay as the inventory recorded them, with the single exception in Module-Level Changes below (one unapplied `compress` row in the same file).
- **Editing `docs/agent-docs-audit/2026-09-17/inventory.md`.**
  The audit template closes a carried-forward row in the *next* inventory as `moved (<sha>)`; the 2026-09-17 inventory is a historical record and stays as written.
- **Editing any ADR.**
  Settled by the planning gate: mechanism prose goes to `architecture.md`; accepted decision records are not amended by this change, even where the audit named one as the destination.
- **Rewriting a moved passage.**
  A passage that reads oddly out of its old context gets a heading, not a rewrite — the verification instrument greps for the moved text.
- **Correcting facts found in a moved passage.**
  One candidate was checked and dismissed during planning (see `Risks and Mitigations`); no other correction is in scope, and one found during the build is a follow-up issue, not an edit.
- **The two `keep (revisit)` rows** (`## Testing`'s fixture catalogue and its `#478` history trail).
  The audit deferred them to the next audit and this change does not pre-empt it.
- **`packages/pi-subagents/docs/architecture/architecture.md`.**
  Row 19 is a delete from the skill; the roadmap already carries the phase list and needs no edit.

## Background

The audit is `docs/agent-docs-audit/2026-09-17/inventory.md`.
Its `### .pi/skills/package-pi-permission-system/SKILL.md` and `### All other skills` tables carry the 19 rows, each with a destination and a rationale column naming what stays in the skill.
The inventory's line numbers are explicitly "from the pre-prune tree" and are stale; locate each passage by its quoted anchor.

`/audit-agent-docs` Step 5 says an `offload` with an existing destination is applied by cutting the passage from the source and appending it verbatim to the destination.
That rule was written for a destination that does not already carry the material.
Here most of them do — see `Design Overview`.

Constraints from `AGENTS.md` and the skills that apply at the destination:

- `markdown-conventions`: an architecture-doc module-tree entry describes **current behavior**; a `(Refs #N)` belongs there only when it encodes an active constraint, and other provenance belongs in git log and `docs/architecture/history/`.
  A passage's pure-provenance clauses therefore cannot be appended to the module tree — they are deliberate drops.
- `markdown-conventions`: a `[#N]` inside a fenced code block is not a live reference.
  `architecture.md`'s `## Module structure` is one fenced tree, so a citation landing there is written bare (`#520`), with no `[#520]:` definition; a citation landing in prose is reference-style and needs its definition at the end of the file.
- `markdown-conventions`: `MD053` rejects a `[#N]:` definition with no matching body reference.
  Cutting a passage orphans the definitions it was the only user of, so each step deletes them too.
- `AGENTS.md` § Releases: `docs/plans`, `docs/retro`, `docs/architecture`, `docs/decisions`, and `docs/assets` are outside a package's release scope; `docs/*.md` (which includes `subagent-integration.md`) is not.

## Design Overview

### The finding that shapes the plan

An `Explore` survey read each row's passage against its destination, and the destinations already carry most of it.
Three examples verified directly during planning, not taken from the survey:

- Row 1 (tool surface, 584 words): `architecture.md` lines 457–472 already states `isSurfaceFullyDenied`, the ordering probe and the [#815] defect, the baseline's per-turn rebuild, [#385]'s restrict-only contract, the [#873] shrink defect, and the one-turn-late `Available tools:` line — in places near-verbatim.
  ADR 0014 states the relocation, render-from-parts, every-node, and `customPrompt` halves, with the 171/365/57,423-character measurements.
- Rows 2, 6, 8, 15 in part: the `## Module structure` tree already carries `orderDenyFirst`/`isUnconditionalDeny` with the [#899] constraint (line 915), `capLogFieldWidths` with the cap-is-not-redaction constraint (line 988), `redactCommandSecrets` with the node-not-substring safety argument (line 990), and `withSalvagedRoots` with the clean-re-parse argument (line 885).
- Row 19: `packages/pi-subagents/docs/architecture/architecture.md` lines 823–829 is a phase table covering Phases 14–18 with the same issue numbers, and it is *more* current than the skill's copy — it records the Phase 16 abandonment and the Phase 17 follow-on the skill omits.

So applying these rows verbatim would duplicate prose rather than relocate it.

### Per-row disposition

Each row is applied under one of three dispositions, settled at the planning gate:

| Disposition      | Applied as                                                                                      |
| ---------------- | ----------------------------------------------------------------------------------------------- |
| `already-stated` | Cut from the skill; leave the audit's named lead sentence / rule / pointer; no destination edit |
| `partial`        | Cut from the skill; append only the claims the destination lacks                                |
| `absent`         | Cut from the skill; append the passage whole under a fitting heading                            |

ADR-destined rows are redirected: the mechanism goes to `architecture.md` and the skill's surviving pointer cites the ADR for the decision.
No ADR file is edited.

### The 19 rows

Word counts are measured from the region boundaries named in the `Anchor` column.
Residues are the survey's, each re-verified by grep during planning where noted.

| #   | Skill region (anchor)                                  | Words | Verdict        | Action                                                                                                                                                                                              |
| --- | ------------------------------------------------------ | ----- | -------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1   | `- Hide denied tools from the agent`                   | 584   | already-stated | Cut; keep the lead sentence and the `isToolFullyDenied` pointer; cite `architecture.md` `### Phase 1: Tool filtering` and ADR 0014                                                                  |
| 2   | `The ordering's top half is enforced`                  | 126   | partial        | Append "A pre-empted call records the denial alone…" to the `gate-runner.ts` module entry                                                                                                           |
| 3   | `` - `path` and `external_directory` each carry ``     | 1,178 | partial        | Keep the first two sentences; clause-by-clause diff against ADR 0013 §3–§4 and the module tree; append the residue to `architecture.md`                                                             |
| 4   | `That subscription also drives ChildNodeAudit`         | 121   | partial        | Append the module name `ChildNodeAudit` (`src/authority/child-node-audit.ts`) and the warn-once-latch rule to `subagent-integration.md` `#### The optional bound channel`                           |
| 5   | `A serving session announces that it is draining`      | 971   | partial        | Append `forwarded_permission.no_serving_session` with its `servingChannel`/`servingState` fields, and the constant name `PERMISSION_FORWARDING_SERVING_GRACE_MS`, to `subagent-integration.md`      |
| 6   | `` `writeLine` is also where the **review** stream ``  | 130   | partial        | Append the literal `1000`, the ellipsis mark, the debug-stream-unbounded contrast, `renderReviewLogFacts`'s path, and the [#746] removal to `architecture.md`                                       |
| 7   | `Every terminal entry also carries a decidedBy`        | 298   | already-stated | Cut; append the one clause "not merged into `GateRunner`'s shared `logContext`" to the `decision-source.ts` module entry                                                                            |
| 8   | `Since #920 that predicate reaches **inside**`         | 272   | already-stated | Cut; keep the structural-redaction boundary sentence the audit names; cite ADR 0010                                                                                                                 |
| 9   | `` The `session_start`-gated publication ``            | 190   | already-stated | Cut; keep a pointer to `service-lifecycle.ts` / `session-turn-prep.ts`                                                                                                                              |
| 10  | `The path and external_directory gates are path-aware` | 363   | already-stated | Cut; keep the `do not add the same fallback for AuthorizerRegistry` rule the audit names                                                                                                            |
| 11  | `` `AuthorizerSelection.escalate` resolves ``          | 273   | already-stated | Cut; keep the one-chain-per-node rule and cite ADR 0007                                                                                                                                             |
| 12  | `The win32-vs-POSIX decision has a single home`        | 272   | partial        | Move the win32-on-POSIX-CI testing sentence to the skill's own `## Testing`; drop the [#513]/[#505]/[#562] provenance clauses as deliberate drops; append any live constraint the module tree lacks |
| 13  | `5. When a report claims a path/permission`            | 89    | new doc        | Move to `packages/pi-permission-system/docs/architecture/investigating-a-report.md`                                                                                                                 |
| 14  | `6. To quantify a proposed gate change`                | 180   | new doc        | Same file                                                                                                                                                                                           |
| 15  | `The gate fails closed (#452).`                        | 1,733 | already-stated | Cut; append the full `INDIRECTION_WRAPPER_NAMES` roster and the two sentinel strings to the `wrapper-analysis.ts` module entry                                                                      |
| 16  | `The bash enforcement stack is not limited`            | 211   | absent         | Keep the first sentence; append the alias mechanism as a new module-tree entry beside `tool-kind.ts`                                                                                                |
| 17  | `## Windows and Git Bash`                              | 535   | partial        | Keep the first bullet; append the `NUL` rationale, the `/usr` `/etc` `/mingw64` install-root detail, and the backslash-relative [#520] bullet to `architecture.md`                                  |
| 18  | `The bash external_directory gate only sees tokens`    | 880   | already-stated | Cut; keep the closing "trace the token through the classifier first" rule; append the `~`-vs-`$HOME` display fact and the POSIX drive-shaped-token fact to `architecture.md`                        |
| 19  | `### Architectural direction` (pi-subagents)           | 177   | already-stated | Delete the phase list; keep the sentence pointing at the roadmap                                                                                                                                    |

Row 16 is the only `absent` row.
Grepped during planning: `architecture.md`'s sole `shellTools` occurrence is inside a roadmap step body (line 1313), and its `tool-kind.ts` module entry says "the alias consult is a separate function" without naming it.
`docs/configuration.md` carries the user-facing half in its `shellTools` section; the architecture doc carries no entry for the mechanism at all.

Rows 13 and 14 go to a new maintainer-facing doc rather than to `docs/retro/`, settled at the gate.
Retro files exist for every issue the two passages cite (0493, 0712, 0694, 0742, 0727, and two for 0639) and each already records its own incident, so splitting the passages across them would duplicate narrative and destroy the distilled rule.
`docs/architecture/investigating-a-report.md` is a sibling of the existing `permission-prompter.md` and `v3-architecture.md`, is outside release scope, and has no existing occupant: `docs/troubleshooting.md` is user-facing configuration triage, and its single review-log mention is about `EPERM` diagnosis.

### The verification instrument

The [#937] moved-line check is adapted for a plan whose dominant disposition is *delete*, not *move*.
After each step, with `base` recorded before step 1:

```bash
base=<sha recorded before step 1>
git diff --unified=0 "$base" HEAD -- .pi/skills/package-pi-permission-system/SKILL.md \
  | grep '^-[^-]' | sed 's/^-//' \
  | grep -v '^[[:space:]]*$' | grep -v '^#' \
  | while IFS= read -r l; do
      grep -qrF -- "$l" packages/pi-permission-system/docs/ || printf 'MISSING: %s\n' "$l"
    done
```

Dry-run at planning time against [#937]'s first commit (`b649d3ea`, `AGENTS.md` → `.pi/skills/git-workflow/SKILL.md`): 56 removed lines, zero `MISSING`.

Every line the probe prints must be classified by the build session as exactly one of:

1. **already-stated** — the destination region named in the row table asserts the same claim in different words; the session opens that region and confirms it.
2. **residue** — appended to the destination in this same step, after which the line stops printing.
3. **deliberate drop** — pure provenance that the architecture-doc convention forbids at the destination; named in the commit body.

A line that fits none of the three is a lost line.

## Module-Level Changes

### Changed

- `.pi/skills/package-pi-permission-system/SKILL.md` — 18 cuts, each leaving the audit's named survivor.
  Orphaned `[#N]:` definitions removed with them: `[#393]`, `[#509]`, `[#645]`, `[#520]`, `[#694]`, `[#915]`, `[#839]`, `[#923]`, `[earendil-works/pi#4731]` are each referenced only from inside a cut region (grepped during planning); `[#261]` and `[ADR-0002]` are referenced from kept text and stay.
  `rumdl check` on the file (clean today, verified) is the backstop.
  Also drops the one unapplied `compress` row from the same inventory: `(Refs #547)` on the `test/config-schema.test.ts` parity sentence in `## Configuration` — the inventory marked it `compress`, [#934] applied its sibling `(Refs #646)` and missed this one.
  Folded into the final step rather than filed, because it is one row from the same table and one deletion.
- `.pi/skills/package-pi-subagents/SKILL.md` — row 19: delete the Phase 14–18 list under `### Architectural direction`, keep the sentence pointing at the roadmap.
- `packages/pi-permission-system/docs/architecture/architecture.md` — residue from rows 2, 3, 6, 7, 12, 15, 16, 17, 18.
  Most of it lands as additions to existing `## Module structure` entries (`gate-runner.ts`, `decision-source.ts`, `logging.ts`/`log-field-cap.ts`, `wrapper-analysis.ts`, `path-flavor.ts`) plus one new entry for the shell-alias mechanism beside `tool-kind.ts`.
  Row 17's residue lands in prose; rows 3 and 18's residue may land in either, decided per claim when the region is open.
  A citation inside the fenced tree is written bare (`#520`); a citation in prose is reference-style and needs its `[#N]:` definition — `[#520]`, `[#694]`, and `[#746]` are **not** defined in this file today (grepped).
- `packages/pi-permission-system/docs/subagent-integration.md` — residue from rows 4 and 5.
  The only released file in this change.

### Added

- `packages/pi-permission-system/docs/architecture/investigating-a-report.md` — rows 13 and 14, moved whole, with a short lead paragraph naming what the doc is for.
  Outside release scope.

### Predicted unchanged

These are falsifiable predictions, not omissions:

- `packages/pi-permission-system/docs/decisions/*` — the gate settled that no ADR is edited.
  The claim this rests on: every ADR-destined residue is a mechanism statement that `architecture.md` can hold, and the two rows whose ADR is the *whole* destination (8 → ADR 0010, 11 → ADR 0007) are `already-stated`, so they generate no residue at all.
- `packages/pi-subagents/docs/architecture/architecture.md` — row 19's content is already there, more current than the skill's copy.
- `docs/agent-docs-audit/2026-09-17/inventory.md` — closed by the next audit, not by this change.
- `packages/pi-permission-system/docs/configuration.md` — row 16's user-facing half already lives there; only the architecture doc gains the mechanism.
- `packages/pi-permission-system/README.md` — no slash command, config key, or user-facing feature name changes.
- `.pi/prompts/audit-agent-docs.md` — [#937] already gave it the `offload` and `moved (<sha>)` verdicts this change is the manual follow-through for.
- `packages/pi-permission-system/src/**` and `test/**` — documentation only.

## Test Impact Analysis

No code changes, so no unit tests.
The testable surface is the shell commands this plan prescribes, dry-run at planning time:

| Command                                                                  | Dry-run result                                                                                                   |
| ------------------------------------------------------------------------ | ---------------------------------------------------------------------------------------------------------------- |
| `pnpm exec rumdl check .pi/skills/package-pi-permission-system/SKILL.md` | `Success: No issues found in 1 file` — the pre-change baseline                                                   |
| `./scripts/release/next-version.sh pi-permission-system`                 | `Nothing to release for 'pi-permission-system' (at pi-permission-system-v33.0.0)`                                |
| `./scripts/release/next-version.sh pi-subagents`                         | `Nothing to release for 'pi-subagents' (at pi-subagents-v21.7.3)`                                                |
| `node scripts/agent-docs/always-loaded.mjs`                              | `agentsMd=1863 descriptions=562 total=2425` — must be unchanged at the end, since no skill description is edited |
| The removed-line probe above, against `b649d3ea`                         | 56 lines checked, zero `MISSING`                                                                                 |
| The word-count script over the row boundaries                            | 8,406 offload words of 12,859                                                                                    |

The per-row greps in `Design Overview` are re-runnable and are each step's own check that the destination still lacks what the step appends.

## Invariants at risk

- **The skill stays a working entry point.**
  After every step, a reader who loads only `package-pi-permission-system` can still find the mechanism: each cut leaves the audit's named survivor and, where the survivor is a bare rule, a citation naming the destination file.
  Pinned by reading the surviving text in each step's verify, not by a test — the invariant lives in prose and there is no instrument for it.
- **No dangling reference in either direction.**
  `rumdl check` on the edited files catches an orphaned `[#N]:` definition (MD053) and a broken relative link (MD057); the root `pnpm run lint` after a `find .rumdl_cache -type f -delete` catches a cross-file break the cache would hide.
  That cache-clearing step is [#937]'s own lesson and is a step here.
- **The next audit can close every row.**
  Each row's distinctive phrase must be reachable by `git log -S'<phrase>'` from one of this plan's commits, which is what the carried-forward `moved (<sha>)` verdict reads.
  Satisfied by one commit per skill section rather than one omnibus commit.
- **`always-loaded` is unchanged.**
  Package skills are loaded on demand and their `description:` frontmatter is not edited, so `always-loaded.mjs` must print `agentsMd=1863 descriptions=562 total=2425` at the end.
  A change here means a description was edited by accident.
- **The published tarball gains only intended text.**
  `docs/subagent-integration.md` ships; `git show --stat` on that commit must name that file and no other released path.

## TDD Order

Docs-only; each step is a build step with a verify criterion, executed by `/build-plan`.
No step adds tests, so no step names a killing mutation.
Record `base=$(git rev-parse HEAD)` before step 1 and use it for every removed-line probe.
Steps are ordered by skill section, top to bottom, so each commit is reviewable against its rows and no commit leaves a fact stated nowhere.

1. **`## Implementation Priorities` — rows 1, 2, 3.**
   Cut the tool-surface bullet to its lead sentence and `isToolFullyDenied` pointer; cut the `orderDenyFirst` sentences and append the pre-empted-call clause to `gate-runner.ts`; cut the read/write-axis bullet to its first two sentences and append whatever ADR 0013 §3–§4 and the module tree lack.
   Verify: removed-line probe classifies every line; `rumdl check` on both edited files; `grep -n 'isToolFullyDenied' .pi/skills/package-pi-permission-system/SKILL.md` still matches.
   Commit: `docs: move tool-surface, gate-ordering, and capability-axis mechanism into the architecture doc (#942)`.
2. **`### Event-based subagent integration` — rows 4, 5.**
   Cut the `ChildNodeAudit` and serving/liveness/relay/refusal passages; append the named residue to `subagent-integration.md`.
   Verify: probe; `rumdl check`; `grep -c 'no_serving_session' packages/pi-permission-system/docs/subagent-integration.md` is non-zero; `git show --stat HEAD` names `subagent-integration.md` and no other released path.
   Commit: `docs(pi-permission-system): document the serving-liveness and bound-channel mechanism in the integration spec (#942)`.
3. **`## Log writes` — rows 6, 7, 8.**
   Cut the width-bound, `decidedBy`, and command-redaction passages, keeping the structural-redaction boundary sentence; append the width literals and the `logContext` clause to the module tree.
   Verify: probe; `rumdl check`; the boundary sentence ("a value bound to a sensitive name is masked") still present in the skill.
   Commit: `docs: move log-width and decision-provenance mechanism into the architecture doc (#942)`.
4. **`## Cross-Extension Integration` — rows 9, 10, 11.**
   Cut all three, keeping the `AuthorizerRegistry` fallback rule and the one-chain-per-node rule.
   Verify: probe (expect zero residue — all three are `already-stated`); `rumdl check`; both kept rules present.
   Commit: `docs: cut service-lifecycle, extractor-registry, and chain-resolution narrative from the package skill (#942)`.
5. **`## Debugging` step 4 — row 12.**
   Cut the path-flavor narrative; relocate the win32-on-POSIX-CI sentence into the skill's `## Testing`; record the provenance clauses as deliberate drops.
   Verify: probe, with the dropped clauses named in the commit body; `rumdl check`; the relocated sentence appears under `## Testing`.
   Commit: `docs: move path-flavor mechanism to the architecture doc and its CI note to the skill's testing section (#942)`.
6. **New `investigating-a-report.md` — rows 13, 14.**
   Create the file with a lead paragraph; move both Debugging steps whole; renumber the surviving `## Debugging` list so `MD029` holds.
   Verify: probe; `rumdl check` on the new file and the skill; `grep -c 'reviewLogFieldMaxWidth' packages/pi-permission-system/docs/architecture/investigating-a-report.md` non-zero.
   Commit: `docs: collect report-investigation technique into an architecture doc (#942)`.
7. **`## Debugging` bash gate — rows 15, 16.**
   Cut the fail-closed-through-`COMPOUND_STATEMENT_TYPES` run; append the `INDIRECTION_WRAPPER_NAMES` roster and both sentinel strings to `wrapper-analysis.ts`; add the shell-alias module entry beside `tool-kind.ts`, keeping the skill's first sentence.
   Verify: probe; `rumdl check`; `grep -c 'resolveShellInvocation' packages/pi-permission-system/docs/architecture/architecture.md` is non-zero (measured `0` before this step).
   Commit: `docs: document the bash-gate floor and shell-tool aliasing in the architecture doc (#942)`.
8. **`## Windows and Git Bash` — row 17.**
   Cut the section to its first bullet; append the `NUL` rationale, the install-root detail, and the backslash-relative bullet to `architecture.md`.
   Verify: probe; `rumdl check`; the kept first bullet and its ADR 0003 citation are present in the skill.
   Commit: `docs: move Git Bash path semantics into the architecture doc (#942)`.
9. **`## Notes for Agents` — row 18.**
   Cut the classifier narrative, keeping the closing trace-the-token rule; append the `~`-vs-`$HOME` display fact and the POSIX drive-shaped-token fact.
   Verify: probe; `rumdl check`; the trace-the-token sentence present.
   Commit: `docs: move the bash path-classifier narrative into the architecture doc (#942)`.
10. **pi-subagents — row 19.**
    Delete the Phase 14–18 list, keep the roadmap pointer.
    Verify: a removed-line probe against `packages/pi-subagents/docs/` prints only lines the roadmap states differently, each confirmed at lines 823–829; `rumdl check`.
    Commit: `docs: cut the duplicated phase list from the pi-subagents skill (#942)`.
11. **Close out.**
    Drop the stray `(Refs #547)`; delete every orphaned `[#N]:` definition still remaining; clear the lint cache and run the root lint.
    Verify: `find .rumdl_cache -type f -delete && pnpm run lint`; `node scripts/agent-docs/always-loaded.mjs` prints `agentsMd=1863 descriptions=562 total=2425`; a whole-file probe from `base` classifies every removed line; a final word count of both skills recorded in the commit body.
    Commit: `docs: finish the 2026-09-17 offload rows and clear orphaned link definitions (#942)`.

Steps 1–10 are order-dependent only through the shared file's line numbers, which is why each one re-greps rather than carrying a line number forward.
Step 11 must be last.

## Risks and Mitigations

- **A claim judged `already-stated` is not actually stated, and the fact is lost.**
  This is the plan's principal risk: 11 of 19 rows are cut without a destination edit.
  Mitigated by the removed-line probe, which forces every cut line to be individually classified against an open destination region rather than waved through per row, and by the row table naming the destination region so the confirming read is bounded.
- **A survey finding is wrong.**
  One was: the survey reported a contradiction between the skill's "the heartbeat records live beside `sessions/`, never inside it" and the code.
  Checked at planning time — `src/config/extension-paths.ts:47` sets `forwardingDir = join(sessionsDir, "permission-forwarding")` and `src/authority/permission-forwarding.ts:70` puts request/response records under `forwardingDir/sessions/<id>/`, while `src/authority/forwarding-liveness.ts:176` puts heartbeats at `forwardingDir/serving/`.
  The records are beside that `sessions/` directory, so the doc is correct and no correction is needed.
  Every other residue claim in the row table was re-grepped during planning; the build session re-greps again before appending.
- **A cut orphans a link definition and `rumdl` is cached green.**
  Step 11 clears `.rumdl_cache` before the root lint, which is [#937]'s recorded lesson.
- **Row 3 is 1,178 words and the survey did not verify every clause.**
  The plan says so rather than claiming coverage: step 1 does a clause-by-clause diff against ADR 0013 §3–§4 with the probe as the backstop, and row 3 is the one row where a `MISSING` line should be *expected* rather than surprising.
- **An append to the fenced module tree uses a reference-style link and renders as literal text.**
  Named in `Background` as a convention, checked by reading the surrounding entries, and invisible to `rumdl` — a bare `#N` inside the fence is correct and a `[#N]` is not.
- **`pi-autoformat` reflows a destination after the edit and the next `oldText` fails.**
  Standard mitigation: re-read the region before each `Edit`, which the per-step "re-grep rather than carry a line number" rule already forces.

## Open Questions

- Whether `## Debugging` should survive at all once steps 5–7 land: rows 12–16 take most of it, leaving steps 1–3 (five lines, all `keep`) and the trailing narrative.
  Deferred to the build session's judgment on the surviving structure; collapsing or renaming the section is not required by any row and is not in scope.
- Whether `investigating-a-report.md` should be linked from `docs/architecture/README.md`.
  Checked only that the file exists; the build session reads it and adds a row if the README indexes siblings.

[#385]: https://github.com/gotgenes/pi-packages/issues/385
[#505]: https://github.com/gotgenes/pi-packages/issues/505
[#513]: https://github.com/gotgenes/pi-packages/issues/513
[#520]: https://github.com/gotgenes/pi-packages/issues/520
[#562]: https://github.com/gotgenes/pi-packages/issues/562
[#746]: https://github.com/gotgenes/pi-packages/issues/746
[#815]: https://github.com/gotgenes/pi-packages/issues/815
[#873]: https://github.com/gotgenes/pi-packages/issues/873
[#899]: https://github.com/gotgenes/pi-packages/issues/899
[#934]: https://github.com/gotgenes/pi-packages/issues/934
[#937]: https://github.com/gotgenes/pi-packages/issues/937
