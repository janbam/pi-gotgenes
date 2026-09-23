---
issue: 943
issue_title: "pi-session-tools: no way to discover or reach a session's subagent transcripts"
---

# Add `list_subagent_sessions` to reach a session's subagent transcripts

## Release Recommendation

**Release:** ship independently

`pi-session-tools` has no `docs/architecture/architecture.md` and therefore no improvement roadmap, so this issue belongs to no release batch.

The change is **not** breaking: it adds a tool and changes no existing tool's parameters, defaults, or output.
The suggested commit is `feat:`, which takes the package from `2.0.0` to `2.1.0`.

## Problem Statement

The package can walk **up** from a subagent session to its parent (`read_parent_session`) but has no way to walk **down**.
A session's subagent transcripts live at `<session-file-minus-.jsonl>/tasks/<child>.jsonl`, and nothing in the tool set reports them:

- `listSessionFiles` (`packages/pi-session-tools/src/session-file.ts`) is a non-recursive `readdirSync` filtered on `.endsWith(".jsonl")`, so `list_session_files` sees only the top level of a cwd's session directory.
- `read_session_file` omits tool result bodies by design, so the child path — which *is* present in the parent file, inside a `get_subagent_result` result — never reaches the rendered transcript.
- The agent ID the transcript does surface is not the child's filename UUID, so the path cannot be reconstructed from what a reader sees.

That leaves `rg` over the raw JSONL as the only route, which is the workaround the transcript tools exist to remove.

The concrete case the issue reports, re-verified this session against the real sessions root:

```console
$ find ~/.pi/agent/sessions/--Users-chris-development-pi-pi-packages-worktrees-issue-863-- -name '*.jsonl'
.../2026-09-06T04-26-34-471Z_01a074f7-…-acc838562474/tasks/2026-09-06T17-26-06-793Z_01a077c1-…-acccb750c892.jsonl
.../2026-09-06T04-26-34-471Z_01a074f7-…-acc838562474.jsonl
```

`list_session_files` reports one file for that cwd; two transcripts exist.
Once the path is in hand, `read_session_file` renders the child without complaint — this is a discovery gap, not a reading one.

The gap has a downstream reader today.
`/retro`'s model-performance lens (`.pi/prompts/retro.md`, the `1. **Model-performance correlation**` item) is told to attribute each turn from the transcript's inline `[provider/model]` label, but cannot reach a subagent's turns at all.
[#916]'s own retro shows the consequence: it attributed both subagent dispatches from their *definitions* ("Both subagents are pinned to `anthropic/claude-sonnet-5` by their definitions"), which records the configured model rather than the one that ran.

## Goals

- Add a tool `list_subagent_sessions({ path, limit? })` that lists the subagent transcripts of the session file at `path`, newest first.
- Distinguish "that session file does not exist" from "that session spawned no subagents" — the first is a status message, the second an empty listing naming the directory that would hold them.
- Reuse [#916]'s listing presentation verbatim (`boundListingPaths`, `DEFAULT_LIST_LIMIT`, `formatListingText`, `formatListingSummary`, `buildListingResult`) so the two listings cannot drift apart.
- Give the capability its caller: point `/retro`'s model-performance lens at subagent transcripts.
- Keep the change non-breaking — no existing tool's parameters, defaults, or rendered output change.

## Non-Goals

- **A "child sessions" footer on `read_session` / `read_parent_session` / `read_session_file`.**
  This was the issue's second proposal and the operator declined it at the `ask_user` gate in favour of the single new tool.
  It is not deferred work and no follow-up issue is filed for it.
- **Recursion, an opt-in flag, or any other new parameter on `list_session_files`.**
  The issue floats an opt-in flag; `packages/pi-session-tools/README.md`'s in-scope line says "A new capability arrives as a new tool rather than as another parameter on an existing one", and the operator chose the new tool.
  Measured, a recursive listing would also fight [#916]'s bound: of the newest 10 paths under a recursive mtime sort of this repo's session directory, 4 are subagent transcripts, so recursion would surrender 40% of the bounded window.
- **A child-count annotation on `list_session_files`'s path lines.**
  Offered at the gate, declined.
- **Defaulting `path` to the current session file.**
  Offered at the gate, declined; `list_session_files` requires `cwd` for the same reason, recorded in the README.
- **Walking more than one level down.**
  `list_subagent_sessions` reports one generation, mirroring `read_parent_session`'s single step up; a grandchild is reached by calling the tool again on the child's path.
- **Renaming `src/parent-session.ts` or splitting `src/index.ts`.**
  Both were considered and rejected by the Tidy-First assessment as scope creep; they are recorded in this issue's Planning stage note under `#### Deferred tidyings`.
- **Changing `formatListingText`'s strings**, including the `No session files found.` line the empty case emits (see Design Overview).

## Background

Everything relevant is in `packages/pi-session-tools/`:

- `src/parent-session.ts` (27 lines) — `deriveParentSessionFile(sessionFile)` encodes the `tasks/` layout in the upward direction: it returns `undefined` unless the file's directory is named `tasks`, then returns `<tasks-dir-parent>.jsonl`.
- `src/session-file.ts` (99 lines) — the package's only `node:fs` importer (verified: `grep -n "node:fs" src/*.ts` matches this file alone).
  Owns `readSessionFileEntries`, `encodeCwdToSessionDirName`, `deriveSessionsRoot`, and `listSessionFiles(directory)`, which returns absolute `.jsonl` paths newest-first by mtime, or `[]` when the directory does not exist.
- `src/session-listing.ts` (51 lines) — [#916]'s presentation layer: `DEFAULT_LIST_LIMIT = 10`, `boundListingPaths`, `formatListingText(directory, paths, total)`, `formatListingSummary(directory, shown, total)`.
- `src/index.ts` (494 lines) — six `pi.registerTool(defineTool({…}))` blocks (verified: `grep -c "pi.registerTool(" src/index.ts` → 6), plus `formatCallText`, `formatResultText`, `buildTranscriptResult`, and `buildListingResult(directory, files, params)`.
  `formatCallText` already emits a `path: …` hint and a `limit: N` hint, so a new tool's `renderCall` needs no new formatting.
- `test/` — nine suites; `captureTools` is duplicated verbatim in four of them (see Module-Level Changes).

The producing side lives in a sibling package: `packages/pi-subagents/src/session/session-dir.ts`'s `deriveSubagentSessionDir(parentSessionFile, cwd)` returns `join(dirname(parent), basename(parent, ".jsonl"), "tasks")`.
That is the exact convention this plan inverts.

Layout facts, measured this session against `~/.pi/agent/sessions/--Users-chris-development-pi-pi-packages--`:

| Fact                                                    | Value                              |
| ------------------------------------------------------- | ---------------------------------- |
| Top-level session files                                 | 611                                |
| Sessions with a `tasks/` directory                      | 340 (55.6%)                        |
| Subagent transcripts                                    | 559 (mean 1.64 per parent, max 11) |
| Subagent path length                                    | 210 chars, uniform                 |
| `tasks/*/tasks/` paths anywhere under the sessions root | 0                                  |

Depth is one level in practice because `packages/pi-subagents/src/lifecycle/create-subagent-session.ts` denylists `subagent`, `get_subagent_result`, and `steer_subagent` in every child session, so a subagent cannot spawn one.
It is reachable in principle through the subagents service API, which is why the design navigates one level at a time rather than assuming a flat tree.

Constraints from `AGENTS.md` that apply:

- `.pi/prompts/retro.md` is outside `packages/`, so it is outside every package's release scope; its edit ships no version.
- A session that edits `packages/*/src/` keeps running the pre-edit extension, and a session that edits a `.pi/prompts/*.md` template keeps the pre-edit body.
  Both apply to the implementing session — see Risks.

## Design Overview

### The tool

```typescript
list_subagent_sessions({ path: string; limit?: number })
```

`path` is the absolute path of a session `.jsonl` file whose subagent transcripts the caller wants.
It is **required**: `list_session_files` requires `cwd` on the documented grounds that the use case always targets a session other than the caller's own, and defaulting here would let a typo silently answer about the current session instead of erroring.

`limit` mirrors `list_session_files`: at most `DEFAULT_LIST_LIMIT` (10) paths unless the caller says otherwise, with a large value (e.g. `1000`) as the escape hatch, and the count line always reporting the true total.

### Naming

`list_subagent_sessions`, not `list_child_sessions`.
The producing package names the concept "subagent session" throughout (`deriveSubagentSessionDir`, `createSubagentSession`, `SubagentSession`), the issue title and the 2026-09-18 triage row both say "subagent transcripts", and "child" collides with "child process".
The operator confirmed the name at the `ask_user` gate.

### Execution path

```typescript
// in list_subagent_sessions' execute
const directory = deriveSubagentSessionsDir(params.path);
if (!sessionFileExists(params.path)) {
  return {
    content: [{ type: "text", text: `Session file not found: ${params.path}` }],
    details: { kind: "status", message: `Session file not found: ${params.path}` } as SessionToolDetails,
  };
}
return buildListingResult(directory, listSessionFiles(directory), params);
```

Three collaborators, each doing one thing: a pure path derivation, an existence question, and the listing renderer the sibling tool already uses.
`execute` takes no `ctx` — unlike `list_session_files`, which needs `ctx.sessionManager.getSessionFile()` to derive the sessions root, this tool is given an absolute path.

New exports:

```typescript
// src/parent-session.ts — already owns the tasks/ convention, upward
/** Directory holding the subagent transcripts of the given session file. */
export function deriveSubagentSessionsDir(sessionFile: string): string;

// src/session-file.ts — the package's node:fs boundary
/** Whether a session file exists on disk. */
export function sessionFileExists(file: string): boolean;
```

`deriveSubagentSessionsDir` is `join(dirname(f), basename(f, ".jsonl"), "tasks")` — pure string work, the inverse of `deriveParentSessionFile` in the same module.
`sessionFileExists` keeps `node:fs` out of `index.ts`, which imports no `node:fs` symbol today and should not start.
The `session-file.ts` module header already describes itself as owning "a generic JSONL session-file reader", so an existence predicate sits inside its charter.

### Output shapes

Reused verbatim from [#916], so the two listings cannot disagree.
A session with two subagents:

```text
Session directory: /Users/chris/.pi/agent/sessions/--project--/2026-09-06T04-26-34-471Z_01a074f7/tasks
2 session files, newest first:
  /Users/chris/.pi/agent/sessions/--project--/2026-09-06T04-26-34-471Z_01a074f7/tasks/2026-09-06T17-26-06-793Z_01a077c1.jsonl
  /Users/chris/.pi/agent/sessions/--project--/2026-09-06T04-26-34-471Z_01a074f7/tasks/2026-09-06T10-02-11-004Z_01a07612.jsonl
```

A session that spawned none:

```text
Session directory: /Users/chris/.pi/agent/sessions/--project--/2026-09-06T04-26-34-471Z_01a074f7/tasks
No session files found.
```

`No session files found.` is kept rather than specialized to "no subagent sessions".
Specializing it means giving `formatListingText` a label parameter that exists only to reword one line, and the message is accurate as written — the directory named is where those files would be, which is the fact a reader needs next.

A path with no session file behind it:

```text
Session file not found: /sessions/--project--/typo.jsonl
```

This branch is why the existence check exists: without it, a typo and a subagent-free session produce the same `No session files found.` answer.
It reuses the `details: { kind: "status" }` shape and the exact wording `read_session_file` already uses for a missing file.

### Breaking classification

Not breaking.
Nothing existing changes shape: no parameter is added to an existing tool, no default moves, and `session-listing.ts`'s strings are untouched.
The only surface every session sees is the new tool's own description — drafted at 433 characters, against `list_session_files`'s existing 455 (both measured with `printf … | wc -c`).

### Depth

One generation per call.
A caller holding a subagent's path can call the tool again on it; `deriveSubagentSessionsDir` works identically at any depth because the convention nests.
This mirrors `read_parent_session`'s single step up and keeps the result bounded without a depth parameter.

## Module-Level Changes

- **NEW** `packages/pi-session-tools/test/helpers/capture-tools.ts` — the `captureTools` scaffold, lifted from the four suites that duplicate it (Tidy-First recommendation).
- `packages/pi-session-tools/src/parent-session.ts` — add `deriveSubagentSessionsDir`; widen the module header comment, which today says only "Derives a subagent's parent session file path", to name both directions of the `tasks/` convention.
- `packages/pi-session-tools/src/session-file.ts` — add `sessionFileExists`.
- `packages/pi-session-tools/src/index.ts` — add the `list_subagent_sessions` registration (a seventh block of the same shape as the six present), its imports, and a seventh line in the module header comment's tool list.
- **NEW** `packages/pi-session-tools/test/list-subagent-sessions.test.ts` — the tool's suite, with its own `vi.mock("node:fs")` block covering `existsSync` / `readdirSync` / `statSync` and its own `mockSessionFiles`-style fixture.
- `packages/pi-session-tools/test/parent-session.test.ts` — tests for `deriveSubagentSessionsDir`.
- `packages/pi-session-tools/test/session-file.test.ts` — tests for `sessionFileExists`.
- `packages/pi-session-tools/test/list-session-files.test.ts`, `test/read-parent-session.test.ts`, `test/read-session-file.test.ts`, `test/read-session.test.ts` — import `captureTools` from the shared helper and drop the local copy.
- `packages/pi-session-tools/README.md` — a `### list_subagent_sessions` section after `### list_session_files`, documenting the signature, the `path` requirement and why, the default of 10 and the large-`limit` escape hatch, the sample output, and the missing-file status message.
- `.pi/prompts/retro.md` — one sentence in the model-performance lens pointing at `list_subagent_sessions` for a subagent's own turns, so the lens stops attributing a subagent's model from its definition.

Grep evidence gathered this session:

| Check                             | Command                                                  | Result                                            |
| --------------------------------- | -------------------------------------------------------- | ------------------------------------------------- |
| `captureTools` copies             | `grep -rn "function captureTools" test/`                 | 4 files, bodies byte-identical under `diff`       |
| `registerTool` blocks             | `grep -c "pi.registerTool(" src/index.ts`                | 6                                                 |
| `node:fs` importers in `src/`     | `grep -n "node:fs" src/*.ts`                             | `session-file.ts` only                            |
| Existing name collision           | `grep -rn "list_subagent_sessions\|list_child_sessions"` | none                                              |
| Architecture doc for this package | `ls -d packages/*/docs/architecture`                     | not present — nothing to update                   |
| Package skill                     | `ls .pi/skills/`                                         | no `package-pi-session-tools` — nothing to update |

No export is removed or renamed, so the removal sweeps do not apply.
`packages/pi-session-tools/docs/plans/` and `docs/retro/` mention `list_session_files` in historical entries; those record past state and are not updated.

Files in the blast radius this design predicts will **not** change, with the claim each rests on:

- `packages/pi-session-tools/src/session-listing.ts` — every string and bound is reused as-is; the new tool differs only in which directory it hands over.
  Its header comment says "Presentation for `list_session_files`"; a second consumer arrives without changing what the module does, so the sentence is widened only if Step 3 finds it misleading in review.
- `packages/pi-session-tools/test/session-listing.test.ts` — the pure layer it tests is unchanged.
- `src/index.ts`'s `formatCallText` / `formatResultText` — `formatCallText` already handles `path` and `limit`; `formatResultText`'s `listing` branch already delegates to `formatListingSummary` and is agnostic about which tool produced the details.
- `packages/pi-subagents/` — this plan reads its convention and changes nothing there.
- `.pi/prompts/sync-worktree.md` — it names `read_session_file` and `list_session_files` for peer-worktree sessions, a different navigation axis.

## Test Impact Analysis

1. **New tests the change enables.**
   `deriveSubagentSessionsDir` and `sessionFileExists` are pure/thin and testable directly, at the same layer `deriveParentSessionFile` is tested today.
   The tool suite adds the branch no existing suite has: a listing whose directory is derived from a *file* path rather than a cwd, plus the missing-file status branch.
2. **Tests that become redundant.**
   None.
   The `captureTools` extraction rewrites four import lines and deletes four function bodies; every assertion in those files stays.
3. **Tests that must stay as-is.**
   `test/session-listing.test.ts` — it pins the bound, the `(showing N)` disclosure, and both summary phrasings at the pure layer both tools now depend on.
   `test/list-session-files.test.ts`'s own assertions — they are the proof that the shared presentation still renders the cwd listing identically after a second consumer arrives.
   `test/session-file.test.ts`'s sort-order and missing-directory cases — the new tool's ordering is `listSessionFiles`' ordering.

The prescribed shell commands for this plan's verification are the package's existing ones, dry-run this session: `pnpm --filter @gotgenes/pi-session-tools exec vitest run` (9 suites today), `pnpm run check`, `pnpm run lint`.

## Invariants at risk

The prior steps on this surface are [#549] (introduced `list_session_files` and the listing body) and [#916] (bounded it and extracted `session-listing.ts`).
This change makes `session-listing.ts` serve **two** consumers, so each invariant below now has two constituencies, and a later change made for one would silently move the other:

- **The untruncated body shape** — `Session directory:` line, count line, indented absolute paths.
  Pinned by `test/list-session-files.test.ts`'s "lists session files for a cwd, newest first" (`toBe` against the complete string) and `test/session-listing.test.ts`'s untruncated case.
  Opened and confirmed: both assert whole strings, not substrings.
  Constituencies: the model reading a cwd listing, and now the model reading a subagent listing.
- **The count line reports the true total, with `(showing N)` when bounded** — pinned by `test/session-listing.test.ts` and by `list-session-files.test.ts`'s 12-file cases.
  Step 3 adds the same assertion for the new tool so the disclosure is pinned per consumer, not once globally.
- **`details.count` is the true total and `details.shown` the rendered count** — pinned by `list-session-files.test.ts`'s `describe("details")`.
  The new tool reaches them through the same `buildListingResult`, so the invariant holds by construction; Step 3 asserts it anyway, because "by construction" is exactly what a later refactor breaks.
- **Newest-first ordering** — pinned by `test/session-file.test.ts`.
  The head-slice bound is only correct because of it.
- **`DEFAULT_LIST_LIMIT` is 10 and the bound clamps at zero** — pinned by `test/session-listing.test.ts`.
  Reused unchanged.

Quantitative invariants, measured rather than argued:

| Quantity                               | Baseline | After this change                                                                        |
| -------------------------------------- | -------- | ---------------------------------------------------------------------------------------- |
| Tool descriptions in the system prompt | 6 tools  | 7 tools, +433 characters (measured on the drafted string)                                |
| Bounded listing body, typical case     | —        | 1.64 paths × 210 chars ≈ 345 chars (mean over 340 parents)                               |
| Bounded listing body, worst observed   | —        | 10 paths × 210 chars ≈ 2.1 KB (max observed 11 children, truncated to 10 by the default) |

The `captureTools` extraction is behavior-preserving by inspection: `diff` of the four extracted bodies is empty, so the shared copy is the same function each suite already runs.

## TDD Order

1. **Lift `captureTools` into a shared test helper.**
   `test:` — the Tidy-First assessment's one recommendation, prepared because the new suite would otherwise be a fifth verbatim copy of a function already duplicated four times.
   Create `test/helpers/capture-tools.ts` exporting `captureTools`, and migrate `test/list-session-files.test.ts`, `test/read-parent-session.test.ts`, `test/read-session-file.test.ts`, and `test/read-session.test.ts` to import it (`#test/helpers/capture-tools`, matching the package's alias convention) in the same commit, so the helper ships with its consumers.
   Re-read the moved function against the `code-design` skill before committing — an extraction is a copy, and it now lives in a shared file.
   Killing mutation: make `captureTools` return an empty `Map` — every migrated suite's `tools.get(...)!` dereference must fail, proving all four are really running the shared copy.
   Verify: `pnpm --filter @gotgenes/pi-session-tools exec vitest run`, `pnpm run check`.
   Commit: `test(pi-session-tools): lift captureTools into a shared test helper (#943)`.

2. **Add the downward derivation and the existence predicate.**
   `refactor:` — pure addition with no consumer yet, so nothing a user can observe changes and `cliff.toml` skips it.
   Red, in `test/parent-session.test.ts`: `deriveSubagentSessionsDir("/s/--p--/2026-09-06T04-26-34-471Z_abc.jsonl")` returns `/s/--p--/2026-09-06T04-26-34-471Z_abc/tasks`; applied to a path already inside a `tasks/` directory it nests one further level (the grandchild case); a path with no `.jsonl` suffix keeps its basename intact.
   Red, in `test/session-file.test.ts`: `sessionFileExists` returns what the mocked `existsSync` reports, for both answers.
   Green: add both functions; widen `parent-session.ts`'s header comment to name both directions of the convention.
   Killing mutations: (a) return `join(dirname(f), basename(f, ".jsonl"))` without `"tasks"` — every derivation test goes red; (b) make `deriveSubagentSessionsDir` use `basename(f)` instead of `basename(f, ".jsonl")` — the `.jsonl`-suffixed cases go red while the suffix-less case stays green; (c) make `sessionFileExists` return `true` unconditionally — its negative case goes red.
   Verify: `pnpm --filter @gotgenes/pi-session-tools exec vitest run`, `pnpm run check`.
   Commit: `refactor(pi-session-tools): derive a session's subagent-transcripts directory (#943)`.

3. **Register `list_subagent_sessions`.**
   `feat:` — the observable capability, its description, and the README, in one commit.
   Red, in a new `test/list-subagent-sessions.test.ts` (own `vi.mock("node:fs")` with `existsSync`/`readdirSync`/`statSync`, importing `captureTools` from Step 1's helper):
   - a parent file with two subagent transcripts renders the full body, with the derived `…/tasks` directory in the header and both paths newest-first;
   - a parent file with none renders `No session files found.` under the same derived directory;
   - a path whose file does not exist returns `Session file not found: <path>` with `details.kind === "status"` — and does **not** read the directory;
   - a 12-transcript fixture with no `limit` lists 10 under a `12 session files, newest first (showing 10):` count line, with `details.count === 12` and `details.shown === 10`;
   - an explicit `limit: 3` lists 3;
   - `execute` works when called without an `ExtensionContext`, pinning that the tool needs no session state.

   Green: register the tool in `src/index.ts` with the `path`/`limit` schema, the description (default, escape hatch, and the `read_session_file` follow-on), `renderCall`/`renderResult` delegating to the existing helpers, and the execution path from Design Overview; add the seventh line to the module header comment; add the README section.
   Killing mutations, one per class:
   - drop the `sessionFileExists` guard — the missing-file test goes red, the two populated cases stay green;
   - pass `params.path` instead of the derived directory to `buildListingResult` — the header-line assertions go red while the status-branch test stays green;
   - hardcode `params` as `{}` in the `buildListingResult` call — the `limit: 3` test goes red and the default-bound test stays green;
   - delete the `pi.registerTool(...)` call for the new tool entirely — every test in the new suite goes red at `tools.get("list_subagent_sessions")!`, pinning the registration itself and not only its `execute`.

   Verify: `pnpm --filter @gotgenes/pi-session-tools exec vitest run`, `pnpm run check`, `pnpm run lint`.
   Commit: `feat(pi-session-tools): list a session's subagent transcripts (#943)`.

4. **Point `/retro`'s model lens at subagent transcripts.**
   `docs:` — `.pi/prompts/retro.md` is outside `packages/`, so this commit ships no version.
   Add one sentence to the `1. **Model-performance correlation**` item: a subagent's turns live in its own transcript, which `list_subagent_sessions({ path })` finds and `read_session_file({ path })` renders — attribute a subagent's model from that transcript rather than from its agent definition, which records the configured model and not the one that ran.
   Verify: `pnpm exec rumdl check .pi/prompts/retro.md`, and re-read the edited item end to end for the one-sentence-per-line rule.
   Commit: `docs: read subagent transcripts in the retro model lens (#943)`.

## Risks and Mitigations

- **Risk: the implementing session cannot exercise the new tool.**
  Pi registers each extension's tools at session start, so the session that writes `list_subagent_sessions` will not have it (`AGENTS.md`, "Stale in-process extension code").
  Mitigation: verification is the unit suite, not a live call.
  Do not treat "the tool is not available" as a defect, and do not attempt a manual call as evidence.
- **Risk: Step 4's edit to `.pi/prompts/retro.md` does not take effect in the running session.**
  A slash command's expanded body is a snapshot from process start.
  Mitigation: the step is verified by reading the file and linting it, never by running `/retro`.
- **Risk: `existsSync` is true for a directory, so a caller passing a directory path gets a listing rather than an error.**
  `deriveSubagentSessionsDir("/x/y")` returns `/x/y/tasks`, which for a parent-basename directory is coincidentally correct and for anything else is an empty listing.
  Mitigation: accepted.
  Rejecting non-`.jsonl` paths would add a branch and a second status message for an input no documented caller produces; the empty listing names the directory it looked in, which is self-diagnosing.
- **Risk: a shared `formatListingText` change made for one tool silently moves the other.**
  Mitigation: Step 3 asserts the body, the count line, and both `details` numbers for the new tool independently, rather than relying on the shared helper's own suite — so a change made for the cwd listing fails the subagent listing's tests too.
- **Risk: `pnpm fallow dead-code` flags Step 2's exports between commits.**
  `deriveSubagentSessionsDir` and `sessionFileExists` have no consumer until Step 3.
  Mitigation: the gate that matters runs at the end of `/tdd-plan`, after Step 3 wires them; if a mid-plan run is made, expect and ignore those two.
- **Risk: the `captureTools` extraction changes behavior in four suites at once.**
  Mitigation: the four bodies are byte-identical under `diff`, the migration lands with its consumers in one commit, and Step 1's killing mutation proves all four exercise the shared copy.

## Open Questions

None.
The surface, the name, the `path` requirement, the bound, and the `/retro` wiring were all settled at the `ask_user` gates; the remainder is mechanical.

[#549]: https://github.com/gotgenes/pi-packages/issues/549
[#916]: https://github.com/gotgenes/pi-packages/issues/916
