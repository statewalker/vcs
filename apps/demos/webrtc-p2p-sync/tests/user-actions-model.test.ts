/**
 * Tests for UserActionsModel with action adapter pattern.
 */

import { describe, expect, it, vi } from "vitest";
import { UserActionsModel } from "../src/models/user-actions-model.js";

/**
 * Helper to flush microtasks (wait for queueMicrotask callbacks).
 */
function flushMicrotasks(): Promise<void> {
  return new Promise((resolve) => queueMicrotask(resolve));
}

describe("UserActionsModel", () => {
  describe("enqueue", () => {
    it("should enqueue action and dispatch to listener", async () => {
      const model = new UserActionsModel();
      const handler = vi.fn();

      model.onActionUpdate("test:action", handler);
      model.enqueue("test:action", { value: 42 });

      await flushMicrotasks();

      expect(handler).toHaveBeenCalledWith([{ value: 42 }]);
    });

    it("should enqueue void payload as undefined", async () => {
      const model = new UserActionsModel();
      const handler = vi.fn();

      model.onActionUpdate("test:void", handler);
      model.enqueue("test:void", undefined);

      await flushMicrotasks();

      expect(handler).toHaveBeenCalledWith([undefined]);
    });
  });

  describe("type isolation", () => {
    it("should only notify listeners of matching type", async () => {
      const model = new UserActionsModel();

      const handlerA = vi.fn();
      const handlerB = vi.fn();

      model.onActionUpdate("type:a", handlerA);
      model.onActionUpdate("type:b", handlerB);

      model.enqueue("type:a", { a: 1 });

      await flushMicrotasks();

      expect(handlerA).toHaveBeenCalledWith([{ a: 1 }]);
      expect(handlerB).not.toHaveBeenCalled();
    });
  });

  describe("multi-listener broadcast", () => {
    it("should notify all listeners for same type", async () => {
      const model = new UserActionsModel();

      const handler1 = vi.fn();
      const handler2 = vi.fn();
      const handler3 = vi.fn();

      model.onActionUpdate("shared:type", handler1);
      model.onActionUpdate("shared:type", handler2);
      model.onActionUpdate("shared:type", handler3);

      model.enqueue("shared:type", { shared: true });

      await flushMicrotasks();

      expect(handler1).toHaveBeenCalledWith([{ shared: true }]);
      expect(handler2).toHaveBeenCalledWith([{ shared: true }]);
      expect(handler3).toHaveBeenCalledWith([{ shared: true }]);
    });

    it("should pass copy of actions to each listener", async () => {
      const model = new UserActionsModel();

      const receivedArrays: unknown[][] = [];

      model.onActionUpdate("test", (actions) => {
        receivedArrays.push(actions);
        actions.push({ mutated: true }); // Try to mutate
      });

      model.onActionUpdate("test", (actions) => {
        receivedArrays.push(actions);
      });

      model.enqueue("test", { original: true });

      await flushMicrotasks();

      // Second listener should not see mutation from first
      expect(receivedArrays[0]).toHaveLength(2); // Mutated
      expect(receivedArrays[1]).toHaveLength(1); // Original copy
    });
  });

  describe("microtask batching", () => {
    it("should batch multiple enqueues in same tick", async () => {
      const model = new UserActionsModel();
      const handler = vi.fn();

      model.onActionUpdate("batch:test", handler);

      model.enqueue("batch:test", { n: 1 });
      model.enqueue("batch:test", { n: 2 });
      model.enqueue("batch:test", { n: 3 });

      expect(handler).not.toHaveBeenCalled(); // Not yet

      await flushMicrotasks();

      expect(handler).toHaveBeenCalledTimes(1);
      expect(handler).toHaveBeenCalledWith([{ n: 1 }, { n: 2 }, { n: 3 }]);
    });

    it("should handle separate batches across ticks", async () => {
      const model = new UserActionsModel();
      const handler = vi.fn();

      model.onActionUpdate("batch:test", handler);

      model.enqueue("batch:test", { batch: 1 });
      await flushMicrotasks();

      model.enqueue("batch:test", { batch: 2 });
      await flushMicrotasks();

      expect(handler).toHaveBeenCalledTimes(2);
      expect(handler).toHaveBeenNthCalledWith(1, [{ batch: 1 }]);
      expect(handler).toHaveBeenNthCalledWith(2, [{ batch: 2 }]);
    });
  });

  describe("unsubscribe", () => {
    it("should stop receiving actions after unsubscribe", async () => {
      const model = new UserActionsModel();
      const handler = vi.fn();

      const unsubscribe = model.onActionUpdate("unsub:test", handler);

      model.enqueue("unsub:test", { before: true });
      await flushMicrotasks();

      unsubscribe();

      model.enqueue("unsub:test", { after: true });
      await flushMicrotasks();

      expect(handler).toHaveBeenCalledTimes(1);
      expect(handler).toHaveBeenCalledWith([{ before: true }]);
    });

    it("should be safe to unsubscribe during dispatch", async () => {
      const model = new UserActionsModel();
      let unsubscribe: () => void;

      const handler = vi.fn(() => {
        unsubscribe(); // Unsubscribe self during handling
      });

      unsubscribe = model.onActionUpdate("self:unsub", handler);

      model.enqueue("self:unsub", {});

      // Should not throw
      await expect(flushMicrotasks()).resolves.toBeUndefined();
    });
  });

  describe("action clearing", () => {
    it("should clear actions after dispatch", async () => {
      const model = new UserActionsModel();
      const handler = vi.fn();

      model.onActionUpdate("clear:test", handler);

      model.enqueue("clear:test", { first: true });
      await flushMicrotasks();

      // Subscribe new listener after dispatch
      const lateHandler = vi.fn();
      model.onActionUpdate("clear:test", lateHandler);

      await flushMicrotasks();

      // Late listener should not see old actions
      expect(lateHandler).not.toHaveBeenCalled();
    });

    it("should clear all actions with clear()", async () => {
      const model = new UserActionsModel();
      const handler = vi.fn();

      model.onActionUpdate("test", handler);

      model.enqueue("test", { value: 1 });
      model.clear();

      await flushMicrotasks();

      // Handler should not be called because we cleared before dispatch
      expect(handler).not.toHaveBeenCalled();
    });
  });

  describe("error handling", () => {
    it("should continue dispatching if one handler throws", async () => {
      const model = new UserActionsModel();
      const consoleSpy = vi.spyOn(console, "error").mockImplementation(() => {});

      const errorHandler = vi.fn(() => {
        throw new Error("Handler error");
      });
      const goodHandler = vi.fn();

      model.onActionUpdate("error:test", errorHandler);
      model.onActionUpdate("error:test", goodHandler);

      model.enqueue("error:test", {});

      await flushMicrotasks();

      expect(errorHandler).toHaveBeenCalled();
      expect(goodHandler).toHaveBeenCalled(); // Should still be called
      expect(consoleSpy).toHaveBeenCalled();

      consoleSpy.mockRestore();
    });
  });

  describe("general notification", () => {
    it("should call general onUpdate after dispatch", async () => {
      const model = new UserActionsModel();
      const generalListener = vi.fn();

      model.onUpdate(generalListener);
      model.enqueue("test", { value: 1 });

      await flushMicrotasks();

      expect(generalListener).toHaveBeenCalled();
    });
  });
});
