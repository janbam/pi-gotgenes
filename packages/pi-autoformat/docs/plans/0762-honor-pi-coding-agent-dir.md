---
issue: 762
issue_title: "pi-autoformat: global config path ignores PI_CODING_AGENT_DIR"
---

# Honor `PI_CODING_AGENT_DIR` for the global config scope

## Release Recommendation

**Release:** ship independently

`@gotgenes/pi-autoformat` has no `docs/architecture/` roadmap, so this issue belongs to no release batch.
The `pkg:pi-permission-system` label on the issue is contextual — `packages/pi-permission-system/docs/architecture/history/phase-14-capability-axis.md:105` already recorded [#762] as out of scope for that package's roadmap, "the body targets `pi-autoformat`'s own config-path resolution".
This is a self-contained `fix:` in one package, so it cuts a release on its own at ship time.

## Problem Statement

`loadAutoformatConfig` resolves the global config scope from a hardcoded `join(homedir(), ".pi", "agent")` (`src/config-loader.ts:61`) rather than from the SDK's `getAgentDir()`, which reads `PI_CODING_AGENT_DIR`.
The production call site — `src/extension.ts:625`, `((cwd: string) => loadAutoformatConfig({ cwd }))` — passes no `agentDir`, so the hardcoded default always wins in production.

With `PI_CODING_AGENT_DIR` set, the global `pi-autoformat/config.json` is never found.
The extension falls back to its built-in defaults, so a configured formatter set, `commandTimeoutMs`, or `shellMutationDetection` block is silently ignored — with no warning, since an absent global config is the normal not-configured state.

This is the same defect, in the same shape, as [#732] in `@gotgenes/pi-permission-model-judge`, fixed there in `079e9a6`.
`@gotgenes/pi-permission-system` (`src/index.ts:56`) and `@gotgenes/pi-colgrep` (`src/extension.ts:59`) both resolve this scope through `getAgentDir()`, so `pi-autoformat` is the outlier.

### Measured reproduction

The consequence was predicted in the issue, not observed.
It is now observed.

A disposable spike (`test/spike-762.test.ts`, written and deleted during planning) drove `createAutoformatExtension` with no injected `loadConfig`, stubbed `PI_CODING_AGENT_DIR` to a temp `agentDir` holding a global config with `commandTimeoutMs: 424242`, injected `createAutoformatter` to capture the `AutoformatConfig` it received, and emitted `session_start` with `ctx.cwd` pointed at an empty temp project.

- Against unfixed `main`: the captured config carried `commandTimeoutMs: 10000` — the built-in default.
  Red.
- With the fix applied: `424242`.
  Green.

The repro runs through the real extension wiring and the real loader; only the autoformatter (the process-spawning collaborator) is stubbed.

## Goals

- The global config scope honors `PI_CODING_AGENT_DIR`, resolving through the SDK's `getAgentDir()` exactly as `pi-permission-system` and `pi-colgrep` do.
- The env read happens once at the extension boundary and is injected downward, leaving `config-loader.ts` free of SDK imports and hidden global reads (`homedir()`, `process.cwd()`).
- The production wiring — not just the loader's default — is covered by a test, since the wiring is where the defect lives.
- `README.md`, `docs/configuration.md`, and the `package-pi-autoformat` skill name the environment variable, which they become entitled to do only once the code honors it.

This change is **not** breaking.
A user with `PI_CODING_AGENT_DIR` set and a config sitting at `~/.pi/agent/extensions/pi-autoformat/config.json` stops having that file read — but the extension was only finding it there by accident, while ignoring the scope the rest of Pi uses.
The commit is `fix:` with the behavior change described in the body, not `fix!:`, matching the classification settled for the identical [#732].

## Non-Goals

- **A warning when the global config is absent.**
  This failure mode is silent by design: an absent global config is the normal not-configured state, and the extension cannot distinguish "not configured" from "configured in a directory we failed to look in".
  [#732]'s plan deferred the same question; it remains deferred and unfiled, because any real fix lives in how Pi reports extension config resolution, not here.
- **`src/touched-files-queue.ts`'s `homedir()` use** (lines 99, 102).
  That expands a leading `~` in agent-reported file paths — user-facing path normalization, not config-scope resolution.
  It is correct as written and is not touched.
- **A shared global-config test fixture across packages.**
  `packages/pi-permission-model-judge/test/extension.test.ts:360` holds a near-identical temp-`agentDir` fixture.
  The duplication is real, but extracting it means editing a second package's tests for a defect in this one.
  Declined by the Tidy-First assessor as scope creep and recorded in the retro's deferred tidyings.
- **`test/config-loader.test.ts`.**
  Predicted unchanged; see Module-Level Changes for the measurement behind that prediction.
- **`docs/plans/0001-initial-implementation-plan.md`** (lines 213, 259 name the global path).
  A historical record of a landed change; not edited.
- **The config layering itself.**
  Two-scope global-then-project merge, project precedence, and the fail-safe degradation on an unreadable file are all unchanged.

## Background

Three modules and one manifest are in scope.

`packages/pi-autoformat/src/config-loader.ts` is a pure library module — no SDK imports, all IO through `node:fs`.
It exports `getGlobalConfigPath(agentDir = defaultAgentDir())` (line 1212) and `loadAutoformatConfig(options?: { cwd?: string; agentDir?: string })` (line 1231), both falling back to module-private defaults that read process globals.

`packages/pi-autoformat/src/extension.ts` is the SDK boundary.
It imports from `@earendil-works/pi-coding-agent` **type-only** today (lines 4–9) and constructs the default `loadConfig` seam at line 624.

`packages/pi-autoformat/package.json` declares no `peerDependencies`.
It is the only one of the nine workspace packages without a `@earendil-works/pi-coding-agent` peer entry — precisely because its SDK import is type-only, so nothing resolves at runtime.

The SDK's `getAgentDir()` reads `process.env.PI_CODING_AGENT_DIR`, tilde-expands it, and otherwise returns `join(homedir(), ".pi", "agent")`.
Verified in the pinned 0.79.1 (`node_modules/@earendil-works/pi-coding-agent/dist/config.js:393`) and unchanged in Pi's current `main` (`../../pi/packages/coding-agent/src/config.ts:528`).
It reads the variable at call time, not at module scope.

The `code-design` skill states that library and utility functions must not read `process.env` or `process.cwd()` internally, and that Pi SDK imports stay out of business-logic modules.
The repo's dominant wiring convention agrees: `pi-permission-system/src/index.ts:56` and `pi-colgrep/src/extension.ts:59` both resolve `getAgentDir()` at the entry point and pass it down, and `pi-permission-system/src/permission-manager.ts:375` carries a comment framing the removal of "the hidden `getAgentDir()` env-read" as the intent.

## Design Overview

Delete `defaultAgentDir()`, make both scope inputs required, and have the extension boundary supply them.

```typescript
// src/config-loader.ts — after
export function getGlobalConfigPath(agentDir: string): string;

export function loadAutoformatConfig(options: {
  cwd: string;
  agentDir: string;
}): LoadConfigResult;
```

The `process.cwd()` default goes with `homedir()` in the same change: they are hidden global reads on adjacent lines of the same function, and the extension already holds the authoritative `cwd` from `ctx.cwd`.

The consumer's call site:

```typescript
// src/extension.ts — createAutoformatExtension
const loadConfig =
  dependencies.loadConfig ??
  ((cwd: string) => loadAutoformatConfig({ cwd, agentDir: getAgentDir() }));
```

Three properties are deliberate.

1. **`getAgentDir()` is called inside the lambda, not hoisted.**
   Hoisting would read the env even when a test injects `loadConfig`, and would freeze the value at extension-construction time.
   Calling it lazily confines the env read to the production path and lets a test use `vi.stubEnv` without `vi.resetModules()` — verified in the spike.
   The cost is one `process.env` read plus a `join` per new-`cwd` session state.
2. **The `AutoformatExtensionDependencies.loadConfig` seam signature is unchanged** — still `(cwd: string) => LoadConfigResult`.
   `agentDir` is a production wiring detail, not something a test varies through the seam, so all 35 existing `createAutoformatExtension` tests are untouched.
3. **The SDK import widens from type-only to a value import**, and `package.json` gains the matching peer entry.

### The new runtime dependency, and why it is safe

This is the one way #762 is not a copy of [#732]: `pi-permission-model-judge` already had a value import and a peer entry, and `pi-autoformat` has neither.

Verified rather than assumed: Pi's extension loader aliases the specifier `@earendil-works/pi-coding-agent` to its own bundled copy — `../../pi/packages/coding-agent/src/core/extensions/loader.ts:66` (virtual-module map, binary mode) and `:122` (jiti alias map, Node mode).
The corroborating observation is that `~/.pi/agent/npm/node_modules/@earendil-works/` contains only `pi-radius` on this machine, while `pi-permission-system`, `pi-colgrep`, and `pi-permission-model-judge` are all installed there and all value-import `getAgentDir` in production today.
The import resolves because the host provides it, not because it is installed.

The peer entry is therefore documentation of the floor rather than a resolution mechanism, and it aligns `pi-autoformat` with the other eight packages:

```json
"peerDependencies": {
  "@earendil-works/pi-coding-agent": ">=0.79.0"
}
```

`>=0.79.0` matches the package's pinned devDependency minor (0.79.1) and the floor `pi-permission-system` already ships with the same `getAgentDir` value import.

### Rejected alternatives

Putting `getAgentDir()` inside `defaultAgentDir()` is a one-line diff and fixes the symptom.
Rejected: it leaves the actual defect — a production call site that supplies no scope — structurally intact and untested, and moves an SDK import and an env read into the one module in this package currently free of both.
It is also the `policy-loader.ts` pattern `pi-permission-system` is migrating away from.

Reading `process.env.PI_CODING_AGENT_DIR` directly in `extension.ts`, keeping the package free of any runtime SDK dependency, was considered and rejected: it reimplements the SDK's tilde expansion and pins this package to a variable name the SDK owns.

### Design review

Run against the `design-review` checklist, since this is a wiring change.

| Check                   | Finding                                                                                          |
| ----------------------- | ------------------------------------------------------------------------------------------------ |
| Dependency width        | `{ cwd, agentDir }` — two fields, both read by `loadAutoformatConfig`. No smell.                 |
| Law of Demeter          | No chained access introduced; `getAgentDir()` is a free function.                                |
| Output arguments        | None; the loader returns a value.                                                                |
| Parameter relay         | `agentDir` travels one hop, boundary → loader, and is consumed there. No intermediary relays it. |
| Repeated discriminators | None introduced.                                                                                 |
| Test mock depth         | The new test injects only `createAutoformatter`; it adds no mock of the loader.                  |

## Module-Level Changes

`packages/pi-autoformat/src/config-loader.ts`:

- Remove `defaultAgentDir()` (lines 61–63).
- Remove `import { homedir } from "node:os";` (line 2) — `homedir` is that import's only binding in this file.
- `getGlobalConfigPath(agentDir: string)` — parameter required, default removed.
- `loadAutoformatConfig(options: { cwd: string; agentDir: string })` — bag and both fields required; the `?? process.cwd()` and `?? defaultAgentDir()` fallbacks deleted.

`packages/pi-autoformat/src/extension.ts`:

- Widen the `@earendil-works/pi-coding-agent` import (lines 4–9) to bring in `getAgentDir` as a value.
  Mixed `import { type ExtensionAPI, …, getAgentDir }` or a second plain import line are both acceptable — no lint rule constrains the choice (the assessor checked `eslint.config.js`).
- Line 624's default `loadConfig` lambda passes `{ cwd, agentDir: getAgentDir() }`.

`packages/pi-autoformat/package.json`:

- Add the `peerDependencies` block above.

`packages/pi-autoformat/test/extension.test.ts`:

- Add a nested `describe("global config scope")` with local `beforeEach`/`afterEach`.
  The file has no hooks today (verified); the nested-`describe`-with-local-scaffolding shape already has a precedent at line 568.

`packages/pi-autoformat/README.md` (line 89) and `packages/pi-autoformat/docs/configuration.md` (line 9):

- The global-path bullet gains the environment variable, following the wording `pi-permission-system/docs/configuration.md:9` already uses: "(respects `PI_CODING_AGENT_DIR`)".

`.pi/skills/package-pi-autoformat/SKILL.md` (line 31):

- Same edit to the Configuration section's global path.
  The skill states the path as prose with no symbol to grep, so the `src/` symbol sweep would not have found it.

Predicted unchanged, with the evidence:

- `packages/pi-autoformat/test/config-loader.test.ts` — all 7 `loadAutoformatConfig(...)` calls already pass `{ cwd, agentDir }` and all 5 `getGlobalConfigPath(...)` calls already pass `agentDir`, so requiring both is a no-op here.
  Measured: the spike ran the full unit suite with the `src/` changes applied and got 307 passing with zero test edits (306 pre-existing plus the spike's own).
- `packages/pi-autoformat/schemas/pi-autoformat.schema.json` — describes config *content*, names no path and no environment variable.
- `packages/pi-autoformat/src/touched-files-queue.ts` — its `homedir()` calls serve `~`-expansion of agent-reported paths, a different concern (see Non-Goals).
- `packages/pi-autoformat/docs/testing.md` — contains no config-path or `agentDir` reference.

Greps behind the file list: `grep -rn 'agentDir|getGlobalConfigPath|loadAutoformatConfig|getAgentDir'` across `packages/pi-autoformat` returns only the files above plus `src/index.ts`'s re-export list (unchanged — the symbol names do not change) and `docs/plans/0016-*.md` (a historical plan).
`grep -rn '~/.pi/agent|homedir'` across the package, `.pi/skills/package-pi-autoformat/`, and the repo's markdown returns the three doc sites above, the two historical-plan lines, `src/touched-files-queue.ts`, and `test/touched-files-queue.test.ts` (which asserts `~`-expansion, not config scope).

## Test Impact Analysis

**What the change enables that was previously untested.**
`createAutoformatExtension` is constructed 35 times in `test/extension.test.ts`, and every one injects `loadConfig`.
The default seam — the exact line carrying the bug — has zero coverage.
The new test is the first to drive `session_start` with no injected `loadConfig`, pinning the production path end to end: env var → `getAgentDir()` → `getGlobalConfigPath` → `readJsonFile` → `validateUserFormatterConfig` → `createFormatterConfig` → the config handed to `createAutoformatter`.

**What becomes redundant.**
Nothing.
The existing extension tests cover status reporting, flush batching, steering messages, event-bus wiring, and config-issue surfacing — all orthogonal to scope resolution.
The `config-loader.test.ts` cases cover merge and validation semantics with explicit scopes and remain exactly as valuable.

**What must stay as-is.**
`test/config-loader.test.ts` in full: it is the layering contract, and it already passes both scopes explicitly, which is the shape this change makes mandatory.

**The false-green hazard, measured at planning time.**
An assertion that the extension merely *loaded something* is unfalsifiable here.
This machine has `PI_CODING_AGENT_DIR` unset and no `~/.pi/agent/extensions/pi-autoformat/` directory at all, so the pre-fix path silently yields built-in defaults rather than an error — a test asserting "a config was loaded" or "`createAutoformatter` was called" passes both before and after.
The mirror hazard is the one [#732] hit: on a machine that *does* have a real global config, a registration-shaped assertion passes pre-fix for the wrong reason.

The assertion must therefore discriminate on config **content** that only the temp scope can supply.
Measured: marker `commandTimeoutMs: 424242` in the temp global config; pre-fix the captured config carried `10000` (the built-in default), post-fix `424242`.
That red is machine-independent — no plausible real home config sets that value, so the test fails pre-fix whether or not a home config exists.

## Invariants at risk

- **Project config overrides global config** (`docs/configuration.md:12`, the package skill's Configuration section).
  Pinned by `test/config-loader.test.ts` "merges global and project config with project precedence", which passes both scopes explicitly and is unaffected by the signature change.
  The new test writes only a global config, so it does not weaken the precedence assertion.
- **A malformed or unreadable config degrades to an issue, never a throw.**
  Pinned by `test/config-loader.test.ts`'s malformed-JSON case, which asserts `issues[0].sourcePath === getGlobalConfigPath(agentDir)`.
  Unchanged: only path *resolution* moves, not the read/validate path.
- **Config issues surface at `session_start` with their `sourcePath`.**
  Pinned by the `reportConfigIssues` tests in `test/extension.test.ts`.
  Untouched — the new test injects `createAutoformatter` only, leaving the default `reportConfigIssues` in place, and its temp global config is valid, so it emits no issues.
- **`config-loader.ts` imports nothing from the Pi SDK and reads no process globals.**
  This invariant is *strengthened*, not risked: `homedir()` and `process.cwd()` both leave the module, and the SDK import lands in `extension.ts`.
- **`pi-autoformat` has no runtime dependency on the Pi SDK.**
  This one is deliberately retired.
  It served the constituency of "a consumer who imports this package's modules outside Pi" — for whom the type-only import meant nothing to resolve.
  That consumer is hypothetical (the package publishes no `main` and no `exports`; `pi.extensions` names `./src/extension.ts`), while the real constituency — a user running the extension under Pi — gets the specifier from Pi's own loader alias.
  Nothing pins this invariant today, and nothing will after: the assertion is recorded here and in the commit body, not in a test.

## TDD Order

1. **Red → Green → Commit: the global scope honors `PI_CODING_AGENT_DIR`.**

   Add `describe("global config scope")` to `test/extension.test.ts`.
   Local `beforeEach`: `mkdtempSync` a root, create an empty project `cwd` and an `agentDir`, `mkdirSync(dirname(getGlobalConfigPath(agentDir)), { recursive: true })`, write a global config with a marker `commandTimeoutMs`, `vi.stubEnv("PI_CODING_AGENT_DIR", agentDir)`.
   Local `afterEach`: `vi.unstubAllEnvs()` and `rmSync(root, { recursive: true, force: true })`.
   The test constructs `createAutoformatExtension` injecting **only** `createAutoformatter` (capturing the `AutoformatConfig` it receives), emits `session_start` with `createContext({ cwd })`, and asserts the captured config's `commandTimeoutMs` is the marker.
   Transplant the fixture shape from `packages/pi-permission-model-judge/test/extension.test.ts:360–417`, which is near-identical.

   Confirm red, then green with all three production edits together — the two `src/` edits and the `package.json` peer entry.
   The signature change and the call-site change must land in one commit: `tsc` rejects a required parameter with no argument.

   Killing mutations, one per claim the step makes:
   - Replace the lambda's `agentDir: getAgentDir()` with `agentDir: join(homedir(), ".pi", "agent")` — the new test must go red (`10000` received, marker expected), and every other test in both files must stay green.
     This is the mutation that pins the *boundary wiring*, which is where the defect lived.
   - Make `getGlobalConfigPath` ignore its parameter and return `join(homedir(), ".pi", "agent", "extensions", …)` — the new test **and** the `config-loader.test.ts` global-config cases must go red.
     This pins the *loader* half; a green here would mean the new test is asserting through a path the loader does not actually use.

   Commit: `fix(pi-autoformat): honor PI_CODING_AGENT_DIR when loading the global config`

   Body: the global scope now resolves through the SDK's `getAgentDir()`, matching `@gotgenes/pi-permission-system` and `@gotgenes/pi-colgrep`; `config-loader.ts` no longer reads `homedir()` or `process.cwd()` behind the caller's back; a user with `PI_CODING_AGENT_DIR` set and a config still at `~/.pi/agent/extensions/pi-autoformat/config.json` must move it to the directory that variable names.
   `Refs #762`.

2. **Commit: document the environment variable.**

   Update the global-path line in `README.md`, `docs/configuration.md`, and `.pi/skills/package-pi-autoformat/SKILL.md` to name `PI_CODING_AGENT_DIR`, following the wording already used in `pi-permission-system/docs/configuration.md:9`.
   This lands after step 1 rather than before: the docs are currently correct, and become wrong only once the code honors the variable.

   Verify with `pnpm --filter @gotgenes/pi-autoformat run lint:md`.
   There is no killing mutation — no test asserts on doc prose, which is why this is a separate `docs:` commit rather than folded into step 1.

   Commit: `docs(pi-autoformat): name PI_CODING_AGENT_DIR in the global config path`

3. **Verify.**

   `pnpm --filter @gotgenes/pi-autoformat run check`, then `run test` (expect 307 passing, up from the measured 306 baseline), then `run lint`, then root `pnpm -r run test` and `pnpm fallow dead-code` — the latter because `defaultAgentDir()` is removed and `homedir` drops out of an import list.

No preparatory `refactor:` step precedes these.
The Tidy-First assessor verified against the real files that `createContext()` already accepts a `cwd` override, that neither test file needs restructuring, and that the nested-`describe` scaffolding shape already has a precedent in this file — so there is no friction to remove first.

## Risks and Mitigations

| Risk                                                                                            | Mitigation                                                                                                                                                                                                                                                                             |
| ----------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| The value import fails to resolve at runtime for an installed consumer                          | Verified against Pi's loader, which aliases the specifier to its own bundled copy (`loader.ts:66`, `:122`), and corroborated by three installed siblings that value-import it while the SDK is absent from `~/.pi/agent/npm/node_modules`. The spike also ran the import under Vitest. |
| The new test false-greens on a machine that has a real global `pi-autoformat` config            | The assertion discriminates on a marker `commandTimeoutMs` no real config would set, not on "a config loaded". Measured red (`10000` vs. `424242`) on this machine, which has no such config; the marker makes the red hold on a machine that does.                                    |
| Env stubbing leaks into sibling tests in the same file                                          | `vi.unstubAllEnvs()` in the nested `afterEach`. `getAgentDir()` reads the env at call time, so no `vi.resetModules()` is needed — verified in the spike.                                                                                                                               |
| A downstream consumer deep-imports `src/config-loader.ts` and breaks on the required parameters | The package publishes no `main` and no `exports` map; `pi.extensions` names `./src/extension.ts` alone. A bare `import "@gotgenes/pi-autoformat"` does not resolve today, so the break is theoretical.                                                                                 |
| A user with `PI_CODING_AGENT_DIR` set silently loses a config that currently works              | Called out in the commit body and the issue close comment. The extension does not warn on an *absent* config by design — that is the normal not-configured state (see Non-Goals).                                                                                                      |
| `getAgentDir()` is invoked per session-state construction rather than once per process          | One `process.env` read plus a `join`, only when `ensureState` sees a new `cwd`. Negligible, and the laziness is what keeps the test hermetic.                                                                                                                                          |
| The `>=0.79.0` peer floor is wrong                                                              | `getAgentDir` is present in the pinned 0.79.1 (`dist/config.d.ts:72`, re-exported from `dist/index.d.ts`) and `pi-permission-system` already ships the same value import under the same floor. `pi-colgrep` ships it under `>=0.75.0`, so `>=0.79.0` is conservative.                  |

## Open Questions

- Should `src/index.ts` stop re-exporting `loadAutoformatConfig` / `getGlobalConfigPath`?
  With no `main` or `exports` map they are not reachable as a public API, so the re-export list is decorative.
  Not filed — it is speculative cleanup, and this plan touches the symbols' signatures, not their visibility.
- Should the absence of a configured-but-unfound global config ever be reported?
  Deferred with the same reasoning as [#732]: the extension cannot distinguish "not configured" from "configured elsewhere", so any real answer lives in how Pi reports extension config resolution.

[#732]: https://github.com/gotgenes/pi-packages/issues/732
[#762]: https://github.com/gotgenes/pi-packages/issues/762
