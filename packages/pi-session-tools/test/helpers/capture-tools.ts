/**
 * capture-tools.ts — Capture the tool definitions an extension registers.
 *
 * The extension registers its tools through `pi.registerTool`, so a test drives
 * a tool by registering against a stub `ExtensionAPI` and calling the captured
 * definition's `execute` directly.
 */

import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { vi } from "vitest";

/** What a test can drive on a captured tool: its `execute` and its TUI renderers. */
interface CapturedTool {
  execute: (...args: unknown[]) => Promise<unknown>;
  renderCall: (...args: unknown[]) => { render: (width: number) => string[] };
  parameters: { properties: Record<string, { description?: string }> };
}

/** Register the extension's tools against a stub API and return them by name. */
export function captureTools(factory: (pi: ExtensionAPI) => void) {
  const tools = new Map<string, CapturedTool>();
  const pi = {
    registerTool: vi.fn((tool: CapturedTool & { name: string }) => {
      tools.set(tool.name, tool);
    }),
  } as unknown as ExtensionAPI;
  factory(pi);
  return tools;
}
