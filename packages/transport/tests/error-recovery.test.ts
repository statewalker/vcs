/**
 * Tests for P2P Error Recovery module.
 *
 * Verifies error types, timeout handling, disconnect detection,
 * transfer tracking, and retry logic.
 */

import { wrapNativePort } from "@statewalker/vcs-utils";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  createDisconnectMonitor,
  createIdleTimeout,
  createTransferTracker,
  isRetryableError,
  PortDisconnectedError,
  PortTimeoutError,
  TransferAbortedError,
  withRetry,
  withTimeout,
  wrapP2POperation,
} from "../src/peer/error-recovery.js";
import { TransportError } from "../src/protocol/errors.js";

// =============================================================================
// Error Types Tests
// =============================================================================

describe("Error Types", () => {
  describe("PortDisconnectedError", () => {
    it("should create error with default message", () => {
      const error = new PortDisconnectedError();
      expect(error.message).toBe("Port disconnected");
      expect(error.name).toBe("PortDisconnectedError");
      expect(error instanceof TransportError).toBe(true);
      expect(error.disconnectedAt).toBeInstanceOf(Date);
    });

    it("should create error with custom message", () => {
      const error = new PortDisconnectedError("Peer closed connection");
      expect(error.message).toBe("Peer closed connection");
    });
  });

  describe("PortTimeoutError", () => {
    it("should create error with operation and timeout info", () => {
      const error = new PortTimeoutError("fetch", 5000);
      expect(error.message).toBe("Operation 'fetch' timed out after 5000ms");
      expect(error.name).toBe("PortTimeoutError");
      expect(error.operation).toBe("fetch");
      expect(error.timeoutMs).toBe(5000);
      expect(error instanceof TransportError).toBe(true);
    });
  });

  describe("TransferAbortedError", () => {
    it("should create error with bytes transferred", () => {
      const error = new TransferAbortedError(1024);
      expect(error.message).toBe("Transfer aborted (1024 bytes transferred)");
      expect(error.name).toBe("TransferAbortedError");
      expect(error.bytesTransferred).toBe(1024);
      expect(error.bytesExpected).toBeUndefined();
    });

    it("should create error with bytes expected", () => {
      const error = new TransferAbortedError(1024, 4096);
      expect(error.message).toBe("Transfer aborted (1024/4096 bytes)");
      expect(error.bytesExpected).toBe(4096);
    });

    it("should create error with cause", () => {
      const cause = new Error("Connection reset");
      const error = new TransferAbortedError(1024, 4096, cause);
      expect(error.message).toBe("Transfer aborted (1024/4096 bytes): Connection reset");
      expect(error.cause).toBe(cause);
    });
  });
});

// =============================================================================
// Timeout Utilities Tests
// =============================================================================

describe("Timeout Utilities", () => {
  describe("withTimeout", () => {
    it("should resolve when promise completes before timeout", async () => {
      const result = await withTimeout(Promise.resolve("success"), {
        timeoutMs: 1000,
        operation: "test",
      });
      expect(result).toBe("success");
    });

    it("should reject with PortTimeoutError on timeout", async () => {
      const slowPromise = new Promise((resolve) => setTimeout(() => resolve("slow"), 1000));

      await expect(
        withTimeout(slowPromise, {
          timeoutMs: 50,
          operation: "slowOp",
        }),
      ).rejects.toThrow(PortTimeoutError);
    });

    it("should include operation name in timeout error", async () => {
      const slowPromise = new Promise((resolve) => setTimeout(() => resolve("slow"), 1000));

      try {
        await withTimeout(slowPromise, {
          timeoutMs: 50,
          operation: "myOperation",
        });
        expect.fail("Should have thrown");
      } catch (error) {
        expect(error).toBeInstanceOf(PortTimeoutError);
        expect((error as PortTimeoutError).operation).toBe("myOperation");
        expect((error as PortTimeoutError).timeoutMs).toBe(50);
      }
    });

    it("should reject immediately if already aborted", async () => {
      const controller = new AbortController();
      controller.abort();

      await expect(
        withTimeout(Promise.resolve("success"), {
          timeoutMs: 1000,
          operation: "test",
          signal: controller.signal,
        }),
      ).rejects.toThrow(PortTimeoutError);
    });

    it("should reject on abort signal", async () => {
      const controller = new AbortController();
      const slowPromise = new Promise((resolve) => setTimeout(() => resolve("slow"), 1000));

      const promise = withTimeout(slowPromise, {
        timeoutMs: 5000,
        operation: "test",
        signal: controller.signal,
      });

      // Abort after short delay
      setTimeout(() => controller.abort(), 50);

      await expect(promise).rejects.toThrow(PortTimeoutError);
    });

    it("should propagate original error", async () => {
      const error = new Error("Original error");

      await expect(
        withTimeout(Promise.reject(error), {
          timeoutMs: 1000,
          operation: "test",
        }),
      ).rejects.toThrow("Original error");
    });
  });

  describe("createIdleTimeout", () => {
    beforeEach(() => {
      vi.useFakeTimers();
    });

    afterEach(() => {
      vi.useRealTimers();
    });

    it("should fire callback after timeout", async () => {
      const callback = vi.fn();
      createIdleTimeout(1000, callback);

      expect(callback).not.toHaveBeenCalled();

      vi.advanceTimersByTime(1000);

      expect(callback).toHaveBeenCalledTimes(1);
    });

    it("should reset timer on activity", async () => {
      const callback = vi.fn();
      const timeout = createIdleTimeout(1000, callback);

      vi.advanceTimersByTime(800);
      expect(callback).not.toHaveBeenCalled();

      timeout.reset();

      vi.advanceTimersByTime(800);
      expect(callback).not.toHaveBeenCalled();

      vi.advanceTimersByTime(200);
      expect(callback).toHaveBeenCalledTimes(1);
    });

    it("should cancel timeout", async () => {
      const callback = vi.fn();
      const timeout = createIdleTimeout(1000, callback);

      vi.advanceTimersByTime(500);
      timeout.cancel();

      vi.advanceTimersByTime(1000);
      expect(callback).not.toHaveBeenCalled();
    });

    it("should report fired state", async () => {
      const callback = vi.fn();
      const timeout = createIdleTimeout(1000, callback);

      expect(timeout.hasFired()).toBe(false);

      vi.advanceTimersByTime(1000);

      expect(timeout.hasFired()).toBe(true);
    });

    it("should not reset after fired", async () => {
      const callback = vi.fn();
      const timeout = createIdleTimeout(1000, callback);

      vi.advanceTimersByTime(1000);
      expect(callback).toHaveBeenCalledTimes(1);

      timeout.reset();
      vi.advanceTimersByTime(1000);

      // Should not fire again
      expect(callback).toHaveBeenCalledTimes(1);
    });
  });
});

// =============================================================================
// Disconnect Monitoring Tests
// =============================================================================

describe("Disconnect Monitoring", () => {
  let channel: MessageChannel;

  beforeEach(() => {
    channel = new MessageChannel();
  });

  afterEach(() => {
    channel.port1.close();
    channel.port2.close();
  });

  describe("createDisconnectMonitor", () => {
    it("should start in connecting state", () => {
      const port = wrapNativePort(channel.port1);
      const monitor = createDisconnectMonitor(port);

      expect(monitor.state).toBe("connecting");
      expect(monitor.isConnected()).toBe(false);

      monitor.dispose();
    });

    it("should transition to connected state", () => {
      const port = wrapNativePort(channel.port1);
      const monitor = createDisconnectMonitor(port);

      monitor.markConnected();

      expect(monitor.state).toBe("connected");
      expect(monitor.isConnected()).toBe(true);

      monitor.dispose();
    });

    it("should call onDisconnect when port closes", () => {
      const port = wrapNativePort(channel.port1);
      const onDisconnect = vi.fn();
      const monitor = createDisconnectMonitor(port, { onDisconnect });

      monitor.markConnected();
      port.close();

      expect(onDisconnect).toHaveBeenCalled();
      expect(monitor.state).toBe("disconnected");

      monitor.dispose();
    });

    it("should only call onDisconnect once", () => {
      const port = wrapNativePort(channel.port1);
      const onDisconnect = vi.fn();
      const monitor = createDisconnectMonitor(port, { onDisconnect });

      port.close();
      port.close();

      expect(onDisconnect).toHaveBeenCalledTimes(1);

      monitor.dispose();
    });
  });
});

// =============================================================================
// Transfer Tracking Tests
// =============================================================================

describe("Transfer Tracking", () => {
  describe("createTransferTracker", () => {
    it("should create tracker with initial state", () => {
      const refs = new Map([["refs/heads/main", "abc123"]]);
      const tracker = createTransferTracker("fetch", refs);

      expect(tracker.state.direction).toBe("fetch");
      expect(tracker.state.bytesTransferred).toBe(0);
      expect(tracker.state.refs.size).toBe(1);
      expect(tracker.state.completedObjects.size).toBe(0);
      expect(tracker.state.transferId).toMatch(/^xfer-/);
    });

    it("should track bytes transferred", () => {
      const tracker = createTransferTracker("push", new Map());

      tracker.addBytes(1024);
      expect(tracker.state.bytesTransferred).toBe(1024);

      tracker.addBytes(2048);
      expect(tracker.state.bytesTransferred).toBe(3072);
    });

    it("should calculate progress percentage", () => {
      const tracker = createTransferTracker("fetch", new Map());

      tracker.setExpectedBytes(1000);
      tracker.addBytes(250);

      expect(tracker.getProgress()).toBe(25);

      tracker.addBytes(500);
      expect(tracker.getProgress()).toBe(75);
    });

    it("should return 0 progress when expected is unknown", () => {
      const tracker = createTransferTracker("fetch", new Map());
      tracker.addBytes(1024);

      expect(tracker.getProgress()).toBe(0);
    });

    it("should cap progress at 100", () => {
      const tracker = createTransferTracker("fetch", new Map());
      tracker.setExpectedBytes(100);
      tracker.addBytes(150);

      expect(tracker.getProgress()).toBe(100);
    });

    it("should track completed objects", () => {
      const tracker = createTransferTracker("fetch", new Map());

      tracker.markObjectComplete("obj1");
      tracker.markObjectComplete("obj2");

      expect(tracker.state.completedObjects.size).toBe(2);
      expect(tracker.state.completedObjects.has("obj1")).toBe(true);
    });

    it("should record errors", () => {
      const tracker = createTransferTracker("fetch", new Map());
      const error = new Error("Connection lost");

      tracker.recordError(error);

      expect(tracker.state.error).toBe(error);
    });

    it("should report canResume correctly", () => {
      const refs = new Map([["refs/heads/main", "abc123"]]);
      const tracker = createTransferTracker("fetch", refs);

      // Empty transfer can't resume
      expect(tracker.canResume()).toBe(false);

      // With progress, can resume
      tracker.addBytes(1024);
      expect(tracker.canResume()).toBe(true);

      // With error, can't resume
      tracker.recordError(new Error("Failed"));
      expect(tracker.canResume()).toBe(false);
    });

    it("should update lastProgressAt on activity", () => {
      const tracker = createTransferTracker("fetch", new Map());
      const initialTime = tracker.state.lastProgressAt;

      // Small delay to ensure time difference
      const later = new Date(initialTime.getTime() + 100);
      vi.setSystemTime(later);

      tracker.addBytes(1);
      expect(tracker.state.lastProgressAt.getTime()).toBeGreaterThanOrEqual(initialTime.getTime());

      vi.useRealTimers();
    });
  });
});

// =============================================================================
// Retry Logic Tests
// =============================================================================

describe("Retry Logic", () => {
  describe("isRetryableError", () => {
    it("should retry PortTimeoutError", () => {
      const error = new PortTimeoutError("test", 1000);
      expect(isRetryableError(error)).toBe(true);
    });

    it("should retry PortDisconnectedError", () => {
      const error = new PortDisconnectedError();
      expect(isRetryableError(error)).toBe(true);
    });

    it("should not retry TransferAbortedError", () => {
      const error = new TransferAbortedError(1024);
      expect(isRetryableError(error)).toBe(false);
    });

    it("should retry errors with timeout in message", () => {
      const error = new Error("Connection timeout");
      expect(isRetryableError(error)).toBe(true);
    });

    it("should not retry generic errors", () => {
      const error = new Error("Something went wrong");
      expect(isRetryableError(error)).toBe(false);
    });
  });

  describe("withRetry", () => {
    it("should succeed on first try", async () => {
      const fn = vi.fn().mockResolvedValue("success");

      const result = await withRetry(fn, { maxRetries: 3 });

      expect(result).toBe("success");
      expect(fn).toHaveBeenCalledTimes(1);
    });

    it("should retry on retryable error", async () => {
      const fn = vi
        .fn()
        .mockRejectedValueOnce(new PortTimeoutError("test", 1000))
        .mockResolvedValue("success");

      const result = await withRetry(fn, {
        maxRetries: 3,
        initialDelayMs: 10,
      });

      expect(result).toBe("success");
      expect(fn).toHaveBeenCalledTimes(2);
    });

    it("should fail after max retries", async () => {
      const error = new PortTimeoutError("test", 1000);
      const fn = vi.fn().mockRejectedValue(error);

      await expect(
        withRetry(fn, {
          maxRetries: 2,
          initialDelayMs: 10,
        }),
      ).rejects.toThrow(PortTimeoutError);

      expect(fn).toHaveBeenCalledTimes(3); // Initial + 2 retries
    });

    it("should not retry non-retryable errors", async () => {
      const error = new Error("Not retryable");
      const fn = vi.fn().mockRejectedValue(error);

      await expect(
        withRetry(fn, {
          maxRetries: 3,
          initialDelayMs: 10,
        }),
      ).rejects.toThrow("Not retryable");

      expect(fn).toHaveBeenCalledTimes(1);
    });

    it("should call onRetry callback", async () => {
      const onRetry = vi.fn();
      const fn = vi
        .fn()
        .mockRejectedValueOnce(new PortTimeoutError("test", 1000))
        .mockResolvedValue("success");

      await withRetry(fn, {
        maxRetries: 3,
        initialDelayMs: 10,
        onRetry,
      });

      expect(onRetry).toHaveBeenCalledTimes(1);
      expect(onRetry).toHaveBeenCalledWith(1, expect.any(PortTimeoutError), 10);
    });

    it("should use exponential backoff", async () => {
      const onRetry = vi.fn();
      const fn = vi
        .fn()
        .mockRejectedValueOnce(new PortTimeoutError("test", 1000))
        .mockRejectedValueOnce(new PortTimeoutError("test", 1000))
        .mockResolvedValue("success");

      await withRetry(fn, {
        maxRetries: 3,
        initialDelayMs: 10,
        backoffMultiplier: 2,
        onRetry,
      });

      expect(onRetry).toHaveBeenNthCalledWith(1, 1, expect.any(Error), 10);
      expect(onRetry).toHaveBeenNthCalledWith(2, 2, expect.any(Error), 20);
    });

    it("should respect abort signal", async () => {
      const controller = new AbortController();
      const fn = vi.fn().mockRejectedValue(new PortTimeoutError("test", 1000));

      const promise = withRetry(fn, {
        maxRetries: 10,
        initialDelayMs: 100,
        signal: controller.signal,
      });

      // Abort after first attempt
      setTimeout(() => controller.abort(), 50);

      await expect(promise).rejects.toThrow(PortTimeoutError);
    });

    it("should use custom isRetryable function", async () => {
      const customError = new Error("Custom retryable");
      const fn = vi.fn().mockRejectedValueOnce(customError).mockResolvedValue("success");

      const result = await withRetry(fn, {
        maxRetries: 3,
        initialDelayMs: 10,
        isRetryable: (err) => err.message.includes("Custom"),
      });

      expect(result).toBe("success");
      expect(fn).toHaveBeenCalledTimes(2);
    });
  });
});

// =============================================================================
// wrapP2POperation Tests
// =============================================================================

describe("wrapP2POperation", () => {
  let channel: MessageChannel;

  beforeEach(() => {
    channel = new MessageChannel();
  });

  afterEach(() => {
    channel.port1.close();
    channel.port2.close();
  });

  it("should execute operation successfully", async () => {
    const port = wrapNativePort(channel.port1);

    const result = await wrapP2POperation(port, "test", async (ctx) => {
      ctx.monitor?.markConnected();
      return "success";
    });

    expect(result).toBe("success");
  });

  it("should provide context with signal", async () => {
    const port = wrapNativePort(channel.port1);
    let receivedSignal: AbortSignal | undefined;

    await wrapP2POperation(port, "test", async (ctx) => {
      receivedSignal = ctx.signal;
      return "done";
    });

    expect(receivedSignal).toBeDefined();
    expect(receivedSignal?.aborted).toBe(false);
  });

  it("should track progress", async () => {
    const port = wrapNativePort(channel.port1);
    const progressValues: number[] = [];

    await wrapP2POperation(
      port,
      "fetch",
      async (ctx) => {
        ctx.reportProgress(100);
        ctx.reportProgress(200);
        return "done";
      },
      {
        trackTransfer: true,
        onProgress: (bytes) => progressValues.push(bytes),
      },
    );

    expect(progressValues).toEqual([100, 300]); // Cumulative
  });

  it("should timeout long operations", async () => {
    const port = wrapNativePort(channel.port1);

    await expect(
      wrapP2POperation(
        port,
        "slow",
        async () => {
          await new Promise((resolve) => setTimeout(resolve, 1000));
          return "done";
        },
        { timeoutMs: 50 },
      ),
    ).rejects.toThrow(PortTimeoutError);
  });

  it("should detect disconnect", async () => {
    const port = wrapNativePort(channel.port1);

    const promise = wrapP2POperation(
      port,
      "wait",
      async (ctx) => {
        ctx.monitor?.markConnected();
        // Wait for disconnect
        while (ctx.shouldContinue()) {
          await new Promise((resolve) => setTimeout(resolve, 10));
        }
        throw new Error("Should not reach here");
      },
      { timeoutMs: 5000, monitorDisconnect: true },
    );

    // Close port to trigger disconnect
    setTimeout(() => port.close(), 50);

    await expect(promise).rejects.toThrow();
  });

  it("should use retry when configured", async () => {
    const port = wrapNativePort(channel.port1);
    let attempts = 0;

    const result = await wrapP2POperation(
      port,
      "retry-test",
      async () => {
        attempts++;
        if (attempts < 2) {
          throw new PortTimeoutError("attempt", 100);
        }
        return "success";
      },
      {
        retry: { maxRetries: 3, initialDelayMs: 10 },
      },
    );

    expect(result).toBe("success");
    expect(attempts).toBe(2);
  });
});
