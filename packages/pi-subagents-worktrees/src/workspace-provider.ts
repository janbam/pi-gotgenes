/**
 * workspace-provider.ts — git worktree implementation of the pi-subagents
 * WorkspaceProvider seam (ADR 0002, Phase 16 Step 3; ADR 0010).
 *
 * The core consults a registered provider for every child run. This provider
 * isolates opted-in children in reconstructible git worktrees. Every terminal
 * turn checkpoints the exact revision and removes the checkout; resume restores
 * the same path before the child transcript reopens. Non-opted-in children run
 * in the parent cwd, while preparation or restoration failures fail closed.
 */

import { tmpdir } from "node:os";
import { basename, isAbsolute, relative, sep } from "node:path";

import type {
  Workspace,
  WorkspaceDisposeOutcome,
  WorkspacePrepareContext,
  WorkspaceProvider,
  WorkspaceSuspendResult,
} from "@gotgenes/pi-subagents";
import type { ActiveWorktrees } from "#src/active-worktrees";
import type { WorktreesConfig } from "#src/config";
import {
  AGENT_WORKTREE_PREFIX,
  cleanupWorktree,
  createWorktree,
  restoreWorktree,
  type WorktreeInfo,
} from "#src/worktree";

const PROVIDER_ID = "@gotgenes/pi-subagents-worktrees";
const STATE_VERSION = 1;
type WorkspaceState = WorkspaceSuspendResult["state"];

/** Validated provider-owned checkpoint persisted by the core. */
interface WorktreeWorkspaceState {
  version: typeof STATE_VERSION;
  repoCwd: string;
  path: string;
  branch: string;
  revision: string;
}

/** Provider-local error carrying the core's structural restore classification. */
class WorktreeRestoreError extends Error {
  constructor(
    readonly reason: "unavailable" | "incompatible",
    message: string,
    options?: ErrorOptions,
  ) {
    super(message, options);
    this.name = "WorktreeRestoreError";
  }
}

/** A live git worktree that can produce a durable checkpoint or be deleted. */
class WorktreeWorkspace implements Workspace {
  constructor(
    private readonly repoCwd: string,
    private readonly info: WorktreeInfo,
    private readonly live: ActiveWorktrees,
  ) {}

  /** The worktree directory — already exists when this workspace is handed back. */
  get cwd(): string {
    return this.info.path;
  }

  /** Capture the live checkout coordinates without mutating the worktree. */
  snapshot(): WorkspaceState {
    return this.state(this.info.revision) as unknown as WorkspaceState;
  }

  /** Checkpoint any dirty work, remove the checkout, and return reconstruction state. */
  suspend(outcome: WorkspaceDisposeOutcome): WorkspaceSuspendResult {
    return this.finish(outcome);
  }

  dispose(
    outcome: WorkspaceDisposeOutcome,
  ): { resultAddendum?: string } | undefined {
    const result = this.finish(outcome);
    return result.resultAddendum
      ? { resultAddendum: result.resultAddendum }
      : undefined;
  }

  /** Run the shared safe cleanup and translate its outcome to public seam values. */
  private finish(outcome: WorkspaceDisposeOutcome): WorkspaceSuspendResult {
    const result = cleanupWorktree(
      this.repoCwd,
      this.info,
      outcome.description,
    );
    // No child is running here any more — a worktree cleanup left behind is a
    // preserved one from this point on, and the scan may report it.
    this.live.remove(this.info.path);
    switch (result.outcome) {
      case "clean":
        return {
          state: this.state(result.revision) as unknown as WorkspaceState,
        };
      case "committed": {
        const bypassNote = result.hooksBypassed
          ? "\nCommit hooks were bypassed to save this work — review the commit before merging."
          : "";
        return {
          state: this.state(result.revision) as unknown as WorkspaceState,
          resultAddendum: `\n\n---\nChanges saved to branch \`${result.branch}\`. Merge with: \`git merge ${result.branch}\`${bypassNote}`,
        };
      }
      case "failed":
        return {
          state: this.state(result.revision) as unknown as WorkspaceState,
          resultAddendum: `\n\n---\nWorktree cleanup failed; the worktree was left in place at \`${result.path}\` for manual recovery: ${result.error}`,
        };
    }
  }

  /** Build one complete versioned checkpoint for this provider instance. */
  private state(revision: string): WorktreeWorkspaceState {
    return {
      version: STATE_VERSION,
      repoCwd: this.repoCwd,
      path: this.info.path,
      branch: this.info.branch,
      revision,
    };
  }
}

/** Owns resumable git worktrees for opted-in agent types. */
export class WorktreeWorkspaceProvider implements WorkspaceProvider {
  readonly id = PROVIDER_ID;

  constructor(
    private readonly config: WorktreesConfig,
    private readonly live: ActiveWorktrees,
  ) {}

  // eslint-disable-next-line @typescript-eslint/require-await -- the seam contract is async; worktree creation is synchronous, but staying async ensures failures reject the returned promise rather than throwing synchronously at the call site
  async prepare(ctx: WorkspacePrepareContext): Promise<Workspace | undefined> {
    if (!this.config.worktreeAgents.includes(ctx.agentType)) return undefined;

    const info = createWorktree(ctx.baseCwd, ctx.agentId);
    if (!info) {
      throw new Error(
        `Cannot run agent "${ctx.agentType}" with worktree isolation — ` +
          "not a git repo, no commits yet, or `git worktree add` failed. " +
          "Initialize git and commit at least once, or remove the agent from worktreeAgents.",
      );
    }
    this.live.add(info.path);
    return new WorktreeWorkspace(ctx.baseCwd, info, this.live);
  }

  /** Reconstruct the exact checkout described by this provider's persisted JSON. */
  // eslint-disable-next-line @typescript-eslint/require-await -- synchronous Git failures must reject this asynchronous provider boundary
  async restore(
    ctx: WorkspacePrepareContext,
    state: WorkspaceState,
  ): Promise<Workspace> {
    const checkpoint = decodeState(state);
    if (checkpoint?.repoCwd !== ctx.baseCwd) {
      throw new WorktreeRestoreError(
        "incompatible",
        "Persisted worktree state is malformed or belongs to a different repository",
      );
    }

    try {
      const info = restoreWorktree(ctx.baseCwd, checkpoint);
      this.live.add(info.path);
      return new WorktreeWorkspace(ctx.baseCwd, info, this.live);
    } catch (err) {
      throw new WorktreeRestoreError(
        "unavailable",
        `Cannot restore worktree for agent "${ctx.agentId}"`,
        { cause: err },
      );
    }
  }
}

/** Decode only this provider's current checkpoint schema. */
function decodeState(
  state: WorkspaceState,
): WorktreeWorkspaceState | undefined {
  if (
    typeof state !== "object" ||
    state === null ||
    Array.isArray(state) ||
    state.version !== STATE_VERSION ||
    typeof state.repoCwd !== "string" ||
    typeof state.path !== "string" ||
    typeof state.branch !== "string" ||
    typeof state.revision !== "string"
  ) {
    return undefined;
  }
  if (
    !state.branch.startsWith(AGENT_WORKTREE_PREFIX) ||
    !/^[0-9a-f]{40,64}$/.test(state.revision) ||
    !isProviderPath(state.path, state.branch)
  ) {
    return undefined;
  }
  return {
    version: STATE_VERSION,
    repoCwd: state.repoCwd,
    path: state.path,
    branch: state.branch,
    revision: state.revision,
  };
}

/** Keep persisted paths inside the namespace this provider itself creates. */
function isProviderPath(path: string, branch: string): boolean {
  const fromTemp = relative(tmpdir(), path);
  return (
    fromTemp.length > 0 &&
    fromTemp !== ".." &&
    !fromTemp.startsWith(`..${sep}`) &&
    !isAbsolute(fromTemp) &&
    basename(path).startsWith(`${branch}-`)
  );
}
