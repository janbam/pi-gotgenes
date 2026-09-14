/**
 * workspace.ts — The single generative extension seam (ADR 0002, Phase 16 Step 2).
 *
 * "Where does a child run, and what brackets the run?" is a strategy (git
 * worktree, container, tmpdir, remote sandbox), not core behavior. The core
 * needs only a working directory plus suspend/restore/dispose hooks; the
 * default — the parent's cwd, with no setup/teardown — is always correct.
 *
 * Unlike the observational lifecycle events in child-lifecycle.ts, this is a
 * *generative* seam: a registered provider returns a value the core consumes
 * at run-start or resume. The core persists opaque provider JSON and has no
 * knowledge of git or worktrees.
 */

import type { JsonValue } from "@earendil-works/pi-coding-agent";
import type { SubagentStatus } from "#src/lifecycle/subagent";
import type { SubagentType } from "#src/types";

/** Context the core hands a provider when a child run starts. */
export interface WorkspacePrepareContext {
  agentId: string;
  agentType: SubagentType;
  baseCwd: string;
}

/** Outcome the core reports to a workspace when the run ends. */
export interface WorkspaceDisposeOutcome {
  status: SubagentStatus;
  description: string;
}

/** What dispose may hand back for the core to fold into the child result. */
export interface WorkspaceDisposeResult {
  /** Appended verbatim to the child's result text — the provider owns the wording. */
  resultAddendum?: string;
}

/** Durable provider state returned while releasing the live workspace. */
export interface WorkspaceSuspendResult extends WorkspaceDisposeResult {
  /** Opaque JSON from which this provider can reconstruct the workspace. */
  state: JsonValue;
}

/** Stable failure classification consumed by the durable resume path. */
export interface WorkspaceRestoreFailure extends Error {
  readonly reason: "unavailable" | "incompatible";
}

/** Default restore failure implementation available to core and providers. */
export class WorkspaceRestoreError extends Error implements WorkspaceRestoreFailure {
  constructor(
    readonly reason: "unavailable" | "incompatible",
    message: string,
    options?: ErrorOptions,
  ) {
    super(message, options);
    this.name = "WorkspaceRestoreError";
  }
}

/** A prepared working directory plus its bracketed teardown. Born complete. */
export interface Workspace {
  /** The working directory — already exists when the workspace is handed back. */
  readonly cwd: string;
  /** Capture enough provider-owned JSON to recover this still-live workspace. */
  snapshot(): JsonValue;
  /** Release live resources while retaining a durable reconstruction checkpoint. */
  suspend(outcome: WorkspaceDisposeOutcome): WorkspaceSuspendResult;
  /** Permanently tear down this workspace after its durable handle is deleted. */
  dispose(outcome: WorkspaceDisposeOutcome): WorkspaceDisposeResult | undefined;
}

/** The single generative seam: supplies a child's workspace. */
export interface WorkspaceProvider {
  /** Stable identity guarding provider-owned persisted state. */
  readonly id: string;
  prepare(ctx: WorkspacePrepareContext): Promise<Workspace | undefined>;
  /** Reconstruct one workspace from JSON previously emitted by this provider. */
  restore(ctx: WorkspacePrepareContext, state: JsonValue): Promise<Workspace>;
}
