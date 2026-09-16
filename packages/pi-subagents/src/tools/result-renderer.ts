/**
 * result-renderer.ts — Pure per-status rendering functions for Agent tool results.
 *
 * All functions are stateless: they receive AgentDetails and a Theme, returning
 * formatted strings. No SDK types, no timers, no side effects.
 * Consumed by the renderResult hook in agent-tool.ts.
 */

import type { SubagentStatus } from "#src/lifecycle/subagent-state";
import type { AgentDetails, Theme } from "#src/ui/display";
import { formatMs, formatTurns } from "#src/ui/display";
import { GLYPHS, SPINNER } from "#src/ui/glyphs";

// ---- Dispatcher ----

/** Dispatch to the per-status renderer based on details.status and isPartial. */
export function renderAgentResult(
	details: AgentDetails,
	resultText: string,
	expanded: boolean,
	isPartial: boolean,
	theme: Theme,
): string {
	if (isPartial || details.status === "running") return renderRunning(details, theme);
	if (details.status === "background") return renderBackground(details, theme);
	// A concrete failure outranks a preserved lifecycle status such as stopped.
	if (details.error != null) return renderFailed(details, theme);
	if (details.status === "completed" || details.status === "steered")
		return renderCompleted(details, resultText, expanded, theme);
	if (details.status === "stopped") return renderStopped(details, theme);
	return renderFailed(details, theme);
}

// ---- Per-status renderers ----

/** Render running/partial status: spinner + stats + activity line. */
export function renderRunning(details: AgentDetails, theme: Theme): string {
	const frame = SPINNER[details.spinnerFrame ?? 0];
	const s = renderStats(details, theme);
	let line = theme.fg("accent", frame) + (s ? " " + s : "");
	line += "\n" + theme.fg("dim", `  ${GLYPHS.subLine}  ${details.activity ?? "thinking\u2026"}`);
	return line;
}

/** Render background launch status. */
export function renderBackground(details: AgentDetails, theme: Theme): string {
	return theme.fg("dim", `  ${GLYPHS.subLine}  Running in background (ID: ${details.agentId})`);
}

/** Render completed or steered status with optional expanded result text. */
export function renderCompleted(
	details: AgentDetails,
	resultText: string,
	expanded: boolean,
	theme: Theme,
): string {
	const duration = formatMs(details.durationMs);
	const isSteered = details.status === "steered";
	const icon = renderStatusIcon(isSteered ? "steered" : "completed", theme);
	const s = renderStats(details, theme);
	let line = icon + (s ? " " + s : "");
	line += " " + theme.fg("dim", "\u00B7") + " " + theme.fg("dim", duration);

	const doneText = isSteered ? "Wrapped up (turn limit)" : "Done";
	const doneLine = theme.fg("dim", `  ${GLYPHS.subLine}  ${doneText}${idSuffix(details)}`);

	if (expanded && resultText) {
		const lines = resultText.split("\n").slice(0, 50);
		for (const l of lines) {
			line += "\n" + theme.fg("dim", `  ${l}`);
		}
		if (resultText.split("\n").length > 50) {
			line +=
				"\n" +
				theme.fg(
					"muted",
					"  ... (use get_subagent_result with verbose for full output)",
				);
		}
	}
	// Keep every terminal result referenceable in both collapsed and expanded views.
	line += "\n" + doneLine;
	return line;
}

/** Render stopped status: dim stop icon + stats + "Stopped". */
export function renderStopped(details: AgentDetails, theme: Theme): string {
	const s = renderStats(details, theme);
	let line = renderStatusIcon("stopped", theme) + (s ? " " + s : "");
	line += "\n" + theme.fg("dim", `  ${GLYPHS.subLine}  Stopped${idSuffix(details)}`);
	return line;
}

/** Render a concrete failure or hard turn-limit abort with its most specific message. */
export function renderFailed(details: AgentDetails, theme: Theme): string {
	const s = renderStats(details, theme);
	const hasError = details.error != null || details.status === "error";
	let line = renderStatusIcon(hasError ? "error" : "aborted", theme) + (s ? " " + s : "");

	if (hasError) {
		line +=
			"\n" +
			theme.fg("error", `  ${GLYPHS.subLine}  Error: ${details.error ?? "unknown"}${idSuffix(details)}`);
	} else {
		line +=
			"\n" +
			theme.fg("warning", `  ${GLYPHS.subLine}  Aborted (max turns exceeded)${idSuffix(details)}`);
	}
	return line;
}

// ---- Shared helpers ----

/** " (ID: …)" suffix for terminal result sub-lines; empty when the ID is unknown. */
function idSuffix(details: AgentDetails): string {
	return details.agentId ? ` (ID: ${details.agentId})` : "";
}

/**
 * The themed status glyph for a settled or pending agent.
 *
 * Exhaustive over `SubagentStatus`, so a status added later fails to compile
 * here rather than falling through to an unmarked icon. Shared with
 * `get-result-renderer.ts`, which draws the same vocabulary for the same enum.
 */
export function renderStatusIcon(status: SubagentStatus, theme: Theme): string {
	switch (status) {
		case "completed":
			return theme.fg("success", GLYPHS.success);
		case "steered":
			return theme.fg("warning", GLYPHS.success);
		case "stopped":
			return theme.fg("dim", GLYPHS.stopped);
		case "error":
		case "aborted":
			return theme.fg("error", GLYPHS.failure);
		case "queued":
			return theme.fg("dim", GLYPHS.queued);
		case "running":
			return theme.fg("dim", GLYPHS.streaming);
	}
}

/**
 * Build the stats string: "haiku · thinking: high · ↻5≤30 · 3 tool uses · 33.8k token".
 * Returns an empty string when all fields are absent or zero.
 */
export function renderStats(details: AgentDetails, theme: Theme): string {
	const parts: string[] = [];
	if (details.modelName) parts.push(details.modelName);
	if (details.tags) parts.push(...details.tags);
	if (details.turnCount != null && details.turnCount > 0) {
		parts.push(formatTurns(details.turnCount, details.maxTurns));
	}
	if (details.toolUses > 0)
		parts.push(`${details.toolUses} tool use${details.toolUses === 1 ? "" : "s"}`);
	if (details.tokens) parts.push(details.tokens);
	return parts
		.map((p) => theme.fg("dim", p))
		.join(" " + theme.fg("dim", "\u00B7") + " ");
}
