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

  it("should return a standard MessagePort", () => {
    const port = createWebSocketPort(mockWs as unknown as WebSocket);

    // Standard MessagePort interface
    expect(port).toBeDefined();
    expect(port.postMessage).toBeDefined();
    expect(port.close).toBeDefined();
    expect(port.start).toBeDefined();
    expect(port.addEventListener).toBeDefined();
    expect(port.removeEventListener).toBeDefined();
  });

  it("should set binaryType to arraybuffer by default", () => {
    createWebSocketPort(mockWs as unknown as WebSocket);

    expect(mockWs.binaryType).toBe("arraybuffer");
  });

  it("should accept custom binaryType", () => {
    createWebSocketPort(mockWs as unknown as WebSocket, {
      binaryType: "blob",
    });

    expect(mockWs.binaryType).toBe("blob");
  });

  it("should forward postMessage to WebSocket.send", async () => {
    const port = createWebSocketPort(mockWs as unknown as WebSocket);
    port.start();

    const data = new Uint8Array([1, 2, 3]);
    port.postMessage(data);

    // Allow the internal port2.onmessage to process
    await new Promise((resolve) => setTimeout(resolve, 0));

    expect(mockWs.send).toHaveBeenCalled();
    const sentData = mockWs.send.mock.calls[0][0];
    expect(sentData).toBeInstanceOf(Uint8Array);
    expect(new Uint8Array(sentData)).toEqual(data);
  });

  it("should not forward messages when WebSocket is closed", async () => {
    mockWs.readyState = MockWebSocket.CLOSED;
    const port = createWebSocketPort(mockWs as unknown as WebSocket);
    port.start();

    port.postMessage(new Uint8Array([1, 2, 3]));

    await new Promise((resolve) => setTimeout(resolve, 0));

    // Should not throw, just silently not send
    expect(mockWs.send).not.toHaveBeenCalled();
  });

  it("should forward incoming ArrayBuffer messages via message event", async () => {
    const port = createWebSocketPort(mockWs as unknown as WebSocket);
    const handler = vi.fn();
    port.addEventListener("message", handler);
    port.start();

    const data = new ArrayBuffer(3);
    new Uint8Array(data).set([1, 2, 3]);
    mockWs.onmessage?.({ data });

    // Allow message to propagate through the MessageChannel
    await new Promise((resolve) => setTimeout(resolve, 0));

    expect(handler).toHaveBeenCalled();
    const received = new Uint8Array(handler.mock.calls[0][0].data);
    expect(received).toEqual(new Uint8Array([1, 2, 3]));
  });

  it("should send null on WebSocket close (EOF signal)", async () => {
    const port = createWebSocketPort(mockWs as unknown as WebSocket);
    const handler = vi.fn();
    port.addEventListener("message", handler);
    port.start();

    mockWs.close();

    await new Promise((resolve) => setTimeout(resolve, 0));

    // Should receive null as end-of-stream signal
    expect(handler).toHaveBeenCalled();
    expect(handler.mock.calls[0][0].data).toBe(null);
  });

  it("should support multiple message listeners", async () => {
    const port = createWebSocketPort(mockWs as unknown as WebSocket);
    const handler1 = vi.fn();
    const handler2 = vi.fn();
    port.addEventListener("message", handler1);
    port.addEventListener("message", handler2);
    port.start();

    const data = new ArrayBuffer(3);
    new Uint8Array(data).set([7, 8, 9]);
    mockWs.onmessage?.({ data });

    await new Promise((resolve) => setTimeout(resolve, 0));

    expect(handler1).toHaveBeenCalled();
    expect(handler2).toHaveBeenCalled();
  });

  it("should support removeEventListener", async () => {
    const port = createWebSocketPort(mockWs as unknown as WebSocket);
    const handler = vi.fn();
    port.addEventListener("message", handler);
    port.removeEventListener("message", handler);
    port.start();

    const data = new ArrayBuffer(3);
    mockWs.onmessage?.({ data });

    await new Promise((resolve) => setTimeout(resolve, 0));

    expect(handler).not.toHaveBeenCalled();
  });

  it("should convert string data to Uint8Array", async () => {
    const port = createWebSocketPort(mockWs as unknown as WebSocket);
    const handler = vi.fn();
    port.addEventListener("message", handler);
    port.start();

    mockWs.onmessage?.({ data: "hello" });

    await new Promise((resolve) => setTimeout(resolve, 0));

    expect(handler).toHaveBeenCalled();
    const received = new TextDecoder().decode(handler.mock.calls[0][0].data);
    expect(received).toBe("hello");
  });
});

describe("createWebSocketPortFromOpen", () => {
  it("should create port from open WebSocket", () => {
    const mockWs = new MockWebSocket();
    mockWs.readyState = MockWebSocket.OPEN;

    const port = createWebSocketPortFromOpen(mockWs as unknown as WebSocket);

    expect(port).toBeDefined();
    // Standard MessagePort methods
    expect(port.postMessage).toBeDefined();
    expect(port.start).toBeDefined();
  });

  it("should throw if WebSocket is not open", () => {
    const mockWs = new MockWebSocket();
    mockWs.readyState = MockWebSocket.CONNECTING;

    expect(() => createWebSocketPortFromOpen(mockWs as unknown as WebSocket)).toThrow("OPEN state");
  });
});
