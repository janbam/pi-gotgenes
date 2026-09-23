---
issue: 937
issue_title: "Split AGENTS.md into principles, environment, and an index; move rule lists into topic skills"
---

# Retro: #937 — Split AGENTS.md into principles, environment, and an index; move rule lists into topic skills

## Stage: Planning (2026-09-18T04:09:26Z)

### Session summary

Measured the always-loaded baseline (8,499 words: `AGENTS.md` 8,045 + 454 in descriptions) and each `AGENTS.md` section's word count, mapped every section to a destination, and gated the open design choices.
Wrote `docs/plans/0937-split-agents-md-into-topic-skills.md`: eight new topic skills (the issue's seven plus `worktrees`), two existing-skill absorptions, a rewritten `AGENTS.md` skeleton with a 1,500–1,700-word band, a sharpened admission test, a template load matrix, and `/audit-agent-docs` changes to apply `offload`.
Filed #942 for the 19 package-skill `offload` rows and recorded it out of scope in both open phases (pi-permission-system Phase 15, pi-subagents Phase 22).

### Observations

- **Operator decisions at the gate**: `worktrees` becomes an eighth skill rather than riding `git-workflow`; templates *do* name the topic skills in their `## Load skills` lists — the issue's deferral of "template-driven loading" was about extension-driven deterministic injection, not the prose lists templates already carry; the 19 package `offload` rows go to a dedicated issue (#942); the 11 non-package skill descriptions are rewritten here as trigger conditions.
- **The verification instrument is a moved-line check, not a review.**
  Every prose line of the pre-split `AGENTS.md` (352 today) must survive verbatim in `AGENTS.md` or a skill, or be on the plan's deliberately-dropped list; a duplicate check catches copies.
  This depends on moving rules *unreworded*, which the plan makes a rule of the move.
- **A dry-run overturned a verify criterion.**
  The plan first proposed `next-version.sh no-such-pkg` to exercise the "see AGENTS.md" error text; the unknown-package check fires first, and every package is tagged, so the no-tag branch is unreachable by any real name.
  Replaced with a text grep.
- **The issue's "sharpen the first question" lands in the second question's slot.**
  Question 1 as written already sends a passage nowhere; the sharpening ("needed before any workflow step has run, or an environment fact no model could infer") is the destination test, which is question 2.
  Recorded in the plan so the build session does not re-derive it.
- **Tidy-First assessment skipped**: no `src/` or `test/` files are touched.
- Not breaking; nothing under `packages/` changes, so `/ship` releases nothing.

#### Deferred tidyings

None — the assessor was not dispatched (docs-only change).

## Stage: Implementation — Build (2026-09-18T04:34:13Z)

### Session summary

Executed all 13 plan steps as 13 `docs:` commits (`b649d3ea`..
`b4a96011`): eight new topic skills, two existing-skill absorptions, the `AGENTS.md` rewrite, 11 description rewrites, the template load lists, and the `/audit-agent-docs` `offload`/`moved` verdicts.
Always-loaded went from `agentsMd=8045 descriptions=454 total=8499` to `agentsMd=1848 descriptions=536 total=2384` (measured with `scripts/agent-docs/always-loaded.mjs`), a 72% cut.
Pre-completion reviewer: WARN (two non-blocking findings, below).

### Observations

- **The moved-line check earned its place.**
  Run after every move against the pre-split SHA, it caught nothing lost in eight moves; at the rewrite step it printed exactly the plan's deliberately-dropped list (23 lines: the old admission-test question 2, the four Workflow bullets folded into principle 6, the session-naming table, the four index stubs) plus three label lines (`Key properties:`, `Convergence…:`, `Guardrails:`) that became headings in `worktrees` and one reflow.
  The reviewer re-derived it with its own script and reached the same set.
- **One anticipated reflow happened.**
  `pi-autoformat` rewrote `*around*` as `_around_` when the Pi-source paragraph landed in `code-design`, whose emphasis style is underscores.
  Accepted as a formatter-owned rewrite; the plan's risk list named this class.
- **Cutting moved lines from `AGENTS.md` by exact-line match was safe only for unindented prose.**
  Lines that the destination re-shaped — bulletized autoformat quirks in `markdown-conventions`, fenced retro-format example lines — had to be removed by hand; a match-and-delete script that ignored fences would have half-deleted the example block.
- **Reviewer WARN 1 — `agentsMd` is 1,848, above the plan's 1,500–1,700 estimate.**
  The plan declared this a finding to report, not a target to cut to; the reviewer's per-section count puts the overrun in `## Working an issue` (375 words, lifecycle kept verbatim) and the index table (292), offset by principles coming in under.
  Left as is; the next `/audit-agent-docs` run holds the lifecycle section to the sharpened question 2.
- **Reviewer WARN 2 — one sentence in `clarification-gates` is new, not moved**: "Label every number in an option as measured or estimated; measure when the command runs in under a minute."
  Added because the skill's `description:` promises it and the moved body did not carry it; `plan-issue.md` line ~134 states the same rule for its own predicted-effect table.
  Left both: the template's is step-specific, the skill's is the general rule.
- **Deviation from the plan's roster**: the four `### Workflow` bullets became principle 6 rather than moving to a skill, and the `delegation` skill carries the pre-completion-reviewer and craftsmanship paragraphs verbatim (the plan had them collapsing to index rows) — moving them whole was cheaper than proving a summary lossless, and they are loaded only on demand now.
- The `Retro file format` example block now lives in `markdown-conventions`; each template still carries its own stage-entry skeleton, so nothing reads the block at run time.
- Operator follow-through: a fresh `pi` session is needed to see the eight new skills in `<available_skills>`; this session cannot.

## Stage: Final Retrospective (2026-09-18T04:48:51Z)

### Session summary

Planning, build, ship, and this retrospective all ran in one process: issue #937 went from a proposal to 13 landed `docs:` commits plus the plan and three stage notes, closed with CI green on `8403bb0a` and nothing released (no `packages/` file in range).
The always-loaded corpus went from 8,499 words to 2,384 — a 72% cut against the 8.8% the first `/audit-agent-docs` pass managed on its own, because this change built the destinations that pass had no place to send content to.
One follow-up was filed and dispositioned during planning (#942, the 19 package-skill `offload` rows).

### Observations

#### What went well

- **A prose refactor got a mechanical invariant.**
  Prose has no test suite, so the plan manufactured one: every non-blank, non-heading, outside-fence line of the pre-split `AGENTS.md` must appear verbatim in the post-split corpus or be on a recorded dropped list.
  Run after each of the eight moves and again after the rewrite, it reported nothing unexpected; the `pre-completion-reviewer` wrote its own version and reached the same 27-line set.
  That is the first time in this repo a documentation change has been verified rather than reviewed, and it is what made a 6,200-word relocation safe to do in one session.
- **The 13-step split kept every move independently reviewable.**
  Each skill's creation and its `AGENTS.md` excision landed in one commit, so `git show <sha>` is checkable on its own and no intermediate state had content duplicated or orphaned.
  Zero rework across 13 commits.
- **Bundling the planning gate's four decisions paid off twice.**
  Two of the four answers carried operator notes that changed the plan's scope (the "template-driven loading" deferral meant extension-driven injection, not the prose `## Load skills` lists; the package `offload` rows wanted their own issue) — neither would have surfaced from a narrower question.
- **Flagging an ambiguity instead of resolving it was the right call.**
  The issue's "I am deferring template-driven loading" was genuinely two-readable, and guessing would have either under-delivered (no template pointers at all) or over-delivered (an extension dependency the operator had not committed to).

#### What caused friction (agent side)

- `missing-context` — the planning gate offered "file a dedicated issue" and "do it here" for the 19 package `offload` rows and the 11 skill descriptions without first checking whether an issue already tracked either.
  The operator's answers both came back as questions ("We have a dedicated issue for this, no?
  If not, maybe we do it here."), which cost a second `ask_user` round after two `gh issue list` searches that should have preceded the first.
  Impact: one extra gate round; no rework.
- `instruction-violation` (self-identified, from the error) — ran `echo ======` in a compound command; zsh's `equals` expansion aborted with `zsh:1: ===== not found` and discarded the rest of the chain.
  `AGENTS.md` stated exactly this rule and it was in loaded context.
  Impact: one failed tool call, re-run with `echo ---`.
- `other` — the plan's deliberately-dropped list was four lines short.
  Three label lines (`Key properties:`, `Convergence (the two-session ship flow):`, `Guardrails:`) became headings in the `worktrees` skill and one emphasis marker was reflowed by `pi-autoformat`, so the moved-line check reported them as missing after commits that were in fact correct.
  Fixed by adding an accepted-list to the check mid-flight rather than by amending the plan.
  Impact: one check amendment; the four additions are recorded in the Build stage note instead.
- `other` — the `AGENTS.md` word budget was estimated per section before anything was drafted, and landed 148 words over the top of the 1,500–1,700 band (1,848).
  The overrun is in the two sections whose size depends on how many things they enumerate — the lifecycle narrative and the index table — which is exactly where a pre-drafting estimate is weakest.
  Impact: none; the plan had pre-committed to reporting an out-of-band number rather than cutting to it, which is why this did not become a late scope fight.
- `other` — wrote each new skill's `description:` before its body, and one description promised a rule ("label every number measured or estimated") the moved body did not carry, so a sentence was added that was not moved from anywhere.
  The `pre-completion-reviewer` caught it as WARN 2.
  Impact: one non-blocking WARN; the sentence was kept deliberately, but it is content that entered by drafting order rather than by decision.

#### What caused friction (user side)

- The two gate answers that arrived as questions were the highest-value corrections in the session, and both were about **backlog state** the operator knew and the agent had not queried.
  Opportunity: a one-line "check whether an issue already covers each deferral candidate before offering it as an option" in the planning gate would have moved that knowledge to the agent's side.
  The notes mechanism worked well as a low-friction correction channel — it redirected scope without rejecting the gate.

### Diagnostic details

- **Model-performance correlation** — verified from the inline `[provider/model]` labels: `/ship`'s 13 mechanical steps ran on `anthropic/claude-sonnet-5` with no deviation, and this retrospective on `anthropic/claude-opus-5`.
  The one subagent dispatch was the `pre-completion-reviewer` on its frontmatter model (`anthropic/claude-sonnet-5`), which re-derived the moved-line and duplicate invariants with its own scripts and independently measured the always-loaded numbers — appropriate for a verification-heavy pass with no design judgment in it.
  Planning and build attribution was **not** re-derived: `read_session` takes only `limit`, so reaching those turns re-renders the whole `/ship` and `/retro` template tail, and the cheap alternative (a `types: ["model_change"]` read) is the unreliable one the lens explicitly warns against.
  That is the second retro in a row to hit this — #940 is open for it.
- **Escalation-delay tracking** — no `rabbit-hole` points; the longest run on a single failure was one tool call (the zsh `=` expansion).
- **Unused-tool detection** — the `missing-context` point needed no subagent, only two `gh issue list --search` calls before the gate rather than after it.
- **Feedback-loop gap analysis** — verification ran incrementally throughout: `pnpm exec rumdl check` plus the moved-line check after every one of the 13 steps, a cache-cleared `pnpm run lint` at the rewrite step and again at the end, and `pnpm fallow dead-code` at the ship gate.
  No gap.

### Changes made

1. `.pi/prompts/audit-agent-docs.md` — Step 6 gains item 4: when a run applied any `offload` row, verify the whole corpus with the moved-line script rather than only the per-row greps, since a per-row grep cannot see a line dropped rather than mis-moved.
   The snippet reads the pre-prune source from `HEAD` (Step 5's edits are uncommitted at that point) and was dry-run in a scratch repo in both directions — silent when every line survives, naming the line when one is dropped.
   Items 4 and 5 renumbered to 5 and 6.
2. No `AGENTS.md` change.
   The file was cut 77% in this same session; both retro proposals were step-local and fail the admission test's second question, so the one that landed went to the template instead.
3. Declined: a one-line "description follows the body" rule for `/audit-agent-docs` Step 5 (operator decision — the WARN it addresses was non-blocking and the sentence it produced was kept deliberately).
