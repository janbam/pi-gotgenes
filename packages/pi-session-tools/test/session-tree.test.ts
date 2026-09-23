import { describe, expect, it } from "vitest";
import type { TranscriptEntry } from "#src/format-transcript";
import { BRANCH_MARKER_TYPE, resolveBranches } from "#src/session-tree";

/** A session entry reduced to the fields the tree walk reads. */
function node(
  id: string,
  parentId: string | null,
  type = "message",
): TranscriptEntry {
  return { type, id, parentId } as unknown as TranscriptEntry;
}

function omitted(count: number) {
  return { type: BRANCH_MARKER_TYPE, marker: "omitted", count };
}

function begin(count: number) {
  return { type: BRANCH_MARKER_TYPE, marker: "abandoned_begin", count };
}

function end() {
  return { type: BRANCH_MARKER_TYPE, marker: "abandoned_end" };
}

describe("resolveBranches", () => {
  describe("a session with no fork", () => {
    const linear = [node("1", null), node("2", "1"), node("3", "2")];

    it("returns a linear chain unchanged in live mode", () => {
      expect(resolveBranches(linear, { mode: "live" })).toEqual(linear);
    });

    it("returns a linear chain unchanged in all mode", () => {
      expect(resolveBranches(linear, { mode: "all" })).toEqual(linear);
    });

    it("returns an empty array unchanged", () => {
      expect(resolveBranches([], { mode: "live" })).toEqual([]);
    });
  });

  describe("a session with one fork", () => {
    // 1 → 2 → {3, 4}; the file ends on 4, so 3 is abandoned.
    const forked = [
      node("1", null),
      node("2", "1"),
      node("3", "2"),
      node("4", "2"),
    ];

    it("replaces the abandoned run with one omitted marker in live mode", () => {
      expect(resolveBranches(forked, { mode: "live" })).toEqual([
        node("1", null),
        node("2", "1"),
        omitted(1),
        node("4", "2"),
      ]);
    });

    it("brackets the abandoned run in all mode", () => {
      expect(resolveBranches(forked, { mode: "all" })).toEqual([
        node("1", null),
        node("2", "1"),
        begin(1),
        node("3", "2"),
        end(),
        node("4", "2"),
      ]);
    });

    it("counts a multi-entry abandoned run once", () => {
      const entries = [
        node("1", null),
        node("2", "1"),
        node("3", "2"),
        node("4", "3"),
        node("5", "4"),
        node("6", "2"),
      ];
      expect(resolveBranches(entries, { mode: "live" })).toEqual([
        node("1", null),
        node("2", "1"),
        omitted(3),
        node("6", "2"),
      ]);
    });
  });

  describe("a fork nested inside an abandoned branch", () => {
    // 1 → 2 → {3 → {4, 5}, 6}; the live path is 1 → 2 → 6.
    const entries = [
      node("1", null),
      node("2", "1"),
      node("3", "2"),
      node("4", "3"),
      node("5", "3"),
      node("6", "2"),
    ];

    it("folds every off-path entry into the surrounding run", () => {
      expect(resolveBranches(entries, { mode: "live" })).toEqual([
        node("1", null),
        node("2", "1"),
        omitted(3),
        node("6", "2"),
      ]);
    });
  });

  describe("abandoned entries that are not contiguous in file order", () => {
    // Live path 1 → 2 → 4 → 6; entries 3 and 5 hang off abandoned parents.
    const entries = [
      node("1", null),
      node("2", "1"),
      node("3", "2"),
      node("4", "2"),
      node("5", "3"),
      node("6", "4"),
    ];

    it("emits one marker per run rather than one per fork point", () => {
      expect(resolveBranches(entries, { mode: "live" })).toEqual([
        node("1", null),
        node("2", "1"),
        omitted(1),
        node("4", "2"),
        omitted(1),
        node("6", "4"),
      ]);
    });

    it("brackets each run separately in all mode", () => {
      expect(resolveBranches(entries, { mode: "all" })).toEqual([
        node("1", null),
        node("2", "1"),
        begin(1),
        node("3", "2"),
        end(),
        node("4", "2"),
        begin(1),
        node("5", "3"),
        end(),
        node("6", "4"),
      ]);
    });
  });

  describe("an explicit leaf", () => {
    // File order ends on 4, but the caller names 3 as the leaf.
    const entries = [
      node("1", null),
      node("2", "1"),
      node("3", "2"),
      node("4", "2"),
    ];

    it("walks back from the named leaf rather than the last entry", () => {
      expect(resolveBranches(entries, { mode: "live", leafId: "3" })).toEqual([
        node("1", null),
        node("2", "1"),
        node("3", "2"),
        omitted(1),
      ]);
    });

    it("returns entries unchanged when the named leaf is unknown", () => {
      expect(
        resolveBranches(entries, { mode: "live", leafId: "nonexistent" }),
      ).toEqual(entries);
    });

    it("falls back to the last entry when the leaf is null", () => {
      expect(resolveBranches(entries, { mode: "live", leafId: null })).toEqual([
        node("1", null),
        node("2", "1"),
        omitted(1),
        node("4", "2"),
      ]);
    });
  });

  describe("entries that carry no tree structure", () => {
    it("returns entries without ids unchanged", () => {
      const entries = [{ type: "message" }, { type: "compaction" }];
      expect(resolveBranches(entries, { mode: "live" })).toEqual(entries);
    });

    it("returns every entry unchanged when the last entry has no id", () => {
      const entries = [node("1", null), node("2", "1"), { type: "compaction" }];
      expect(resolveBranches(entries, { mode: "live" })).toEqual(entries);
    });

    it("never abandons an entry that has no id", () => {
      const entries = [
        node("1", null),
        node("2", "1"),
        { type: "custom" },
        node("3", "1"),
      ];
      expect(resolveBranches(entries, { mode: "live" })).toEqual([
        node("1", null),
        omitted(1),
        { type: "custom" },
        node("3", "1"),
      ]);
    });
  });

  describe("a tree with more than one root", () => {
    it("marks a disconnected root rather than dropping it silently", () => {
      const entries = [node("1", null), node("2", null), node("3", "1")];
      expect(resolveBranches(entries, { mode: "live" })).toEqual([
        node("1", null),
        omitted(1),
        node("3", "1"),
      ]);
    });

    it("keeps a disconnected root that is itself the leaf", () => {
      const entries = [node("1", null), node("2", "1"), node("3", null)];
      expect(resolveBranches(entries, { mode: "live" })).toEqual([
        omitted(2),
        node("3", null),
      ]);
    });
  });

  describe("a leaf with no descendants of its own", () => {
    it("renders the named island and marks everything else", () => {
      const entries = [node("1", null), node("2", "1"), node("island", null)];
      expect(
        resolveBranches(entries, { mode: "live", leafId: "island" }),
      ).toEqual([omitted(2), node("island", null)]);
    });
  });

  describe("a malformed parent chain", () => {
    it("stops at an entry that is its own parent", () => {
      const entries = [node("1", "1"), node("2", "1"), node("3", "1")];
      expect(resolveBranches(entries, { mode: "live" })).toEqual([
        node("1", "1"),
        omitted(1),
        node("3", "1"),
      ]);
    });

    it("terminates on a cyclic parent chain", () => {
      const entries = [node("1", "3"), node("2", "1"), node("3", "2")];
      expect(resolveBranches(entries, { mode: "live" })).toEqual(entries);
    });

    it("stops at a parent that is missing from the array", () => {
      const entries = [node("2", "1"), node("3", "2")];
      expect(resolveBranches(entries, { mode: "live" })).toEqual(entries);
    });

    it("marks an ancestor stranded above a broken link rather than dropping it", () => {
      // Entry 3's parent is gone, so the walk stops there and entry 1 — a real
      // ancestor — reads as abandoned. It is marked, never silently removed.
      const entries = [node("1", null), node("3", "missing")];
      expect(resolveBranches(entries, { mode: "live" })).toEqual([
        omitted(1),
        node("3", "missing"),
      ]);
    });
  });
});
