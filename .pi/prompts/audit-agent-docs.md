---
description: Measure the agent documentation, classify every passage against the admission test, gate the inventory, and apply the approved cuts
model: anthropic/claude-opus-5-5
---

# Audit the agent documentation

No arguments.

Your job is to hold `AGENTS.md` and every `.pi/skills/*/SKILL.md` to the `## Admission test` in `AGENTS.md`, and to land the cuts it justifies.
The test is short; read it now, before anything else.
This template is periodic and manually triggered — nothing runs it on a schedule — and it is the counterweight to `/retro`, which is where those files grow.

You will produce two commits: a dated inventory and its measurements, then the prune the inventory authorized.
The inventory is the record; the prune is reviewable against it.

## Sync with remote (do this first)

1. Run `git pull --ff-only`.
2. If it fails for **any** reason — uncommitted changes, divergent history, merge conflict, network error, detached HEAD — stop immediately and report the failure.
   Do not stash, rebase, force, or otherwise resolve.
3. Only proceed on a clean fast-forward (or `Already up to date.`).
4. Refuse to run on any branch but `main`.
   The prune is applied on the current branch, and the current branch is meant to be trunk.

Call `set_session_name` with `Agent-doc audit — <YYYY-MM-DD>`.

## Load skills

- `markdown-conventions` — for the inventory and for every edit you will make to a skill.
- `clarification-gates` — for the Step 4 gate.
- `github-voice` is **not** needed; this template writes no GitHub-facing text.

## Step 1: Measure

Create `docs/agent-docs-audit/<YYYY-MM-DD>/` and write the three measurements into it:

```bash
D=docs/agent-docs-audit/$(date -u +%F)
mkdir -p "$D"
node scripts/agent-docs/doc-growth.mjs > "$D/doc-growth.csv"
node scripts/agent-docs/model-usage.mjs > "$D/model-usage.csv"
node scripts/agent-docs/always-loaded.mjs | tee "$D/always-loaded-before.txt"
```

`doc-growth.csv` reproduces from git at any later date; `model-usage.csv` reads a machine-local, prunable session store and is committed precisely because it cannot be re-derived.
The `always-loaded` line is the number this audit is measured against: write it into the inventory header in Step 3 as the **before**.

Then read the prior audit, if any: `ls -1d docs/agent-docs-audit/*/ | tail -2` and open the previous directory's `inventory.md`.
Carry forward every row it marked `offload` or `keep (revisit)` — those are the verdicts it deferred, and this audit answers for them.
A carried-forward `offload` row is re-verdicted this run: `offload → <dest>` again (and applied in Step 5 when the destination file now exists), or `moved (<sha>)` when a change since the prior audit already relocated the passage — `git log -S'<distinctive phrase>'` names the commit.

## Step 2: Classify

Walk `AGENTS.md` section by section, then each `.pi/skills/*/SKILL.md`.
A passage is a sentence or a tightly bound group of sentences making one claim; in these files a sentence is a line.

Give every passage exactly one verdict:

| Verdict            | Meaning                                                                                    | Applied by this command                                                                                                                                                                             |
| ------------------ | ------------------------------------------------------------------------------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `keep`             | Passes all three admission questions                                                       | No edit                                                                                                                                                                                             |
| `offload → <dest>` | Real, but fails the second question: it fires at a trigger a skill's description names     | Yes when `<dest>` exists — cut the passage from the source and append it to the destination under a fitting heading; otherwise no edit, and the inventory names the destination that needs creating |
| `moved (<sha>)`    | A carried-forward `offload` whose passage a change since the prior audit already relocated | No edit; closes the row                                                                                                                                                                             |
| `compress`         | The rule stands; the incident attached to it does not                                      | Yes — rewrite the line to the rule alone                                                                                                                                                            |
| `delete`           | Fails the first question, or is superseded, duplicated, or stale                           | Yes — remove the line                                                                                                                                                                               |

Read the admission test's recurrence heuristic as it is written: a rule with no retro recurrence since 2026-07-20 is a *candidate*, and survivorship is the confound.
When you mark such a rule `delete`, the rationale column says the rule was checked against the retros (`grep -rln '<distinctive phrase>' docs/retro packages/*/docs/retro`) and names the last one that mentions it.

Two shapes deserve a stated rule rather than case-by-case judgment:

- **A `(Refs #N)` on a `compress` line.**
  It survives only when the issue encodes a constraint a reader may need to trace — a lint-guarded boundary, an ADR, a structural invariant.
  Provenance alone is dropped; git log has it.
- **A section that is retro spillover.**
  A skill section that reads as a session's debugging narrative rather than as package context (`package-pi-permission-system`'s `## Debugging`, 2,571 words at the first audit) is one `offload → docs/retro` row for the whole section, not a row per line.

`package-pi-permission-system` is a third of the skill corpus.
Walk it like the rest, and give it its own summary line in the inventory so its share of the cuts is visible.

## Step 3: Write the inventory

Write `docs/agent-docs-audit/<date>/inventory.md`:

````markdown
---
audit: <YYYY-MM-DD>
---

# Agent-doc audit — <YYYY-MM-DD>

Always loaded before: <total> words (AGENTS.md <n> + skill descriptions <n>).
Always loaded after: _filled in Step 6_.

## Summary

| File | Passages | keep | offload | compress | delete |
| --- | --- | --- | --- | --- | --- |
| AGENTS.md | … | … | … | … | … |
| .pi/skills/package-pi-permission-system/SKILL.md | … | … | … | … | … |
| all other skills | … | … | … | … | … |

## Assessment

_Filled in Step 6._

## Inventory

| File | Section | Passage | Verdict | Rationale |
| --- | --- | --- | --- | --- |
| AGENTS.md | Commits | "Do not gate a commit…" | compress | rule stands; drop the #885 story |
| AGENTS.md | Architecture-doc conventions | "The residual recorded for #821…" | delete | story; the preceding lines are the rule |
| .pi/skills/package-pi-permission-system/SKILL.md | Debugging | whole section | offload → docs/retro | retro spillover, not package context |
````

The `Passage` cell is the first few words, enough to find the line with `grep -n`; the `Rationale` is one clause.
A `keep` row still gets a rationale when the passage looked cuttable — that is the record of why it stayed.

Lint it before the gate: `pnpm exec rumdl check docs/agent-docs-audit/<date>/inventory.md`.

## Step 4: Gate (hard)

Put the **whole inventory** to the operator in one `ask_user` pass, with the summary table in the message and the file path for the full list.
Offer exactly two options: apply the inventory as written, or stop so the operator edits `inventory.md` by hand — after which you re-read it and re-gate.
No per-passage round trips.

Do not edit `AGENTS.md` or any skill before this gate returns "apply".

## Step 5: Apply

For every `delete`, `compress`, and destination-exists `offload` row, in file order:

1. `grep -n` the passage to find its current line — line numbers move as you cut, so never carry one forward.
2. Re-read the surrounding region before each `Edit`.
   `pi-autoformat` reflows the file after every edit, so an `oldText` built from what you wrote a moment ago can fail to match.
3. `delete`: remove the line.
   If it was the only sentence in a paragraph, remove the now-empty paragraph too; if it was the only content under a heading, remove the heading.
4. `compress`: replace the line with the rule alone, keeping a `(Refs #N)` only where the inventory's rationale says the citation encodes a constraint.
5. `offload` with an existing destination: cut the passage from the source and append it verbatim to the destination under the heading that fits (or a new one); a `(Refs #N)` moves with it under the same rule as `compress`.
   A passage that reads oddly out of its old context gets a heading, not a rewrite — the verification in Step 6 greps for the moved text.

`keep`, `moved`, and destination-missing `offload` rows are not applied.
A destination that does not exist is a design choice for a separate change; the inventory has named it, and the next audit closes the row as `moved` once that change lands.

## Step 6: Verify and commit

1. Clear the markdown-lint cache and lint from the root — a deleted heading can orphan a cross-file link that the cache would hide:

   ```bash
   find .rumdl_cache -type f -delete
   pnpm run lint
   ```

2. Re-measure and write the number into the inventory header's **after** line:

   ```bash
   node scripts/agent-docs/always-loaded.mjs | tee "$D/always-loaded-after.txt"
   ```

3. Confirm every applied row landed: for each `delete`, `grep -c '<passage>'` on its file returns 0; for each `compress`, the rule's distinctive phrase is still present and the incident's is not; for each applied `offload`, the distinctive phrase is absent from the source and present in the destination.
4. When the run applied any `offload` row, verify the **corpus** as well — a per-row grep cannot see a line dropped rather than mis-moved:

   ````bash
   # Step 5's edits are still uncommitted here, so HEAD is the pre-prune tree.
   git show "HEAD:<source>" \
     | awk 'BEGIN{f=0} /^```/{f=!f; next} f{next} /^\s*$/{next} /^#/{next} {print}' \
     | while IFS= read -r l; do
         grep -qF -- "$l" <destination-files> || printf 'MISSING: %s\n' "$l"
       done
   ````

   Every line it prints must be a recorded `delete`/`compress` target, a heading the destination re-shaped, or a `pi-autoformat` reflow; anything else is a lost line (Refs #937).
5. Write the inventory's `## Assessment` — the audit's verdict on the admission test, not on the corpus:
   - Which verdict dominated, and what that says about where the growth is.
   - Which admission question did the cutting, and which never fired.
     A question that never fires is disconnected, not satisfied.
   - Any passage kept only because it had nowhere to go; name the destination that does not exist and needs creating.
6. Commit twice:

   ```bash
   git add docs/agent-docs-audit/<date>/
   git commit -m "docs(agent-docs): audit <date>"
   git add AGENTS.md .pi/skills/
   git commit -m "docs: prune agent docs per <date> audit"
   git push
   ```

   The second commit's body names the always-loaded before and after, and the count of `delete`, `compress`, and `offload` rows applied.

## Finally

Report the before and after always-loaded numbers, the row counts by verdict, and the `offload` rows still open (destination missing) — those are the manual follow-through this audit hands to whoever picks them up.
If the after number is not below the before, say so plainly; an audit that cut nothing is a finding about the admission test, not a success.
Report the `## Assessment` too: a cut composed almost entirely of provenance is the same kind of finding, whatever the word count says.
