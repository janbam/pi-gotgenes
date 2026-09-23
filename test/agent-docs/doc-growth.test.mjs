import { describe, expect, it } from "vitest";

import {
  classify,
  countWords,
  measure,
  snapshotDates,
} from "../../scripts/agent-docs/doc-growth.mjs";

describe("classify", () => {
  describe("current layout (repo root)", () => {
    it.each([
      ["AGENTS.md", "agents_md"],
      [".pi/skills/testing/SKILL.md", "skills"],
      [".pi/prompts/ship.md", "prompts"],
      [".pi/agents/pre-completion-reviewer.md", "subagent_defs"],
    ])("%s → %s", (path, bucket) => {
      expect(classify(path)).toBe(bucket);
    });
  });

  describe("pre-consolidation layout (per package, before mid-May 2026)", () => {
    it.each([
      ["packages/pi-subagents/AGENTS.md", "agents_md"],
      ["packages/pi-github-tools/.pi/skills/testing/SKILL.md", "skills"],
      ["packages/pi-autoformat/.pi/prompts/plan-issue.md", "prompts"],
      ["packages/pi-colgrep/skills/colgrep/SKILL.md", "skills"],
    ])("%s → %s", (path, bucket) => {
      expect(classify(path)).toBe(bucket);
    });
  });

  describe("exclusions", () => {
    it.each([
      [".pi/npm/node_modules/some-pkg/skills/x/SKILL.md"],
      ["node_modules/some-pkg/AGENTS.md"],
    ])("%s is under node_modules", (path) => {
      expect(classify(path)).toBeNull();
    });

    it.each([
      ["README.md"],
      ["docs/plans/0934-audit-and-prune-agent-docs.md"],
      [".pi/prompts/README.txt"],
      [".pi/skills/testing/notes.md"],
      ["packages/pi-subagents/src/agents/foo.md"],
    ])("%s matches no bucket", (path) => {
      expect(classify(path)).toBeNull();
    });
  });
});

describe("countWords", () => {
  it("splits on any whitespace run", () => {
    expect(countWords("one two\n\tthree   four\n")).toBe(4);
  });

  it("counts an empty or whitespace-only text as zero", () => {
    expect(countWords("")).toBe(0);
    expect(countWords("  \n\t ")).toBe(0);
  });
});

describe("snapshotDates", () => {
  const may20 = Date.parse("2026-05-20T12:00:00Z");

  it("steps from since to now in everyDays increments, inclusive of since", () => {
    expect(snapshotDates("2026-05-01", 7, may20)).toEqual([
      "2026-05-01",
      "2026-05-08",
      "2026-05-15",
    ]);
  });

  it("stops at the injected now, not the wall clock", () => {
    expect(snapshotDates("2026-05-18", 1, may20)).toEqual([
      "2026-05-18",
      "2026-05-19",
      "2026-05-20",
    ]);
  });

  it("yields nothing when since is after now", () => {
    expect(snapshotDates("2026-06-01", 7, may20)).toEqual([]);
  });
});

describe("measure", () => {
  /**
   * A git runner that answers ls-tree with a fixed listing and show with the
   * blob for that path, so measure() is exercised without a repository.
   *
   * @param {Record<string, string>} tree path → contents
   */
  function fakeGit(tree) {
    return (args) => {
      if (args[0] === "ls-tree") return `${Object.keys(tree).join("\n")}\n`;
      if (args[0] === "show") {
        const path = args[1].replace(/^[^:]+:\.\//, "");
        return tree[path] ?? "";
      }
      throw new Error(`unexpected git ${args.join(" ")}`);
    };
  }

  it("sums each classified file into its own bucket", () => {
    const run = fakeGit({
      "AGENTS.md": "a b c",
      ".pi/skills/x/SKILL.md": "d e",
      ".pi/skills/y/SKILL.md": "f",
      ".pi/prompts/p.md": "g h i j",
      ".pi/agents/q.md": "k",
      "README.md": "ignored words here",
    });

    expect(measure("abc123", run)).toEqual({
      agents_md: 3,
      skills: 3,
      prompts: 4,
      subagent_defs: 1,
    });
  });

  it("reports zero for a bucket with no files rather than omitting it", () => {
    expect(measure("abc123", fakeGit({ "AGENTS.md": "only" }))).toEqual({
      agents_md: 1,
      skills: 0,
      prompts: 0,
      subagent_defs: 0,
    });
  });

  it("asks git for each classified path at the given sha", () => {
    const calls = [];
    const run = (...call) => {
      calls.push(call);
      return call[0][0] === "ls-tree" ? "AGENTS.md\n" : "x";
    };
    measure("deadbeef", run);
    expect(calls).toEqual([
      [["ls-tree", "-r", "--name-only", "deadbeef"]],
      [["show", "deadbeef:./AGENTS.md"], { allowFailure: true }],
    ]);
  });
});
