/**
 * Tests for WebSocket port adapter.
 */

import { beforeEach, describe, expect, it, vi } from "vitest";
import { createWebSocketPort, createWebSocketPortFromOpen } from "../src/websocket-port.js";

// Mock WebSocket for testing
class MockWebSocket {
  static readonly CONNECTING = 0;
  static readonly OPEN = 1;
  static readonly CLOSING = 2;
  static readonly CLOSED = 3;

  readyState = MockWebSocket.OPEN;
  bufferedAmount = 0;
  binaryType: BinaryType = "blob";

  onopen: (() => void) | null = null;
  onclose: (() => void) | null = null;
  onerror: (() => void) | null = null;
  onmessage: ((e: { data: unknown }) => void) | null = null;

  send = vi.fn();
  close = vi.fn(() => {
    this.readyState = MockWebSocket.CLOSED;
    this.onclose?.();
  });
}

describe("createWebSocketPort", () => {
  let mockWs: MockWebSocket;

  beforeEach(() => {
    mockWs = new MockWebSocket();
  });

  it("should create port from WebSocket", () => {
    const port = createWebSocketPort(mockWs as unknown as WebSocket);

    expect(port.isOpen).toBe(true);
  });

  it("should set binaryType to arraybuffer on start", () => {
    const port = createWebSocketPort(mockWs as unknown as WebSocket);
    port.start();

    expect(mockWs.binaryType).toBe("arraybuffer");
  });

  it("should accept custom binaryType", () => {
    const port = createWebSocketPort(mockWs as unknown as WebSocket, {
      binaryType: "blob",
    });
    port.start();

    expect(mockWs.binaryType).toBe("blob");
  });

  it("should forward postMessage to WebSocket.send", () => {
    const port = createWebSocketPort(mockWs as unknown as WebSocket);
    const data = new Uint8Array([1, 2, 3]);

    port.postMessage(data);

    expect(mockWs.send).toHaveBeenCalledWith(data);
  });

  it("should throw when posting to non-open WebSocket", () => {
    mockWs.readyState = MockWebSocket.CLOSED;
    const port = createWebSocketPort(mockWs as unknown as WebSocket);

    expect(() => port.postMessage(new Uint8Array([1]))).toThrow("not open");
  });

  it("should expose bufferedAmount from WebSocket", () => {
    mockWs.bufferedAmount = 12345;
    const port = createWebSocketPort(mockWs as unknown as WebSocket);

    expect(port.bufferedAmount).toBe(12345);
  });

  it("should report isOpen based on readyState", () => {
    const port = createWebSocketPort(mockWs as unknown as WebSocket);

    expect(port.isOpen).toBe(true);

    mockWs.readyState = MockWebSocket.CLOSING;
    expect(port.isOpen).toBe(false);

    mockWs.readyState = MockWebSocket.CLOSED;
    expect(port.isOpen).toBe(false);

    mockWs.readyState = MockWebSocket.CONNECTING;
    expect(port.isOpen).toBe(false);
  });

  it("should forward incoming ArrayBuffer messages to onmessage", () => {
    const port = createWebSocketPort(mockWs as unknown as WebSocket);
    const handler = vi.fn();
    port.onmessage = handler;
    port.start();

    const data = new ArrayBuffer(8);
    mockWs.onmessage?.({ data });

    expect(handler).toHaveBeenCalledWith({ data });
  });

  it("should call onclose when WebSocket closes", () => {
    const port = createWebSocketPort(mockWs as unknown as WebSocket);
    const handler = vi.fn();
    port.onclose = handler;
    port.start();

    mockWs.close();

    expect(handler).toHaveBeenCalled();
  });

  it("should call onerror on WebSocket error", () => {
    const port = createWebSocketPort(mockWs as unknown as WebSocket);
    const handler = vi.fn();
    port.onerror = handler;
    port.start();

    mockWs.onerror?.();

    expect(handler).toHaveBeenCalledWith(expect.any(Error));
  });

  it("should close the underlying WebSocket", () => {
    const port = createWebSocketPort(mockWs as unknown as WebSocket);

    port.close();

    expect(mockWs.close).toHaveBeenCalled();
  });
});

describe("createWebSocketPortFromOpen", () => {
  it("should create port from open WebSocket", () => {
    const mockWs = new MockWebSocket();
    mockWs.readyState = MockWebSocket.OPEN;

    const port = createWebSocketPortFromOpen(mockWs as unknown as WebSocket);

    expect(port.isOpen).toBe(true);
  });

  it("should throw if WebSocket is not open", () => {
    const mockWs = new MockWebSocket();
    mockWs.readyState = MockWebSocket.CONNECTING;

    expect(() => createWebSocketPortFromOpen(mockWs as unknown as WebSocket)).toThrow(
      "OPEN state",
    );
  });
});
