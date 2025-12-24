/**
 * Protocol session for native Git protocol communication.
 *
 * Manages bidirectional protocol sessions over streams,
 * handling protocol version negotiation and command routing.
 *
 * This is the core component for git:// and ssh:// transports.
 *
 * Based on JGit's UploadPack and TransportGitSsh patterns.
 */

import {
  encodeFlush,
  encodePacket,
  packetDataToString,
  pktLineReader,
} from "../protocol/pkt-line-codec.js";
import type { GitBidirectionalStream, GitInputStream, GitOutputStream } from "./git-stream.js";

/**
 * Protocol version for native Git protocol.
 */
export type ProtocolVersion = "0" | "1" | "2";

/**
 * Service type for Git protocol.
 */
export type GitService = "git-upload-pack" | "git-receive-pack";

/**
 * Protocol session options.
 */
export interface ProtocolSessionOptions {
  /** Git service (upload-pack or receive-pack) */
  service: GitService;
  /** Requested protocol version */
  protocolVersion?: ProtocolVersion;
  /** Extra parameters for protocol negotiation */
  extraParameters?: string[];
}

/**
 * Protocol session state.
 */
export interface ProtocolSessionState {
  /** Negotiated protocol version */
  version: ProtocolVersion;
  /** Server capabilities */
  serverCapabilities: Set<string>;
  /** Whether session is active */
  active: boolean;
}

/**
 * Server-side protocol session handler.
 *
 * Handles incoming connections for git-upload-pack or git-receive-pack.
 */
export class ServerProtocolSession {
  private state: ProtocolSessionState;

  constructor(
    private stream: GitBidirectionalStream,
    options: ProtocolSessionOptions,
  ) {
    this.state = {
      version: options.protocolVersion ?? "0",
      serverCapabilities: new Set(),
      active: true,
    };
  }

  /**
   * Get the current protocol state.
   */
  getState(): ProtocolSessionState {
    return { ...this.state };
  }

  /**
   * Get the input stream for reading client requests.
   */
  getInput(): GitInputStream {
    return this.stream.input;
  }

  /**
   * Get the output stream for writing responses.
   */
  getOutput(): GitOutputStream {
    return this.stream.output;
  }

  /**
   * Read the Git protocol header line.
   *
   * For git:// protocol, the first line is:
   * "git-upload-pack /path/to/repo.git\0host=hostname\0"
   *
   * @returns Parsed header information
   */
  async readHeader(): Promise<{
    service: GitService;
    path: string;
    host?: string;
    extraParams: string[];
  }> {
    // Read the first packet
    const input = this.stream.input;

    // For git:// protocol, first line contains service and path
    const firstChunk = await input.read(4);
    if (firstChunk.length < 4) {
      throw new Error("Invalid protocol header: too short");
    }

    // Parse length
    const lengthStr = new TextDecoder().decode(firstChunk);
    const length = parseInt(lengthStr, 16);

    if (length === 0) {
      throw new Error("Invalid protocol header: flush packet");
    }

    // Read rest of packet
    const payload = await input.read(length - 4);
    const line = new TextDecoder().decode(payload);

    // Parse: "git-upload-pack /path\0host=...\0extra\0"
    const parts = line.split("\0").filter((p) => p.length > 0);
    const firstPart = parts[0] ?? "";

    let service: GitService;
    let path: string;

    if (firstPart.startsWith("git-upload-pack ")) {
      service = "git-upload-pack";
      path = firstPart.slice(16).trim();
    } else if (firstPart.startsWith("git-receive-pack ")) {
      service = "git-receive-pack";
      path = firstPart.slice(17).trim();
    } else {
      throw new Error(`Unknown service: ${firstPart}`);
    }

    // Parse extra parameters
    const extraParams: string[] = [];
    let host: string | undefined;

    for (let i = 1; i < parts.length; i++) {
      const part = parts[i];
      if (part.startsWith("host=")) {
        host = part.slice(5);
      } else if (part.startsWith("version=")) {
        // Protocol version request
        const version = part.slice(8);
        if (version === "2") {
          this.state.version = "2";
        } else if (version === "1") {
          this.state.version = "1";
        }
        extraParams.push(part);
      } else {
        extraParams.push(part);
      }
    }

    return { service, path, host, extraParams };
  }

  /**
   * Write a packet to the output.
   */
  async writePacket(data: string): Promise<void> {
    const packet = encodePacket(data);
    await this.stream.output.write(packet);
  }

  /**
   * Write a flush packet.
   */
  async writeFlush(): Promise<void> {
    const packet = encodeFlush();
    await this.stream.output.write(packet);
  }

  /**
   * Flush the output stream.
   */
  async flush(): Promise<void> {
    await this.stream.output.flush();
  }

  /**
   * Close the session.
   */
  async close(): Promise<void> {
    this.state.active = false;
    await this.stream.close();
  }

  /**
   * Create an async iterable for reading packets.
   */
  async *readPackets(): AsyncGenerator<{
    type: "data" | "flush" | "delim" | "end";
    data?: string;
  }> {
    const reader = pktLineReader(this.stream.input);
    for await (const packet of reader) {
      if (packet.type === "flush") {
        yield { type: "flush" };
      } else if (packet.type === "delim") {
        yield { type: "delim" };
      } else if (packet.type === "end") {
        yield { type: "end" };
      } else if (packet.type === "data" && packet.data) {
        yield { type: "data", data: packetDataToString(packet) };
      }
    }
  }
}

/**
 * Client-side protocol session handler.
 *
 * Initiates connections to remote Git servers.
 */
export class ClientProtocolSession {
  private state: ProtocolSessionState;

  constructor(
    private stream: GitBidirectionalStream,
    private options: ProtocolSessionOptions,
  ) {
    this.state = {
      version: options.protocolVersion ?? "0",
      serverCapabilities: new Set(),
      active: true,
    };
  }

  /**
   * Get the current protocol state.
   */
  getState(): ProtocolSessionState {
    return { ...this.state };
  }

  /**
   * Send the Git protocol header line.
   *
   * @param path - Repository path
   * @param host - Optional hostname
   */
  async sendHeader(path: string, host?: string): Promise<void> {
    const service = this.options.service;
    const parts = [`${service} ${path}`];

    if (host) {
      parts.push(`host=${host}`);
    }

    // Add protocol version if not v0
    if (this.options.protocolVersion && this.options.protocolVersion !== "0") {
      parts.push(`version=${this.options.protocolVersion}`);
    }

    // Add extra parameters
    if (this.options.extraParameters) {
      parts.push(...this.options.extraParameters);
    }

    // Build packet with NUL separators
    const line = `${parts.join("\0")}\0`;
    await this.writePacket(line);
  }

  /**
   * Read server capabilities from the ref advertisement.
   *
   * @returns Server refs and capabilities
   */
  async readRefAdvertisement(): Promise<{
    refs: Array<{ objectId: string; name: string }>;
    capabilities: Set<string>;
  }> {
    const refs: Array<{ objectId: string; name: string }> = [];
    const capabilities = new Set<string>();
    let isFirst = true;

    const reader = pktLineReader(this.stream.input);

    for await (const packet of reader) {
      if (packet.type === "flush") {
        break;
      }

      if (packet.type !== "data" || !packet.data) {
        continue;
      }

      const line = packetDataToString(packet);

      if (isFirst) {
        // First line has format: "objectId refname\0capabilities..."
        const nullIdx = line.indexOf("\0");
        if (nullIdx !== -1) {
          const refPart = line.slice(0, nullIdx);
          const capsPart = line.slice(nullIdx + 1);

          // Parse ref
          const spaceIdx = refPart.indexOf(" ");
          if (spaceIdx !== -1) {
            refs.push({
              objectId: refPart.slice(0, spaceIdx),
              name: refPart.slice(spaceIdx + 1).trim(),
            });
          }

          // Parse capabilities
          for (const cap of capsPart.split(" ")) {
            if (cap) {
              capabilities.add(cap);
            }
          }
        }
        isFirst = false;
      } else {
        // Subsequent lines: "objectId refname"
        const spaceIdx = line.indexOf(" ");
        if (spaceIdx !== -1) {
          refs.push({
            objectId: line.slice(0, spaceIdx),
            name: line.slice(spaceIdx + 1).trim(),
          });
        }
      }
    }

    this.state.serverCapabilities = capabilities;
    return { refs, capabilities };
  }

  /**
   * Write a packet to the output.
   */
  async writePacket(data: string): Promise<void> {
    const packet = encodePacket(data);
    await this.stream.output.write(packet);
  }

  /**
   * Write a flush packet.
   */
  async writeFlush(): Promise<void> {
    const packet = encodeFlush();
    await this.stream.output.write(packet);
  }

  /**
   * Flush the output stream.
   */
  async flush(): Promise<void> {
    await this.stream.output.flush();
  }

  /**
   * Close the session.
   */
  async close(): Promise<void> {
    this.state.active = false;
    await this.stream.close();
  }

  /**
   * Create an async iterable for reading packets.
   */
  async *readPackets(): AsyncGenerator<{
    type: "data" | "flush" | "delim" | "end";
    data?: string;
  }> {
    const reader = pktLineReader(this.stream.input);
    for await (const packet of reader) {
      if (packet.type === "flush") {
        yield { type: "flush" };
      } else if (packet.type === "delim") {
        yield { type: "delim" };
      } else if (packet.type === "end") {
        yield { type: "end" };
      } else if (packet.type === "data" && packet.data) {
        yield { type: "data", data: packetDataToString(packet) };
      }
    }
  }
}
