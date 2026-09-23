#!/usr/bin/env node
// The words a session pays for unconditionally.
//
// Pi loads AGENTS.md into every session. It also loads each skill's
// frontmatter `description:` into every session — that is how the agent knows
// the skill exists — but a skill's body is paid for only when a session reads
// it. So the always-loaded corpus is the root AGENTS.md plus the descriptions,
// and that is the number an admission test for AGENTS.md is measured against.
//
// doc-growth.mjs cannot report this directly: its agents_md bucket matches
// packages/*/AGENTS.md too, which is right for the pre-consolidation history
// (those were real files then) and wrong as an always-loaded figure now (they
// are ~45-word sentinels that fire only from a package subdirectory).
//
// Usage: node scripts/agent-docs/always-loaded.mjs [--root DIR]

import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { countWords } from "./doc-growth.mjs";

/**
 * The `description:` value from a SKILL.md's YAML frontmatter, dedented, or
 * "" when the file has no frontmatter or no description.
 *
 * Handles the three forms the repo uses: a literal block (`|`), a folded
 * block (`>-`), and a single-line value. Block bodies end at the closing
 * `---` or at the next unindented key.
 *
 * @param {string} markdown
 */
export function skillDescription(markdown) {
  const lines = markdown.split("\n");
  if (lines[0] !== "---") return "";

  const close = lines.indexOf("---", 1);
  const frontmatter = close === -1 ? lines.slice(1) : lines.slice(1, close);
  const start = frontmatter.findIndex((line) =>
    line.startsWith("description:"),
  );
  if (start === -1) return "";

  const inline = frontmatter[start].slice("description:".length).trim();
  if (inline !== "" && !/^[|>]/.test(inline)) return inline;

  const body = [];
  for (const line of frontmatter.slice(start + 1)) {
    if (!/^\s/.test(line)) break;
    body.push(line.trim());
  }
  return body.join("\n");
}

/**
 * @param {{ agentsMd: string, skillDescriptions: string[] }} corpus
 */
export function alwaysLoadedWords({ agentsMd, skillDescriptions }) {
  const agentsMdWords = countWords(agentsMd);
  const descriptions = skillDescriptions.reduce(
    (sum, description) => sum + countWords(description),
    0,
  );
  return {
    agentsMd: agentsMdWords,
    descriptions,
    total: agentsMdWords + descriptions,
  };
}

function parseArgs(argv) {
  const options = { root: process.cwd() };
  for (let i = 0; i < argv.length; i += 2) {
    if (argv[i] === "--root") options.root = argv[i + 1];
    else throw new Error(`unknown option: ${argv[i]}`);
  }
  return options;
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const { root } = parseArgs(process.argv.slice(2));
  const skillsDir = path.join(root, ".pi", "skills");
  const skillDescriptions = readdirSync(skillsDir)
    .map((name) => path.join(skillsDir, name, "SKILL.md"))
    .map((file) => skillDescription(readFileSync(file, "utf8")));
  const result = alwaysLoadedWords({
    agentsMd: readFileSync(path.join(root, "AGENTS.md"), "utf8"),
    skillDescriptions,
  });
  process.stdout.write(
    `agentsMd=${result.agentsMd} descriptions=${result.descriptions} total=${result.total}\n`,
  );
}
