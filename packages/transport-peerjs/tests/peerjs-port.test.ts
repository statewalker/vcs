/**
 * Tests for PeerJS port adapter.
 */

import { beforeEach, describe, expect, it, vi } from "vitest";
import { createPeerJsPort } from "../src/peerjs-port.js";
import type { DataConnection } from "peerjs";

// Mock PeerJS DataConnection for testing
function createMockConnection(): DataConnection & {
  _dc: { bufferedAmount: number; readyState: string };
  simulateData(data: unknown): void;
  simulateClose(): void;
  simulateError(err: Error): void;
} {
  const handlers: Record<string, ((...args: unknown[]) => void)[]> = {
    data: [],
    close: [],
    error: [],
    open: [],
  };

  const mockDc = {
    bufferedAmount: 0,
    readyState: "open",
  };

  const conn = {
    open: true,
    _dc: mockDc,

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

    simulateError(err: Error) {
      for (const h of handlers.error) h(err);
    },
  };

  return conn as unknown as DataConnection & {
    _dc: { bufferedAmount: number; readyState: string };
    simulateData(data: unknown): void;
    simulateClose(): void;
    simulateError(err: Error): void;
  };
}

describe("createPeerJsPort", () => {
  let mockConn: ReturnType<typeof createMockConnection>;

  beforeEach(() => {
    mockConn = createMockConnection();
  });

  it("should create port from DataConnection", () => {
    const port = createPeerJsPort(mockConn);

    expect(port.isOpen).toBe(true);
  });

  it("should forward postMessage to conn.send", () => {
    const port = createPeerJsPort(mockConn);
    const data = new Uint8Array([1, 2, 3]);

    port.postMessage(data);

    expect(mockConn.send).toHaveBeenCalledWith(data);
  });

  it("should throw when posting to closed connection", () => {
    mockConn.open = false;
    const port = createPeerJsPort(mockConn);

    expect(() => port.postMessage(new Uint8Array([1]))).toThrow("not open");
  });

  it("should expose bufferedAmount from underlying DataChannel", () => {
    mockConn._dc.bufferedAmount = 12345;
    const port = createPeerJsPort(mockConn);

    expect(port.bufferedAmount).toBe(12345);
  });

  it("should return 0 bufferedAmount if _dc is not available", () => {
    (mockConn as unknown as { _dc: undefined })._dc = undefined;
    const port = createPeerJsPort(mockConn);

    expect(port.bufferedAmount).toBe(0);
  });

  it("should report isOpen based on conn.open", () => {
    const port = createPeerJsPort(mockConn);

    expect(port.isOpen).toBe(true);

    mockConn.open = false;
    expect(port.isOpen).toBe(false);
  });

  it("should forward incoming ArrayBuffer data to onmessage", () => {
    const port = createPeerJsPort(mockConn);
    const handler = vi.fn();
    port.onmessage = handler;
    port.start();

    const data = new ArrayBuffer(8);
    mockConn.simulateData(data);

    expect(handler).toHaveBeenCalled();
    expect(handler.mock.calls[0][0].data).toBe(data);
  });

  it("should convert Uint8Array data to ArrayBuffer", () => {
    const port = createPeerJsPort(mockConn);
    const handler = vi.fn();
    port.onmessage = handler;
    port.start();

    const data = new Uint8Array([1, 2, 3]);
    mockConn.simulateData(data);

    expect(handler).toHaveBeenCalled();
    const received = new Uint8Array(handler.mock.calls[0][0].data);
    expect(received).toEqual(data);
  });

  it("should call onclose when connection closes", () => {
    const port = createPeerJsPort(mockConn);
    const handler = vi.fn();
    port.onclose = handler;
    port.start();

    mockConn.simulateClose();

    expect(handler).toHaveBeenCalled();
  });

  it("should call onerror on connection error", () => {
    const port = createPeerJsPort(mockConn);
    const handler = vi.fn();
    port.onerror = handler;
    port.start();

    const err = new Error("Connection failed");
    mockConn.simulateError(err);

    expect(handler).toHaveBeenCalledWith(err);
  });

  it("should close the underlying connection", () => {
    const port = createPeerJsPort(mockConn);

    port.close();

    expect(mockConn.close).toHaveBeenCalled();
  });
});
