import { describe, expect, it } from "vitest";

import {
  alwaysLoadedWords,
  skillDescription,
} from "../../scripts/agent-docs/always-loaded.mjs";

function skill(frontmatter) {
  return `---\n${frontmatter}\n---\n\n# Body\n\nThe body is loaded on demand and must not count.\n`;
}

describe("skillDescription", () => {
  it("returns every line of a literal (|) block until the next top-level key", () => {
    const md = skill(
      "name: testing\ndescription: |\n  Vitest mock patterns, TDD planning rules,\n  and general test strategy.\nother: value",
    );
    expect(skillDescription(md)).toBe(
      "Vitest mock patterns, TDD planning rules,\nand general test strategy.",
    );
  });

  it("returns every line of a folded (>-) block until the closing fence", () => {
    const md = skill(
      "name: lifecycle\ndescription: >-\n  Reference for the turn model.\n  Use when designing timing.",
    );
    expect(skillDescription(md)).toBe(
      "Reference for the turn model.\nUse when designing timing.",
    );
  });

  it("returns a single-line description", () => {
    const md = skill("name: x\ndescription: One line, no block.");
    expect(skillDescription(md)).toBe("One line, no block.");
  });

  it("returns an empty string when there is no description key", () => {
    expect(skillDescription(skill("name: x"))).toBe("");
  });

  it("returns an empty string when there is no frontmatter at all", () => {
    expect(skillDescription("# Just a body\n\nwords words\n")).toBe("");
  });
});

describe("alwaysLoadedWords", () => {
  it("sums AGENTS.md and every skill description, reporting each part", () => {
    expect(
      alwaysLoadedWords({
        agentsMd: "one two three",
        skillDescriptions: ["four five", "six", ""],
      }),
    ).toEqual({ agentsMd: 3, descriptions: 3, total: 6 });
  });

  it("reports zeros for an empty corpus", () => {
    expect(alwaysLoadedWords({ agentsMd: "", skillDescriptions: [] })).toEqual({
      agentsMd: 0,
      descriptions: 0,
      total: 0,
    });
  });
});
