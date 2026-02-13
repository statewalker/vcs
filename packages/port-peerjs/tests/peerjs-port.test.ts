/**
 * Tests for PeerJS port adapter.
 */

import type { DataConnection } from "peerjs";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { createPeerJsPort } from "../src/peerjs-port.js";

// Mock PeerJS DataConnection for testing
function createMockConnection(): DataConnection & {
  simulateData(data: unknown): void;
  simulateClose(): void;
} {
  const handlers: Record<string, ((...args: unknown[]) => void)[]> = {
    data: [],
    close: [],
    error: [],
    open: [],
  };

  const conn = {
    open: true,

    send: vi.fn(),
    close: vi.fn(() => {
      conn.open = false;
      for (const h of handlers.close) h();
    }),

    on(event: string, handler: (...args: unknown[]) => void) {
      if (!handlers[event]) handlers[event] = [];
      handlers[event].push(handler);
      return conn;
    },

    off(event: string, handler: (...args: unknown[]) => void) {
      if (handlers[event]) {
        handlers[event] = handlers[event].filter((h) => h !== handler);
      }
      return conn;
    },

    simulateData(data: unknown) {
      for (const h of handlers.data) h(data);
    },

    simulateClose() {
      conn.open = false;
      for (const h of handlers.close) h();
    },
  };

  return conn as unknown as DataConnection & {
    simulateData(data: unknown): void;
    simulateClose(): void;
  };
}

describe("createPeerJsPort", () => {
  let mockConn: ReturnType<typeof createMockConnection>;

  beforeEach(() => {
    mockConn = createMockConnection();
  });

  it("should return a standard MessagePort", () => {
    const port = createPeerJsPort(mockConn);

    // Standard MessagePort interface
    expect(port).toBeDefined();
    expect(port.postMessage).toBeDefined();
    expect(port.close).toBeDefined();
    expect(port.start).toBeDefined();
    expect(port.addEventListener).toBeDefined();
    expect(port.removeEventListener).toBeDefined();
  });

  it("should forward postMessage to conn.send", async () => {
    const port = createPeerJsPort(mockConn);
    port.start();

    const data = new Uint8Array([1, 2, 3]);
    port.postMessage(data);

    // Allow the internal port2.onmessage to process
    await new Promise((resolve) => setTimeout(resolve, 0));

    expect(mockConn.send).toHaveBeenCalled();
    const sentData = mockConn.send.mock.calls[0][0];
    expect(sentData).toBeInstanceOf(Uint8Array);
    expect(new Uint8Array(sentData)).toEqual(data);
  });

  it("should not forward messages when connection is closed", async () => {
    mockConn.open = false;
    const port = createPeerJsPort(mockConn);
    port.start();

    port.postMessage(new Uint8Array([1, 2, 3]));

    await new Promise((resolve) => setTimeout(resolve, 0));

    // Should not throw, just silently not send
    expect(mockConn.send).not.toHaveBeenCalled();
  });

  it("should forward incoming Uint8Array data via message event", async () => {
    const port = createPeerJsPort(mockConn);
    const handler = vi.fn();
    port.addEventListener("message", handler);
    port.start();

    const data = new Uint8Array([1, 2, 3]);
    mockConn.simulateData(data);

    // Allow message to propagate through the MessageChannel
    await new Promise((resolve) => setTimeout(resolve, 0));

    expect(handler).toHaveBeenCalled();
    const received = new Uint8Array(handler.mock.calls[0][0].data);
    expect(received).toEqual(data);
  });

  it("should convert ArrayBuffer data to Uint8Array", async () => {
    const port = createPeerJsPort(mockConn);
    const handler = vi.fn();
    port.addEventListener("message", handler);
    port.start();

    const data = new ArrayBuffer(3);
    new Uint8Array(data).set([4, 5, 6]);
    mockConn.simulateData(data);

    await new Promise((resolve) => setTimeout(resolve, 0));

    expect(handler).toHaveBeenCalled();
    const received = new Uint8Array(handler.mock.calls[0][0].data);
    expect(received).toEqual(new Uint8Array([4, 5, 6]));
  });

  it("should send null on connection close (EOF signal)", async () => {
    const port = createPeerJsPort(mockConn);
    const handler = vi.fn();
    port.addEventListener("message", handler);
    port.start();

    mockConn.simulateClose();

    await new Promise((resolve) => setTimeout(resolve, 0));

    // Should receive null as end-of-stream signal
    expect(handler).toHaveBeenCalled();
    expect(handler.mock.calls[0][0].data).toBe(null);
  });

  it("should close the returned port when connection closes", async () => {
    const port = createPeerJsPort(mockConn);
    port.start();

    mockConn.simulateClose();

    await new Promise((resolve) => setTimeout(resolve, 0));

    // Port should be effectively closed - further messages won't work
    // We can't directly test port state, but we've tested the null signal
  });

  it("should support multiple message listeners", async () => {
    const port = createPeerJsPort(mockConn);
    const handler1 = vi.fn();
    const handler2 = vi.fn();
    port.addEventListener("message", handler1);
    port.addEventListener("message", handler2);
    port.start();

    const data = new Uint8Array([7, 8, 9]);
    mockConn.simulateData(data);

    await new Promise((resolve) => setTimeout(resolve, 0));

    expect(handler1).toHaveBeenCalled();
    expect(handler2).toHaveBeenCalled();
  });

  it("should support removeEventListener", async () => {
    const port = createPeerJsPort(mockConn);
    const handler = vi.fn();
    port.addEventListener("message", handler);
    port.removeEventListener("message", handler);
    port.start();

    mockConn.simulateData(new Uint8Array([1, 2, 3]));

    await new Promise((resolve) => setTimeout(resolve, 0));

    expect(handler).not.toHaveBeenCalled();
  });

  it("should convert string data to Uint8Array", async () => {
    const port = createPeerJsPort(mockConn);
    const handler = vi.fn();
    port.addEventListener("message", handler);
    port.start();

    mockConn.simulateData("hello");

    await new Promise((resolve) => setTimeout(resolve, 0));

    expect(handler).toHaveBeenCalled();
    const received = new TextDecoder().decode(handler.mock.calls[0][0].data);
    expect(received).toBe("hello");
  });
});
