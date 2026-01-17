/**
 * Tests for newUserAction adapter function.
 */

import { describe, expect, it, vi } from "vitest";
import { UserActionsModel } from "../src/models/user-actions-model.js";
import { newUserAction } from "../src/utils/user-action.js";

/**
 * Helper to flush microtasks (wait for queueMicrotask callbacks).
 */
function flushMicrotasks(): Promise<void> {
  return new Promise((resolve) => queueMicrotask(resolve));
}

describe("newUserAction", () => {
  describe("basic functionality", () => {
    it("should create enqueue and listen functions", () => {
      const [enqueue, listen] = newUserAction<{ value: number }>("test:action");
      expect(typeof enqueue).toBe("function");
      expect(typeof listen).toBe("function");
    });

    it("should enqueue action with payload", async () => {
      const model = new UserActionsModel();
      const [enqueue, listen] = newUserAction<{ value: number }>("test:action");

      const handler = vi.fn();
      listen(model, handler);

      enqueue(model, { value: 42 });

      await flushMicrotasks();

      expect(handler).toHaveBeenCalledWith([{ value: 42 }]);
    });

    it("should support complex payload types", async () => {
      const model = new UserActionsModel();
      type ComplexPayload = {
        name: string;
        nested: { items: number[] };
        optional?: boolean;
      };
      const [enqueue, listen] = newUserAction<ComplexPayload>("test:complex");

      const handler = vi.fn();
      listen(model, handler);

      enqueue(model, {
        name: "test",
        nested: { items: [1, 2, 3] },
        optional: true,
      });

      await flushMicrotasks();

      expect(handler).toHaveBeenCalledWith([
        {
          name: "test",
          nested: { items: [1, 2, 3] },
          optional: true,
        },
      ]);
    });
  });

  describe("void payload actions", () => {
    it("should allow enqueue without payload for void actions", async () => {
      const [enqueue, listen] = newUserAction("test:void");
      const model = new UserActionsModel();

      const handler = vi.fn();
      listen(model, handler);

      enqueue(model); // No second argument

      await flushMicrotasks();

      expect(handler).toHaveBeenCalled();
    });
  });

  describe("unsubscribe", () => {
    it("should return unsubscribe function from listen", async () => {
      const model = new UserActionsModel();
      const [enqueue, listen] = newUserAction<{ v: number }>("test:unsub");

      const handler = vi.fn();
      const unsubscribe = listen(model, handler);

      enqueue(model, { v: 1 });
      await flushMicrotasks();
      expect(handler).toHaveBeenCalledTimes(1);

      unsubscribe();

      enqueue(model, { v: 2 });
      await flushMicrotasks();
      expect(handler).toHaveBeenCalledTimes(1); // Not called again
    });
  });

  describe("batching", () => {
    it("should batch multiple enqueues in same tick", async () => {
      const model = new UserActionsModel();
      const [enqueue, listen] = newUserAction<{ v: number }>("test:batch");

      const handler = vi.fn();
      listen(model, handler);

      enqueue(model, { v: 1 });
      enqueue(model, { v: 2 });
      enqueue(model, { v: 3 });

      await flushMicrotasks();

      expect(handler).toHaveBeenCalledTimes(1);
      expect(handler).toHaveBeenCalledWith([{ v: 1 }, { v: 2 }, { v: 3 }]);
    });
  });

  describe("multiple listeners", () => {
    it("should notify all listeners with same actions", async () => {
      const model = new UserActionsModel();
      const [enqueue, listen] = newUserAction<{ v: number }>("test:multi");

      const handlerA = vi.fn();
      const handlerB = vi.fn();

      listen(model, handlerA);
      listen(model, handlerB);

      enqueue(model, { v: 42 });

      await flushMicrotasks();

      expect(handlerA).toHaveBeenCalledWith([{ v: 42 }]);
      expect(handlerB).toHaveBeenCalledWith([{ v: 42 }]);
    });
  });

  describe("type isolation", () => {
    it("should not cross-notify between different action types", async () => {
      const model = new UserActionsModel();
      const [enqueueA, listenA] = newUserAction<{ a: number }>("action:a");
      const [_enqueueB, listenB] = newUserAction<{ b: string }>("action:b");

      const handlerA = vi.fn();
      const handlerB = vi.fn();

      listenA(model, handlerA);
      listenB(model, handlerB);

      enqueueA(model, { a: 1 });

      await flushMicrotasks();

      expect(handlerA).toHaveBeenCalledWith([{ a: 1 }]);
      expect(handlerB).not.toHaveBeenCalled();
    });
  });

  describe("action declarations", () => {
    it("should work with separately declared adapters", async () => {
      const model = new UserActionsModel();

      // Simulate how actions are declared in separate files
      type InitPayload = { path: string };
      const [enqueueInit, listenInit] = newUserAction<InitPayload>("repo:init");

      const handler = vi.fn();
      listenInit(model, handler);

      enqueueInit(model, { path: "/repo" });

      await flushMicrotasks();

      expect(handler).toHaveBeenCalledWith([{ path: "/repo" }]);
    });

    it("should handle typed payload in listener callback", async () => {
      const model = new UserActionsModel();

      type FilePayload = { name: string; content: string };
      const [enqueue, listen] = newUserAction<FilePayload>("file:add");

      const receivedNames: string[] = [];

      listen(model, (actions) => {
        for (const { name } of actions) {
          receivedNames.push(name);
        }
      });

      enqueue(model, { name: "a.txt", content: "a" });
      enqueue(model, { name: "b.txt", content: "b" });

      await flushMicrotasks();

      expect(receivedNames).toEqual(["a.txt", "b.txt"]);
    });
  });
});
