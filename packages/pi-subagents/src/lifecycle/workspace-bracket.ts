/**
 * workspace-bracket.ts — Owned prepare/dispose lifecycle for a child workspace.
 *
 * Captures the provider resolver (not the provider itself) so provider
 * resolution stays lazy at run-start. The prepared Workspace is held
 * privately; dispose() centralises the guard and addendum-unwrap so callers
 * never reach through to workspace.dispose().resultAddendum directly.
 *
 * dispose() is idempotent — a workspace can outlive the run that prepared it
 * (a child holding it for a resume), so more than one lifecycle edge may reach
 * for it — and it deliberately does NOT catch errors: the best-effort
 * try/catch belongs at the call site, preserving the per-caller semantics.
 */

import type { PersistedWorkspace } from "#src/lifecycle/subagent-persistence";
import type {
	Workspace,
	WorkspaceDisposeOutcome,
	WorkspacePrepareContext,
	WorkspaceProvider,
} from "#src/lifecycle/workspace";
import { WorkspaceRestoreError } from "#src/lifecycle/workspace";

/** Owns the child workspace lifecycle: prepare at run-start, dispose at run-end. */
export class WorkspaceBracket {
	private prepared?: Workspace;
	private persisted?: PersistedWorkspace;
	private disposedWorkspace = false;

	constructor(
		private readonly resolveProvider: () => WorkspaceProvider | undefined,
		persisted?: PersistedWorkspace,
	) {
		this.persisted = persisted;
	}

	/**
	 * True once a prepared workspace has been torn down — the directory the run
	 * used is gone. False for a bracket that never held one, and false while one
	 * is still held, so it distinguishes "no workspace" from "workspace removed".
	 */
	wasDisposed(): boolean {
		return this.disposedWorkspace;
	}

	/**
	 * Returns true when a workspace provider is currently registered.
	 * Use to guard the `await prepare(...)` call and avoid an unnecessary
	 * microtask boundary in the no-provider path.
	 */
	hasProvider(): boolean {
		return this.resolveProvider() !== undefined;
	}

	/**
	 * Resolve the registered provider and prepare the child workspace.
	 * Returns the workspace's cwd, or undefined when no provider is registered
	 * or the provider resolves to undefined.
	 */
	async prepare(ctx: WorkspacePrepareContext): Promise<string | undefined> {
		const provider = this.resolveProvider();
		if (!provider) return undefined;
		this.prepared = await provider.prepare(ctx);
		if (this.prepared) {
			this.persisted = {
				providerId: provider.id,
				state: this.prepared.snapshot(),
			};
		}
		return this.prepared?.cwd;
	}

	/** Reconstruct a suspended workspace through the provider that created it. */
	async restore(ctx: WorkspacePrepareContext): Promise<string | undefined> {
		const persisted = this.persisted;
		if (!persisted || this.prepared) return this.prepared?.cwd;

		// Persisted state is provider-private; never hand it to an absent or
		// differently identified implementation that might misinterpret it.
		const provider = this.resolveProvider();
		if (provider?.id !== persisted.providerId) {
			throw new WorkspaceRestoreError(
				"incompatible",
				`Workspace provider "${persisted.providerId}" is not registered`,
			);
		}

		try {
			this.prepared = await provider.restore(ctx, persisted.state);
			this.persisted = {
				providerId: provider.id,
				state: this.prepared.snapshot(),
			};
			return this.prepared.cwd;
		} catch (err) {
			if (isWorkspaceRestoreFailure(err)) {
				throw new WorkspaceRestoreError(err.reason, err.message, { cause: err });
			}
			throw new WorkspaceRestoreError(
				"unavailable",
				`Workspace provider "${provider.id}" could not restore the workspace`,
				{ cause: err },
			);
		}
	}

	/** Capture the checkpoint that keeps this workspace reachable across processes. */
	snapshot(): PersistedWorkspace | undefined {
		return this.persisted;
	}

	/** Release live resources but retain the provider checkpoint for a later resume. */
	suspend(outcome: WorkspaceDisposeOutcome): string {
		const workspace = this.prepared;
		if (!workspace) return "";

		const provider = this.resolveProvider();
		if (!provider) {
			throw new WorkspaceRestoreError(
				"incompatible",
				"The active workspace provider was unregistered before suspension",
			);
		}
		const suspended = workspace.suspend(outcome);
		this.prepared = undefined;
		this.persisted = { providerId: provider.id, state: suspended.state };
		return suspended.resultAddendum ?? "";
	}

	/**
	 * Dispose the prepared workspace (if any) and return the result addendum
	 * verbatim. Returns an empty string when no workspace was prepared, when one
	 * was already disposed, or when the workspace returns no addendum.
	 *
	 * The workspace is released and recorded as disposed before it is torn down,
	 * so a provider whose dispose() throws still leaves the bracket reporting a
	 * gone workspace — a failed teardown makes reuse no safer than a clean one.
	 * The throw itself still propagates.
	 */
	dispose(outcome: WorkspaceDisposeOutcome): string {
		const workspace = this.prepared;
		if (!workspace) {
			if (this.persisted) {
				this.persisted = undefined;
				this.disposedWorkspace = true;
			}
			return "";
		}
		this.prepared = undefined;
		this.persisted = undefined;
		this.disposedWorkspace = true;
		return workspace.dispose(outcome)?.resultAddendum ?? "";
	}
}

/** Recognize a provider's stable refusal without sharing its concrete Error class. */
function isWorkspaceRestoreFailure(
	error: unknown,
): error is Error & { reason: "unavailable" | "incompatible" } {
	return error instanceof Error &&
		("reason" in error) &&
		(error.reason === "unavailable" || error.reason === "incompatible");
}
