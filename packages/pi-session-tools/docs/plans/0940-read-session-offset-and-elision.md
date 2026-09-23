---
issue: 940
issue_title: "read_session has no offset: attributing early turns in a long session re-renders the whole tail"
---

# Paging and eliding a long transcript

## Release Recommendation

**Release:** ship independently

`pi-session-tools` has no `docs/architecture/architecture.md` and therefore no improvement roadmap, so no `Release:` tag governs this issue.
It is a self-contained addition to three tools plus a bug fix, with no sibling step waiting on it.

## Problem Statement

`read_session` bounds its result only from the tail: `limit` returns the most recent N entries.
Reaching the early part of a long session means asking for a larger window and re-rendering everything already read.

The concrete cost, measured on the session the issue cites (`--Users-chris-development-pi-pi-packages--/2026-09-17T16-05-46-932Z_01a0b01d….jsonl`, 246 entries) by running the package's own `formatTranscript` over it:

| what                                                        | rendered chars | ≈ tokens (chars/4) |
| ----------------------------------------------------------- | -------------- | ------------------ |
| whole session, today's rendering                            | 99,905         | 25.0k              |
| the three calls `/retro` actually made (`limit` 40, 75, 97) | 78,001         | 19.5k              |
| the same 97-entry coverage, paged backward with `offset`    | ~34,000        | ~8.5k              |
| all 246 entries, user bodies elided to a placeholder        | 53,377         | 13.3k              |
| the third call's *new* 22 entries alone (`slice(-97, -75)`) | 2,213          | 0.55k              |

All five numbers are measured, not estimated.
Composition of the rendered transcript: user bodies 46,693 chars (46.7%), assistant prose 31,286, assistant structure (`N. assistant [provider/model]` headers plus `[tool]`/`[bash]` lines) 20,505, metadata 182.

The two proposals in the issue are not interchangeable.
`offset` makes *incremental* coverage cheap — the third call's genuinely new 22 entries cost 2,213 chars instead of the 34,056 a `limit: 97` call re-renders — but paging the whole session still costs the whole session.
Elision makes *total* coverage cheap — 53,377 chars for all 246 entries, less than the three partial calls actually cost — but never gets below roughly half a full render.
The operator chose both, sequenced.

A third gap surfaced while measuring, which the issue does not name.
The stage-attribution lens needs stage boundaries, and they are in the session file as `session_info` entries — this session has four, carrying `"#934 Ship — …"` and `"#934 Retrospective — …"`.
`formatMetadataEntry` drops `session_info` on its `default:` arm, so `read_session` cannot see them at all and `types: ["session_info"]` renders an empty transcript.
Today the only way to find a stage boundary is to read the user-message bodies — exactly what elision removes.
Rendering `session_info` is what makes elision non-lossy for this consumer rather than merely cheaper.

Finally, `offset` rewrites the same `entries.slice(-params.limit)` expression that [#950] reports as unclamped, so the two are settled together.

## Goals

- Add an `offset` parameter to `read_session`, `read_parent_session`, and `read_session_file` so a caller can page backward through a long session.
- Add an `elide_user_text` parameter to the same three tools that replaces each user turn's body with a length placeholder, keeping turn numbering, `[provider/model]` labels, and tool-call summaries.
- Render `session_info` entries as `[session] → <name>` metadata lines, so stage boundaries survive elision.
- Fix [#950] in the same pass: `limit: 0` returns no entries and a negative `limit` or `offset` is clamped to zero, instead of silently returning more than the caller asked for.
- Keep the existing no-parameter rendering behavior intact apart from the two named, deliberate output changes (below).

This change is **not breaking**.
Both new parameters are optional, and omitting them renders what the tools render today — with two deliberate output changes that a caller cannot avoid, both named here rather than hidden:

1. A `session_info` entry now renders a `[session] → <name>` line where it previously rendered nothing.
   Measured on the cited session: 4 entries, +309 rendered chars against a 99,905-char baseline (0.3%).
2. Phantom `model_change` entries are now pruned from the entry array before `limit` and the summary are applied, rather than suppressed at render time.
   Measured on the cited session: 9 markers, 4 effective, so the collapsed TUI summary reads `241 entries` where it previously read `246 entries`.
   The rendered transcript text is unchanged by this; only the count and the meaning of `limit: N` (N entries you will see, rather than N raw entries of which some render as nothing) shift.

Neither changes a default, a parameter name, or a result shape, so the commits are `feat:`/`fix:`, not `feat!:`.

## Non-Goals

- **Eliding assistant prose.**
  Measured at 31,286 chars (31.3%) on the cited session, so it is not negligible — but the consumer the issue names needs assistant turns for their `[provider/model]` labels and tool-call lines, and the elision boundary between "prose" and "structure" inside one turn is a different decision from eliding a whole message body.
  Recorded in Open Questions rather than built.
- **[#944] (`parentId`-aware rendering).**
  Transcript rendering still walks the file in write order; abandoned branches remain interleaved.
  `selectEntries` windows the same flat array the formatter sees today, so it neither helps nor hinders that issue.
- **A `before`/`after` entry-id cursor.**
  `offset` composes with the existing `limit` and needs no stable identifier; an id-based cursor is the design [#944] would want, once the file is read as a tree.
- **A raw or JSON passthrough mode**, per the README's standing non-goal.
- **New tools.**
  The README's scope rule — "a new capability arrives as a new tool rather than as another parameter on an existing one" — was read at the 2026-09-18 triage as not reaching an `offset` bound.
  `elide_user_text` is a rendering option on an existing capability rather than a new one, and the operator confirmed the parameter form at the planning gate.
- **`src/session-file.ts`, `src/parent-session.ts`, `src/session-listing.ts` and their tests are predicted unchanged.**
  The claim: this change never touches file discovery, path derivation, or listing presentation — `selectEntries` sits strictly between `readSessionFileEntries`/`getEntries` and `formatTranscript`.
  `test/list-session-files.test.ts`, `test/list-subagent-sessions.test.ts`, `test/session-file.test.ts`, `test/session-listing.test.ts`, and `test/parent-session.test.ts` should stay green with no edits; an edit needed in any of them falsifies the claim.

## Background

The relevant modules in `packages/pi-session-tools/`:

- `src/index.ts` (564 lines) — registers all seven tools.
  `buildTranscriptResult` (lines ~124-148) is the shared pre-format pipeline for the three transcript tools: filter by `types`, then `entries.slice(-params.limit)`, then `summarizeEntries` + `formatTranscript`.
  `formatCallText` (lines ~55-73) builds the collapsed call label from `path`/`cwd`/`types`/`limit` hints.
- `src/format-transcript.ts` (317 lines) — `formatTranscript(entries)` and the exported `collectEffectiveModelChangeIndices` ([#546]).
  `formatTranscript` calls the latter at line ~272 and skips non-effective `model_change` entries at lines ~278-281.
  `formatMetadataEntry` (lines ~215-250) renders `compaction`, `model_change`, `thinking_level_change`, and `branch_summary`, and returns `null` for everything else — including `session_info`.
  `formatUserMessage` (lines ~178-184) renders `${num}. user\n${text}`.
- `src/entry-summary.ts` (104 lines) — `summarizeEntries` derives `modelChanges` from `collectEffectiveModelChangeIndices(entries).size` (line ~74).
- `src/session-listing.ts` — `boundListingPaths` clamps with `files.slice(0, Math.max(0, limit))`, landed by [#916].
  That is the package's established clamping convention and the one `selectEntries` mirrors.

Constraints from AGENTS.md and the skills that apply here:

- Multi-word tool parameters in this repo are snake_case (`run_in_background`, `inherit_context`, `max_turns`, `expected_sha`, `issue_number`), so the new flag is `elide_user_text`, not `elideUserText`.
  Internal TypeScript names stay camelCase.
- "elide" is already this repo's word for a budget-driven omission (`pi-permission-system`'s `promptMaxRows` documentation), so the parameter adopts existing vocabulary rather than inventing `compact`/`outline`/`summary`.
- Pi SDK facts verified against the pinned `@earendil-works/pi-coding-agent@0.79.1`: `SessionManager.appendSessionInfo(name)` writes `{ type: "session_info", id, parentId, timestamp, name: name.trim() }`, and `getSessionName()` treats an empty `name` as an explicit clear.
  Across 400 local session files, 316 `session_info` entries all carry a non-empty string `name` and all share that exact key set — but the empty-name clear is reachable by contract, so the renderer must handle it.
- `Type.Number({ minimum: 0 })` is supported: typebox 1.1.38's `TNumberOptions` declares `minimum`.

## Design Overview

### The selection pipeline

A new pure module `src/entry-selection.ts` owns everything that happens to the entry array before formatting.
It takes over the body of `buildTranscriptResult` and the phantom-marker logic that currently lives inside `formatTranscript`.

```typescript
export interface EntrySelection {
  types?: string[];
  offset?: number;
  limit?: number;
}

/**
 * Filter by `types`, drop phantom `model_change` markers, then window.
 * The returned array is exactly what the caller will see rendered.
 */
export function selectEntries(
  entries: TranscriptEntry[],
  selection: EntrySelection,
): TranscriptEntry[];
```

Three stages, in this order:

1. **Type filter** — the existing `Set`-based filter, unchanged.
2. **Phantom pruning** — remove every `model_change` entry that `collectEffectiveModelChangeIndices` does not mark effective, including its zero-assistant guard ([#546]): when the filtered stream contains no assistant message at all, every marker is kept.
3. **Window** — `offset` entries skipped from the most-recent end, then at most `limit` entries taken backward from there.

```typescript
const end = entries.length - Math.max(0, offset ?? 0);
const start = limit == null ? 0 : Math.max(0, end - Math.max(0, limit));
return entries.slice(Math.max(0, start), Math.max(0, end));
```

`Math.max(0, …)` mirrors `boundListingPaths`.
`slice` already truncates fractional bounds via `ToIntegerOrInfinity`, so no explicit `Math.trunc` is needed.
The schemas additionally declare `minimum: 0` on `offset` and on the three existing `limit` parameters, so the model is told the constraint; the clamp is the enforcement.

### Why pruning must precede windowing

This ordering is load-bearing, not incidental.
`collectEffectiveModelChangeIndices` marks a `model_change` effective when an assistant turn follows it *within the array it is given*, and treats the end of the array as "no turn followed".
That is correct today because `limit` always yields a **suffix**: the array's end is the session's end.

With `offset > 0` the window no longer ends at the session's end.
A real switch sitting at the window's trailing edge — its assistant turn one entry past the boundary — would be misread as a phantom and silently dropped, for exactly the reader (`/retro`'s model-performance lens) whose whole job is noticing model switches.
Pruning on the unwindowed array removes the failure mode structurally rather than papering over it with a boundary flag.

The consequences are two simplifications, both downstream:

- `formatTranscript` no longer calls `collectEffectiveModelChangeIndices` and renders every `model_change` it is handed.
- `summarizeEntries` counts `type === "model_change"` entries directly and drops its import of that helper.

Call-site sketch after the change:

```typescript
function buildTranscriptResult(allEntries, params) {
  const entries = selectEntries(allEntries, params);
  return {
    content: [
      {
        type: "text",
        text: formatTranscript(entries, {
          elideUserText: params.elide_user_text,
        }),
      },
    ],
    details: { kind: "transcript", summary: summarizeEntries(entries) },
  };
}
```

Each collaborator is told what to do with the array it receives and asks it nothing about where the array came from.

### Elision

`formatTranscript` gains an options object rather than a positional flag:

```typescript
export interface TranscriptOptions {
  /** Replace each user turn's body with a length placeholder. */
  elideUserText?: boolean;
}

export function formatTranscript(
  entries: TranscriptEntry[],
  options?: TranscriptOptions,
): string;
```

`formatUserMessage` renders `${num}. user\n[text elided: ${text.length} chars]` when the flag is set.
The character count is kept deliberately: it is how a reader recognizes a 40,000-char `/ship` template body without paying for it.
An empty user body elides to `[text elided: 0 chars]` rather than to nothing, so a turn is never silently indistinguishable from a missing one.

Elision does not remove entries.
`types`, `offset`, `limit`, phantom pruning, and the summary counts are all unaffected by it — which is why a `/retro` lens can set it without tripping the "use an **unfiltered** call" rule that exists because a `types` filter defeats phantom suppression ([#737], [#546]).

### `session_info` rendering

`formatMetadataEntry` gains one arm:

```typescript
case "session_info": {
  const name = typeof e.name === "string" ? e.name.trim() : "";
  return name ? `[session] \u2192 ${name}` : null;
}
```

`[session] → <name>` matches the existing `[model change] → <provider>/<model>` shape.
An empty name is the SDK's explicit title clear, not a stage boundary, so it renders nothing — preserving today's behavior for that case.

No phantom-style suppression is applied to renames: unlike a model switch, a rename that runs no turn afterward still records that the operator retitled the session, and the entry is one short line.

### Edge cases

| input                                | result                                                      |
| ------------------------------------ | ----------------------------------------------------------- |
| `limit: 0`                           | no entries (today: **all** entries)                         |
| `limit: -5`                          | no entries (today: all but the oldest five)                 |
| `offset: 0`                          | identical to omitting it                                    |
| `offset: -3`                         | clamped to `0`                                              |
| `offset` ≥ entry count               | no entries                                                  |
| `offset` with no `limit`             | every entry older than the most recent `offset`             |
| `offset` + `limit` together          | the `limit` entries ending `offset` from the tail           |
| `types` + `offset` + `limit`         | filter, prune, then window — offsets count filtered entries |
| `elide_user_text` with no user turns | identical to omitting it                                    |

## Module-Level Changes

**NEW** `packages/pi-session-tools/src/entry-selection.ts`

- `EntrySelection` interface and `selectEntries`.
- `collectEffectiveModelChangeIndices`, relocated here from `format-transcript.ts` (it is a selection concern, not a formatting one).

**CHANGED** `packages/pi-session-tools/src/format-transcript.ts`

- `formatTranscript` gains an optional `TranscriptOptions` second parameter; loses the `collectEffectiveModelChangeIndices` call (line ~272) and the phantom `continue` guard (lines ~278-281).
- `collectEffectiveModelChangeIndices` (lines ~129-158) moves out; the module keeps exporting `TranscriptEntry`.
- `formatMetadataEntry` gains the `session_info` arm; its comment listing omitted types (`custom, label, session_info, custom_message`) drops `session_info`.
- `formatUserMessage` gains the elision branch and an options parameter.

**CHANGED** `packages/pi-session-tools/src/entry-summary.ts`

- `summarizeEntries` counts `model_change` entries directly; the `collectEffectiveModelChangeIndices` import (line ~9) and call (line ~74) drop.
- The `SessionSummary.modelChanges` doc comment changes from "followed by an assistant turn (phantom switches excluded)" to a plain count, since pruning now happens upstream.

**CHANGED** `packages/pi-session-tools/src/index.ts`

- `buildTranscriptResult` delegates to `selectEntries` and threads `elideUserText` into `formatTranscript`.
- `read_session`, `read_parent_session`, `read_session_file`: each gains `offset: Type.Optional(Type.Number({ minimum: 0, description: … }))` and `elide_user_text: Type.Optional(Type.Boolean({ description: … }))`, `minimum: 0` added to the existing `limit`, and both fields added to the inline `params` type on `execute`.
- `formatCallText` gains `offset` and `elide_user_text` hints (its `args` parameter type grows the two fields).

**CHANGED** `packages/pi-session-tools/test/format-transcript.test.ts` (935 lines)

- The `collectEffectiveModelChangeIndices` `describe` block (lines 880-935, 6 tests) and its import (line 3) move to `test/entry-selection.test.ts`.
- `"suppresses a trailing model_change with no following assistant turn"` (line 492) and `"keeps only the last of several consecutive model_change entries that precede an assistant turn"` (line 514) are now assertions about `selectEntries` — they move too.
- `"renders every model_change when the stream has no assistant messages at all (filtered-stream guard)"` (line 546) stays and still passes; the guard it names moves to `selectEntries`, so an equivalent case is added there.
- `"omits session_info entries"` (line 678) is rewritten to assert the `[session] → My session` line, with a new sibling case for an empty `name`.
- New cases for `elideUserText`.

**CHANGED** `packages/pi-session-tools/test/entry-summary.test.ts` (352 lines)

- `"counts only effective model changes — ones followed by an assistant turn"` (line 137), `"excludes a trailing model_change with no following assistant turn from the count"` (line 142), and `"counts only the last of several consecutive model_change entries that precede a turn"` (line 147) become `selectEntries` assertions and move.
- `"counts model_change entries when no assistant message is present (filtered-stream guard)"` (line 128) stays, reworded — a raw count satisfies it either way.

**NEW** `packages/pi-session-tools/test/entry-selection.test.ts`

**CHANGED** `packages/pi-session-tools/test/read-session.test.ts`, `test/read-parent-session.test.ts`, `test/read-session-file.test.ts`

- `offset` and `elide_user_text` cases per tool, plus the `limit: 0` regression for [#950] and the end-to-end phantom-pruning pin.

**UNCHANGED** `packages/pi-session-tools/test/helpers/capture-tools.ts`

- Its captured `execute` signature is already `(...args: unknown[]) => Promise<unknown>`, so it absorbs the new params without an edit.

**CHANGED** `packages/pi-session-tools/README.md`

- `read_session` parameter list gains `offset` and `elide_user_text`; `read_parent_session` and `read_session_file` inherit via their "same as `read_session`" references, which need the new names spelled once.
- The sample transcript gains a `[session] → …` line.
- A short paragraph on paging backward, with the measured cost framing.

**CHANGED** `.pi/prompts/retro.md`

- The model-performance lens (line 102) currently mandates an " **unfiltered** `read_session` call".
  It must say that `elide_user_text: true` and `offset` are not filters and are the intended way to run the lens on a long multi-stage session, and that `[session] → …` lines mark the stage boundaries the lens attributes to.
  The adjacent line 101 states the same attribution rule in weaker form; both are edited together so the file does not describe the lens twice with different guidance.

Greps run to close the blast radius:

- `collectEffectiveModelChangeIndices` across `packages/pi-session-tools/` — 3 production/test reference sites (`format-transcript.ts:272`, `entry-summary.ts:9,74`, `format-transcript.test.ts:3,880-935`), plus historical mentions in `docs/plans/0546-*.md`, `docs/plans/0549-*.md`, and `docs/retro/0546-*.md`, which describe past work and are not edited.
- `read_session|read_parent_session|read_session_file` across `.pi/skills/`, `.pi/prompts/`, `.pi/agents/` — `.pi/prompts/retro.md` (edited), `.pi/prompts/sync-worktree.md` and `.pi/skills/reproduction/SKILL.md` (both cite `read_session_file({ path })` only, unaffected by new optional params).
- There is no `packages/pi-session-tools/docs/architecture/` tree, so no module listing, complexity table, or diagram references these files.
- No symbol is removed from a public surface: the package declares no `exports` map and ships only `./src/index.ts` as its extension entry, so `collectEffectiveModelChangeIndices`'s relocation is internal.

## Test Impact Analysis

**What the extraction enables that was impractical before.**
`selectEntries` makes the whole pre-format pipeline unit-testable in one place.
Today the `types` filter and the `limit` slice are only reachable through a registered tool with a mocked `sessionManager` or a mocked `node:fs`, which is why the same `types`/`limit` scenarios are hand-rolled three times across `read-session.test.ts`, `read-parent-session.test.ts`, and `read-session-file.test.ts`.
The windowing matrix — `offset` alone, `offset` + `limit`, either clamped, `offset` past the end, interaction with the type filter — belongs in `test/entry-selection.test.ts` as plain array-in/array-out assertions.

**What becomes redundant.**
The three tool tests do not need the full windowing matrix once `selectEntries` owns it.
Each keeps **one** `offset` case and **one** `elide_user_text` case, proving the parameter is declared in the schema and threaded to the pipeline — the wiring, not the arithmetic.
The existing per-tool `limit` and `types` tests stay as-is rather than being deleted: they are the only thing pinning that each tool passes its params through at all.

**What must stay.**
`test/format-transcript.test.ts`'s rendering assertions genuinely exercise the formatter and stay put.
The `filtered-stream guard` case at line 546 stays in the formatter's file *and* gains a counterpart in `entry-selection.test.ts`, because after the move both layers have a stake in it: the formatter must render every marker it is handed, and the selector must not prune markers out of a stream with no ground truth.

**The three-file fixture question.**
The Tidy-First assessor floated a shared entries fixture across the three tool tests and left it Optional, noting the three deliver entries differently (`read_session` through `sessionManager.getEntries()`, the other two through a mocked `node:fs` fed JSONL strings).
Declined: the delivery difference is structural, and an abstraction over it would need a discriminator parameter that exists only to paper over it.
With the windowing matrix living in `entry-selection.test.ts`, each tool file gains 2-3 cases rather than 6-8, which is under the threshold where the duplication would justify the risk.

## Invariants at risk

**[#546] — a phantom model switch appears in neither the transcript nor the count.**
Constituency: `/retro`'s model-performance lens, which reads a `[model change]` line as "the model that ran the next turn".
Today this is pinned at two layers, both of which this plan moves: `format-transcript.test.ts:492,514` and `entry-summary.test.ts:137,142,147`.
Moving both pins to `entry-selection.test.ts` would leave the invariant unpinned end-to-end, so the plan adds a `read_session` test asserting that a phantom marker is neither rendered nor counted — the tool-level statement of the invariant, which no current test makes.

**[#546] — the zero-assistant guard.**
Constituency: a caller running `types: ["model_change"]`, whose stream has no ground truth to validate markers against.
Pinned after the change by `format-transcript.test.ts:546` (formatter renders all) plus a new `entry-selection.test.ts` case (selector prunes none).

**[#916] — a listing `limit` below zero yields none rather than silently dropping the oldest few.**
Constituency: `list_session_files` / `list_subagent_sessions` callers.
Untouched — `boundListingPaths` and `test/session-listing.test.ts` are outside this change; `selectEntries` adopts the same `Math.max(0, …)` convention rather than inventing a second one.

**Quantitative: default rendering is unchanged apart from `session_info` lines.**
Measured baseline on the cited 246-entry session: 99,905 rendered chars, 9 `model_change` markers of which 4 are effective, 4 `session_info` entries.
Predicted after: 100,214 chars (+309, +0.3%) from four `[session] → …` lines, identical transcript text otherwise, and a collapsed summary reading `241 entries` instead of `246 entries`.
Step 5's verification re-runs the real formatter over that same file and diffs against the captured baseline; anything beyond the four inserted lines is a regression.

**A user turn is never silently lost under elision.**
Constituency: any reader counting turns, since turn numbers are sequential across user and assistant messages.
Pinned by a `formatTranscript` case asserting that an elided transcript has the same turn numbering as the unelided one, and that a zero-length user body still renders its header and placeholder.

## TDD Order

1. **`refactor(pi-session-tools): move phantom model-change detection into entry selection`** Preparatory (Tidy First, Recommended).
   Friction it prepares: `collectEffectiveModelChangeIndices` has to end up in the new module *and* stop being called by `formatTranscript`; bundling the move with the behavior change makes "moved" and "removed" indistinguishable in the diff.
   Pure move: cut the function into a new `src/entry-selection.ts`, update the imports in `format-transcript.ts` (which keeps calling it — behavior unchanged) and `entry-summary.ts`, and move the `describe("collectEffectiveModelChangeIndices", …)` block (lines 880-935) verbatim into a new `test/entry-selection.test.ts` importing from `#src/entry-selection`.
   No re-export shim — three call sites is cheap to update and grep-verify.
   Verify: `pnpm --filter @gotgenes/pi-session-tools run test && … run check && … run lint`; `grep -rn collectEffectiveModelChangeIndices packages/pi-session-tools/src` names only `entry-selection.ts`, `format-transcript.ts`, `entry-summary.ts`.
   Killing mutation: in the moved function, make the `sawAssistantMessage` guard's early return unconditional (always `return new Set(modelChangeIndices)`) — the six moved tests in the new file must go red, proving the move carried the real implementation rather than a stub.

2. **`refactor(pi-session-tools): add the entry selection pipeline`** Pure addition; no consumer references `selectEntries` yet, so this is `refactor:` and stays out of the changelog.
   Red: `test/entry-selection.test.ts` gains the full matrix — type filter; phantom pruning including the zero-assistant guard; `limit` alone; `offset` alone; both together; `limit: 0`; negative `limit`; negative `offset`; `offset` past the end; pruning-before-windowing (a marker whose assistant turn sits just past the window's trailing edge is **kept**).
   Green: implement `EntrySelection` and `selectEntries`.
   Killing mutations, one per equivalence class:
   - Replace the window computation with `entries.slice(-limit)` — the `offset`, `limit: 0`, and negative-bound tests go red; the type-filter and pruning tests stay green.
   - Delete the pruning stage — the phantom-pruning and pruning-before-windowing tests go red; the windowing tests stay green.
   - Swap the pruning and windowing stages — only the pruning-before-windowing test goes red, which is the point of naming it separately.

3. **`fix(pi-session-tools): return no entries for a limit of zero or less`** Closes [#950].
   Red: `read_session({ limit: 0 })` returns an empty transcript and a zero-count summary; `read_session({ limit: -5 })` likewise; plus the end-to-end phantom pin from Invariants (a phantom marker is neither rendered nor counted through the tool).
   Green: `buildTranscriptResult` delegates to `selectEntries`; remove the suppression call and `continue` guard from `formatTranscript`; `summarizeEntries` counts `model_change` entries directly and drops its import.
   Same commit, forced by the behavior move: update `format-transcript.test.ts:492,514` (move to `entry-selection.test.ts`) and `entry-summary.test.ts:137,142,147` (move likewise), reword `entry-summary.test.ts:128`.
   Verify: full package suite green; `check` and `lint` clean.
   Killing mutation: restore `entries.slice(-params.limit)` inside `buildTranscriptResult` — the two new tool-level limit tests go red while every `entry-selection` test stays green, which is what proves the tool is wired to the new pipeline rather than merely coexisting with it.

4. **`feat(pi-session-tools): page backward through a long transcript`** Red: one `offset` case per transcript tool (`read_session`, `read_parent_session`, `read_session_file`) asserting the window excludes the most recent N and includes the entries before them; one `formatCallText` assertion that the call label shows `offset: N`.
   Green: add the `offset` schema field (with `minimum: 0`) and the `params` type field to all three tools, add `minimum: 0` to the three existing `limit` fields, extend `formatCallText`.
   Killing mutation: drop `offset` from `read_parent_session`'s `Type.Object` while leaving the other two — that tool's new test must go red on its own, since a param added in three places is as unpinned in each as a relocated line is at its new site.

5. **`feat(pi-session-tools): show session renames as transcript stage boundaries`** Red: `formatMetadataEntry`/`formatTranscript` cases — a named `session_info` renders `[session] → My session`; an empty or whitespace `name` renders nothing; rewrite `format-transcript.test.ts:678` accordingly.
   Green: the `session_info` arm; drop `session_info` from the omitted-types comment.
   Verify, beyond the suite: re-render the measured session file through the real formatter and diff against the captured baseline — exactly four inserted `[session] → …` lines, 100,214 chars total, no other change.
   Killing mutation: return `` `[session] → ${name}` `` unconditionally (without the empty-name guard) — the empty-`name` test must go red while the named-entry test stays green.

6. **`feat(pi-session-tools): elide user-message bodies from a transcript`** Red: `formatTranscript` cases — elided output replaces each user body with `[text elided: N chars]`; turn numbering matches the unelided render; a zero-length body renders `[text elided: 0 chars]`; assistant turns, tool lines, and metadata lines are byte-identical to the unelided render.
   Plus one `elide_user_text` case per transcript tool, and a `formatCallText` assertion.
   Green: `TranscriptOptions`, the `formatUserMessage` branch, the three schemas, the `params` types, `formatCallText`.
   Killing mutations:
   - Make `formatUserMessage` drop the user block entirely when eliding — the turn-numbering test goes red while the placeholder-content test's `toContain` would not have caught it.
   - Hard-code the placeholder count to `0` — the non-empty-body test goes red while the zero-length test stays green.

7. **`docs(pi-session-tools): document transcript paging and elision`** README parameter lists, the sample transcript's `[session] → …` line, the paging paragraph, and the `.pi/prompts/retro.md` model-performance lens rewrite (both line 101 and line 102, so the file states the rule once).
   Verify: `pnpm exec rumdl check packages/pi-session-tools/README.md .pi/prompts/retro.md`, and re-read the edited lens end to end for a second, now-stale statement of the same workflow.

## Risks and Mitigations

- **Risk: pruning before windowing changes what `limit: N` means, and a caller's mental model with it.**
  A `limit: 40` call on a stretch containing phantoms now returns 40 rendered entries rather than 40 raw entries of which some render as nothing.
  Mitigation: this is the semantics the parameter's description already claims, the README states it explicitly, and the measured delta on a real session is 246 → 241 in the summary line with identical transcript text.

- **Risk: removing suppression from `formatTranscript` leaves a direct caller rendering phantoms.**
  Mitigation: `buildTranscriptResult` is the only production caller — verified by the `formatTranscript(` grep, which finds one `src/` call site and the test file.
  The package exports no submodules, so there is no external caller to regress.

- **Risk: the empty-`name` `session_info` path is argued rather than exercised.**
  The clear-title case did not occur once in 316 sampled entries, so "no input of this shape exists" is exactly the unproven discharge to avoid.
  Mitigation: it is reachable by contract — `appendSessionInfo` trims and `getSessionName()` treats the empty result as a clear — so step 5 pins it with its own test and its own killing mutation rather than relying on corpus frequency.

- **Risk: `minimum: 0` in the schema is decorative if Pi does not validate tool arguments against it.**
  Mitigation: the clamp inside `selectEntries` is the enforcement and is what the tests pin; the schema constraint is documentation aimed at the model, and nothing depends on it holding.

- **Risk: the measured cost numbers do not generalize past one session.**
  A second 477-entry session measured 147,959 rendered chars with a 36.2% user-body share (against 46.7% for the cited one), so elision's benefit varies with how prompt-heavy a session is.
  Mitigation: both figures are in the plan, and neither the design nor any test depends on a particular ratio.

## Open Questions

- **Should assistant prose be elidable too?**
  Measured at 31,286 chars (31.3%) on the cited session — the largest remaining block after user bodies.
  Deferred rather than filed: the right shape is probably a single parameter naming what to keep rather than a second boolean, and that decision wants a second consumer to exist first.
- **answer** so a pager can size its own walk without a probe call?
  The collapsed summary already reports `totalEntries` for the returned window, not the session.
  Not filed; revisit if paging in practice starts with a throwaway `limit: 1` call.

[#546]: https://github.com/gotgenes/pi-packages/issues/546
[#737]: https://github.com/gotgenes/pi-packages/issues/737
[#916]: https://github.com/gotgenes/pi-packages/issues/916
[#944]: https://github.com/gotgenes/pi-packages/issues/944
[#950]: https://github.com/gotgenes/pi-packages/issues/950
