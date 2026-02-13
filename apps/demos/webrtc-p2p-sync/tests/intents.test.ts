/**
 * Unit tests for the Intent system.
 *
 * Tests: dispatch+handler resolve, unhandled intent rejects,
 * handler claiming (returns true), multiple handlers (first wins),
 * unsubscribe, newIntent typed adapter.
 */

import { describe, expect, it, vi } from "vitest";
import { createIntents } from "../src/intents/intents.js";
import { newIntent } from "../src/intents/new-intent.js";
import type { Intent, IntentHandler } from "../src/intents/types.js";

describe("createIntents", () => {
  it("should resolve when a handler claims the intent", async () => {
    const intents = createIntents();

    intents.addHandler<string, number>("test:add", (intent) => {
      intent.resolve(intent.payload.length);
      return true;
    });

    const result = intents.run<string, number>("test:add", "hello");
    expect(result.resolved).toBe(true);
    expect(await result.promise).toBe(5);
  });

  it("should reject when no handler is registered", async () => {
    const intents = createIntents();

    const result = intents.run("test:missing", {});
    expect(result.resolved).toBe(true);
    await expect(result.promise).rejects.toThrow("Unhandled intent: test:missing");
  });

  it("should reject when handlers exist but none claims", async () => {
    const intents = createIntents();

    intents.addHandler("test:skip", () => false);

    const result = intents.run("test:skip", {});
    await expect(result.promise).rejects.toThrow("Unhandled intent: test:skip");
  });

  it("should stop at the first handler that returns true", async () => {
    const intents = createIntents();
    const handler1 = vi.fn<IntentHandler<string, string>>((intent) => {
      intent.resolve("first");
      return true;
    });
    const handler2 = vi.fn<IntentHandler<string, string>>(() => false);

    intents.addHandler("test:first-wins", handler1);
    intents.addHandler("test:first-wins", handler2);

    const result = intents.run<string, string>("test:first-wins", "data");
    expect(handler1).toHaveBeenCalledTimes(1);
    expect(handler2).not.toHaveBeenCalled();
    expect(await result.promise).toBe("first");
  });

  it("should support async resolution via promise", async () => {
    const intents = createIntents();

    intents.addHandler<void, string>("test:async", (intent) => {
      intent.resolve(new Promise((resolve) => setTimeout(() => resolve("delayed"), 10)));
      return true;
    });

    const result = intents.run<void, string>("test:async", undefined);
    expect(result.resolved).toBe(true);
    expect(await result.promise).toBe("delayed");
  });

  it("should support handler unsubscribe", async () => {
    const intents = createIntents();

    const unsubscribe = intents.addHandler<void, string>("test:unsub", (intent) => {
      intent.resolve("handled");
      return true;
    });

    // First call works
    const result1 = intents.run<void, string>("test:unsub", undefined);
    expect(await result1.promise).toBe("handled");

    // Unsubscribe
    unsubscribe();

    // Second call should fail — no handler
    const result2 = intents.run<void, string>("test:unsub", undefined);
    await expect(result2.promise).rejects.toThrow("Unhandled intent: test:unsub");
  });

  it("should support rejection by handler", async () => {
    const intents = createIntents();

    intents.addHandler("test:reject", (intent) => {
      intent.reject(new Error("user cancelled"));
      return true;
    });

    const result = intents.run("test:reject", {});
    await expect(result.promise).rejects.toThrow("user cancelled");
  });
});

describe("newIntent typed adapter", () => {
  interface TestParams {
    value: number;
  }
  interface TestResult {
    doubled: number;
  }

  it("should provide typed run and handle functions", async () => {
    const [run, handle] = newIntent<TestParams, TestResult>("test:typed");
    const intents = createIntents();

    handle(intents, (intent: Intent<TestParams, TestResult>) => {
      intent.resolve({ doubled: intent.payload.value * 2 });
      return true;
    });

    const result = run(intents, { value: 21 });
    expect(await result.promise).toEqual({ doubled: 42 });
  });

  it("should support handle unsubscribe", async () => {
    const [run, handle] = newIntent<TestParams, TestResult>("test:typed-unsub");
    const intents = createIntents();

    const unsub = handle(intents, (intent) => {
      intent.resolve({ doubled: intent.payload.value * 2 });
      return true;
    });

    const r1 = run(intents, { value: 5 });
    expect(await r1.promise).toEqual({ doubled: 10 });

    unsub();

    const r2 = run(intents, { value: 5 });
    await expect(r2.promise).rejects.toThrow("Unhandled intent");
  });
});
