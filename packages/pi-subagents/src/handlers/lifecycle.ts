import type { SessionContext } from "#src/types";

/**
 * Session lifecycle event handlers: session_start, session_before_switch, session_shutdown.
 *
 * Extracted from index.ts so each handler can be tested in isolation
 * with mocked narrow interfaces.
 */

/** Narrow manager interface — only the methods lifecycle handlers call. */
export interface LifecycleManager {
  activate(ctx: SessionContext): void;
  deactivate(): Promise<void>;
  dispose(): Promise<void>;
}

/** Narrow runtime interface — only the methods lifecycle handlers call. */
export interface LifecycleRuntime {
  setSessionContext(ctx: SessionContext): void;
  clearSessionContext(): void;
}

/**
 * Handles session lifecycle events.
 *
 * Constructor deps:
 * - `runtime` — owns session context state
 * - `manager` — manages agent lifecycle (clear, abort, dispose)
 * - `disposeNotifications` — tears down the notification system on shutdown
 * - `unpublishService` — unpublishes the SubagentsService symbol on shutdown
 */
export class SessionLifecycleHandler {
  constructor(
    private readonly runtime: LifecycleRuntime,
    private readonly manager: LifecycleManager,
    private readonly disposeNotifications: () => void,
    private readonly unpublishService: () => void,
  ) {}

  handleSessionStart(_event: unknown, ctx: unknown): void {
    const sessionContext = ctx as SessionContext;
    this.runtime.setSessionContext(sessionContext);
    this.manager.activate(sessionContext);
  }

  handleSessionBeforeSwitch(): Promise<void> {
    return this.manager.deactivate();
  }

  // Cleanup order matters:
  // 1. Unpublish service — prevent new cross-extension calls
  // 2. Dispose notifications — silence nudges *before* the aborts that would
  //    raise them: no parent run is active at shutdown, so a terminal
  //    transition delivers its nudge synchronously and Pi cannot recall it
  // 3. Deactivate — stop, settle, persist, and release every child while the
  //    outgoing parent session-state boundary is still available
  // 4. Clear session context — no more parent state after deactivation
  // 5. Dispose manager — clear its process-wide timer
  async handleSessionShutdown(): Promise<void> {
    this.unpublishService();
    this.disposeNotifications();
    await this.manager.deactivate();
    this.runtime.clearSessionContext();
    await this.manager.dispose();
  }
}
