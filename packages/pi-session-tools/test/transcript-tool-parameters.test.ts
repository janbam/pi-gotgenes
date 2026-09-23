import { describe, expect, it } from "vitest";
import sessionTools from "#src/index";
import { captureTools } from "#test/helpers/capture-tools";

/**
 * The three transcript tools share one selection pipeline, so they must also
 * share one parameter surface. The other test files call a tool's `execute`
 * directly, which bypasses the declared schema entirely — these are the only
 * assertions that see it.
 */
const TRANSCRIPT_TOOLS = [
  "read_session",
  "read_parent_session",
  "read_session_file",
];

describe("transcript tool parameters", () => {
  describe.each(TRANSCRIPT_TOOLS)("%s", (toolName) => {
    function properties() {
      return captureTools(sessionTools).get(toolName)!.parameters.properties;
    }

    it("declares offset as a non-negative number", () => {
      expect(properties().offset).toMatchObject({
        type: "number",
        minimum: 0,
      });
    });

    it("declares limit as a non-negative number", () => {
      expect(properties().limit).toMatchObject({
        type: "number",
        minimum: 0,
      });
    });

    it("declares elide_user_text as a boolean", () => {
      expect(properties().elide_user_text).toMatchObject({
        type: "boolean",
      });
    });

    it("declares branches as a string", () => {
      expect(properties().branches).toMatchObject({
        type: "string",
      });
    });
  });
});
