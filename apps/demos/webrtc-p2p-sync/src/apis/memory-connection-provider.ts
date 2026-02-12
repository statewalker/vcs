/**
 * In-memory IPeerConnectionProvider for testing.
 *
 * Uses MessageChannel directly — no PeerJS, no event emitter simulation.
 * Two classes: MemoryPeerRegistry (shared test singleton) and
 * MemoryConnectionProvider (per-peer instance).
 */

import type {
  IPeerConnectionProvider,
  PeerConnectionCallbacks,
  PeerConnectionResult,
  SessionId,
} from "./peer-connection-provider.js";

export class MemoryPeerRegistry {
  private hosts = new Map<string, PeerConnectionCallbacks>();
  private nextId = 1;

  generateId(): string {
    return `mem-peer-${this.nextId++}`;
  }

  registerHost(sessionId: string, callbacks: PeerConnectionCallbacks): void {
    this.hosts.set(sessionId, callbacks);
  }

  unregisterHost(sessionId: string): void {
    this.hosts.delete(sessionId);
  }

  connectToHost(sessionId: string, joinerId: string): PeerConnectionResult {
    const callbacks = this.hosts.get(sessionId);
    if (!callbacks) {
      throw new Error(`No host for session: ${sessionId}`);
    }
    const channel = new MessageChannel();

    // Deliver port1 to host asynchronously (matches PeerJS timing)
    setTimeout(() => {
      callbacks.onConnection(joinerId, channel.port1);
    }, 5);

    return { port: channel.port2, peerId: sessionId };
  }

  reset(): void {
    this.hosts.clear();
    this.nextId = 1;
  }
}

export class MemoryConnectionProvider implements IPeerConnectionProvider {
  private registry: MemoryPeerRegistry;
  private id: string;
  private sessionId: string | null = null;

  constructor(registry: MemoryPeerRegistry, id?: string) {
    this.registry = registry;
    this.id = id ?? registry.generateId();
  }

  async share(callbacks: PeerConnectionCallbacks): Promise<SessionId> {
    this.sessionId = this.id;
    this.registry.registerHost(this.sessionId, callbacks);
    return this.sessionId;
  }

  async connect(sessionId: SessionId): Promise<PeerConnectionResult> {
    const result = this.registry.connectToHost(sessionId, this.id);
    // Wait for the async onConnection callback to fire on the host side
    await new Promise((resolve) => setTimeout(resolve, 10));
    return result;
  }

  disconnect(): void {
    if (this.sessionId) {
      this.registry.unregisterHost(this.sessionId);
      this.sessionId = null;
    }
  }
}
