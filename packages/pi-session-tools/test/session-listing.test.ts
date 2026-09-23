import { describe, expect, it } from "vitest";
import {
  boundListingPaths,
  DEFAULT_LIST_LIMIT,
  formatListingSummary,
  formatListingText,
} from "#src/session-listing";

const DIR = "/Users/chris/.pi/agent/sessions/--Users-chris-peer--";

const NEWEST_FIRST = ["newest", "second", "third", "oldest"];

describe("boundListingPaths", () => {
  it("keeps the newest paths, in order, when the limit is below the total", () => {
    expect(boundListingPaths(NEWEST_FIRST, 2)).toEqual(["newest", "second"]);
  });

  it("returns every path when the limit equals the total", () => {
    expect(boundListingPaths(NEWEST_FIRST, 4)).toEqual(NEWEST_FIRST);
  });

  it("returns every path when the limit exceeds the total", () => {
    expect(boundListingPaths(NEWEST_FIRST, 100)).toEqual(NEWEST_FIRST);
  });

  it("returns no paths for a limit of zero", () => {
    expect(boundListingPaths(NEWEST_FIRST, 0)).toEqual([]);
  });

  it("returns no paths for a negative limit, rather than dropping the oldest", () => {
    expect(boundListingPaths(NEWEST_FIRST, -2)).toEqual([]);
  });

  it("defaults to the newest ten", () => {
    expect(DEFAULT_LIST_LIMIT).toBe(10);
  });
});

describe("formatListingText", () => {
  it("reports no session files found for an empty listing", () => {
    expect(formatListingText(DIR, [], 0)).toBe(
      `Session directory: ${DIR}\nNo session files found.`,
    );
  });

  it("uses the singular count line for one file", () => {
    expect(formatListingText(DIR, [`${DIR}/a.jsonl`], 1)).toBe(
      `Session directory: ${DIR}\n1 session file, newest first:\n  ${DIR}/a.jsonl`,
    );
  });

  it("uses the plural count line and indents every path", () => {
    expect(
      formatListingText(DIR, [`${DIR}/b.jsonl`, `${DIR}/a.jsonl`], 2),
    ).toBe(
      `Session directory: ${DIR}\n2 session files, newest first:\n  ${DIR}/b.jsonl\n  ${DIR}/a.jsonl`,
    );
  });

  describe("when the paths are a subset of the total", () => {
    it("qualifies the count line with how many are shown", () => {
      expect(formatListingText(DIR, [`${DIR}/b.jsonl`], 608)).toBe(
        `Session directory: ${DIR}\n608 session files, newest first (showing 1):\n  ${DIR}/b.jsonl`,
      );
    });

    it("emits no path lines and no trailing newline when none are shown", () => {
      expect(formatListingText(DIR, [], 608)).toBe(
        `Session directory: ${DIR}\n608 session files, newest first (showing 0):`,
      );
    });
  });
});

describe("formatListingSummary", () => {
  it("uses the singular noun for one file", () => {
    expect(formatListingSummary(DIR, 1, 1)).toBe(`1 session file in ${DIR}`);
  });

  it("uses the plural noun for several files", () => {
    expect(formatListingSummary(DIR, 2, 2)).toBe(`2 session files in ${DIR}`);
  });

  it("reports zero files with the plural noun", () => {
    expect(formatListingSummary(DIR, 0, 0)).toBe(`0 session files in ${DIR}`);
  });

  it("leads with the shown count when the listing is truncated", () => {
    expect(formatListingSummary(DIR, 10, 608)).toBe(
      `10 of 608 session files in ${DIR}`,
    );
  });
});
