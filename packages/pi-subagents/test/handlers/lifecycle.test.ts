import { beforeEach, describe, expect, it, type Mock, vi } from "vitest";
import type { LifecycleManager, LifecycleRuntime } from "#src/handlers/lifecycle";
import { SessionLifecycleHandler } from "#src/handlers/lifecycle";
import type { SessionContext } from "#src/types";

describe("SessionLifecycleHandler", () => {
  let runtime: LifecycleRuntime;
  let manager: LifecycleManager;
  let activate: Mock<LifecycleManager["activate"]>;
  let deactivate: Mock<LifecycleManager["deactivate"]>;
  let prepareTreeTransition: Mock<LifecycleManager["prepareTreeTransition"]>;
  let reconcileTree: Mock<LifecycleManager["reconcileTree"]>;
  let dispose: Mock<LifecycleManager["dispose"]>;
  let setSessionContext: Mock<LifecycleRuntime["setSessionContext"]>;
  let clearSessionContext: Mock<LifecycleRuntime["clearSessionContext"]>;
  let disposeNotifications: Mock<() => void>;
  let unpublishService: Mock<() => void>;
  let handler: SessionLifecycleHandler;

  beforeEach(() => {
    activate = vi.fn();
    deactivate = vi.fn(() => Promise.resolve());
    prepareTreeTransition = vi.fn(() => Promise.resolve());
    reconcileTree = vi.fn();
    dispose = vi.fn(() => Promise.resolve());
    setSessionContext = vi.fn();
    clearSessionContext = vi.fn();
    disposeNotifications = vi.fn();
    unpublishService = vi.fn();
    runtime = { setSessionContext, clearSessionContext };
    manager = {
      activate,
      deactivate,
      prepareTreeTransition,
      reconcileTree,
      dispose,
    };
    handler = new SessionLifecycleHandler(
      runtime,
      manager,
      disposeNotifications,
      unpublishService,
    );
  });

  describe("handleSessionStart", () => {
    it("stores the incoming context before activating its durable registry", () => {
      const calls: string[] = [];
      const ctx = { cwd: "/some/path" } as SessionContext;
      setSessionContext.mockImplementation(() => { calls.push("context"); });
      activate.mockImplementation(() => { calls.push("activate"); });

      handler.handleSessionStart({}, ctx);

      expect(setSessionContext).toHaveBeenCalledWith(ctx);
      expect(activate).toHaveBeenCalledWith(ctx);
      expect(calls).toEqual(["context", "activate"]);
    });
  });

  describe("handleSessionBeforeSwitch", () => {
    it("waits for the outgoing registry to deactivate", async () => {
      const gate = Promise.withResolvers<void>(); // eslint-disable-line @typescript-eslint/no-invalid-void-type -- Promise.withResolvers<void> is valid; rule does not allow void in generic fn call type args
      deactivate.mockReturnValue(gate.promise);

      let settled = false;
      const pending = handler.handleSessionBeforeSwitch().then(() => {
        settled = true;
      });
      await Promise.resolve();
      expect(settled).toBe(false);

      gate.resolve();
      await pending;
      expect(settled).toBe(true);
    });
  });

  describe("tree navigation", () => {
    it("waits for departing sibling agents before Pi moves the leaf", async () => {
      const gate = Promise.withResolvers<void>(); // eslint-disable-line @typescript-eslint/no-invalid-void-type -- Promise.withResolvers<void> is valid; rule does not allow void in generic fn call type args
      prepareTreeTransition.mockReturnValue(gate.promise);

      let settled = false;
      const pending = handler.handleSessionBeforeTree({
        preparation: { commonAncestorId: "shared-entry" },
      }).then(() => { settled = true; });
      await Promise.resolve();

      expect(prepareTreeTransition).toHaveBeenCalledWith("shared-entry");
      expect(settled).toBe(false);

      gate.resolve();
      await pending;
      expect(settled).toBe(true);
    });

    it("reprojects the selected ancestry without deactivating shared agents", async () => {
      const calls: string[] = [];
      const ctx = { cwd: "/selected/branch" } as SessionContext;
      setSessionContext.mockImplementation(() => { calls.push("context"); });
      reconcileTree.mockImplementation(async () => { calls.push("reconcile"); });

      await handler.handleSessionTree({}, ctx);

      expect(setSessionContext).toHaveBeenCalledWith(ctx);
      expect(reconcileTree).toHaveBeenCalledWith(ctx);
      expect(deactivate).not.toHaveBeenCalled();
      expect(calls).toEqual(["context", "reconcile"]);
    });
  });

  describe("handleSessionShutdown", () => {
    it("deactivates while parent state is available, then clears context and manager", async () => {
      const calls: string[] = [];
      unpublishService.mockImplementation(() => { calls.push("unpublish"); });
      disposeNotifications.mockImplementation(() => { calls.push("notifications"); });
      deactivate.mockImplementation(async () => { calls.push("deactivate"); });
      clearSessionContext.mockImplementation(() => { calls.push("clear-context"); });
      dispose.mockImplementation(async () => { calls.push("dispose"); });

      await handler.handleSessionShutdown();

      expect(calls).toEqual([
        "unpublish",
        "notifications",
        "deactivate",
        "clear-context",
        "dispose",
      ]);
    });

    it("does not clear the parent context until deactivation settles", async () => {
      const gate = Promise.withResolvers<void>(); // eslint-disable-line @typescript-eslint/no-invalid-void-type -- Promise.withResolvers<void> is valid; rule does not allow void in generic fn call type args
      deactivate.mockReturnValue(gate.promise);

      const pending = handler.handleSessionShutdown();
      await Promise.resolve();
      expect(clearSessionContext).not.toHaveBeenCalled();
      expect(dispose).not.toHaveBeenCalled();

      gate.resolve();
      await pending;
      expect(clearSessionContext).toHaveBeenCalledOnce();
      expect(dispose).toHaveBeenCalledOnce();
    });
  });
});
