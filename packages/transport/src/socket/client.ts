/**
 * Git socket client implementation.
 *
 * Provides a DiscoverableConnection implementation over MessagePort
 * for git protocol communication. Suitable for P2P synchronization where
 * both peers communicate over a MessagePort-based channel.
 */

import type { DiscoverableConnection } from "../connection/types.js";
import { parseRefAdvertisement } from "../negotiation/ref-advertiser.js";
import {
  encodeFlush,
  encodePacket,
  pktLineReader,
  pktLineWriter,
} from "../protocol/pkt-line-codec.js";
import type { Packet, RefAdvertisement } from "../protocol/types.js";
import {
  createMessagePortCloser,
  createMessagePortReader,
  createMessagePortWriter,
} from "./messageport-adapters.js";

/**
 * External IO handles for shared reader/writer across operations.
 *
 * When a port is shared across multiple operations, create the reader/writer
 * once and pass them to all clients. This prevents data loss that occurs
 * when multiple readers are created on the same port (each reader has
 * event listeners that get removed on close, losing any buffered data).
 */
export interface ExternalIOHandles {
  /** Shared input reader - async generator yielding Uint8Array chunks */
  input: AsyncGenerator<Uint8Array>;
  /** Shared write function */
  write: (data: Uint8Array) => Promise<void>;
  /** Close function for the port (only called when ownsPort=true) */
  close: () => Promise<void>;
}

/**
 * Options for creating a Git socket client.
 */
export interface GitSocketClientOptions {
  /** Repository path (e.g., "/repo.git" or "user/repo") */
  path: string;
  /** Host identifier (defaults to "localhost") */
  host?: string;
  /** Git service type (defaults to "git-upload-pack") */
  service?: "git-upload-pack" | "git-receive-pack";
  /**
   * Whether this client owns the port.
   * If true, close() will close the underlying port.
   * If false (default), close() only cleans up the reader.
   * Set to false when sharing a port across multiple operations.
   */
  ownsPort?: boolean;
  /**
   * External IO handles for shared reader/writer.
   *
   * When provided, the client uses these instead of creating its own
   * from the port. This is CRITICAL when sharing a port across multiple
   * sequential operations (like fetch followed by push) to prevent
   * data loss between operations.
   *
   * When using external handles, the client will NOT call return() on
   * the input generator during close() - the handles remain usable for
   * subsequent operations.
   */
  externalIO?: ExternalIOHandles;
}

/**
 * Create a Git protocol client over a MessagePort.
 *
 * The client implements the DiscoverableConnection interface for use
 * with the Git transport layer. It communicates using the native
 * git protocol format (not HTTP).
 *
 * @param port - The MessagePort for communication
 * @param options - Client options
 * @returns A DiscoverableConnection interface
 */
export function createGitSocketClient(
  port: MessagePort,
  options: GitSocketClientOptions,
): DiscoverableConnection {
  const {
    path,
    host = "localhost",
    service = "git-upload-pack",
    ownsPort = false,
    externalIO,
  } = options;

  // Use external IO handles if provided, otherwise create from port
  const usingExternalIO = !!externalIO;
  const input = externalIO?.input ?? createMessagePortReader(port);
  const write = externalIO?.write ?? createMessagePortWriter(port);
  const fullClose = externalIO?.close ?? createMessagePortCloser(port, input);

  let connected = false;
  let refsDiscovered = false;
  let receivingPackets: AsyncIterable<Packet> | null = null;
  let protocolComplete = false; // Track if protocol was properly terminated

  return {
    async sendRaw(data: Uint8Array): Promise<void> {
      // Send raw bytes directly without pkt-line encoding.
      // Note: This is typically NOT what you want for socket protocol.
      // Use sendPacketsAndPack instead for push operations.
      await write(data);
    },

    async sendPacketsAndPack(
      packets: AsyncIterable<Packet>,
      packData: Uint8Array,
    ): Promise<void> {
      // Send command packets (pkt-line encoded)
      for await (const encoded of pktLineWriter(packets)) {
        await write(encoded);
      }

      // Send pack data as pkt-line encoded packets.
      // In standard Git protocol, pack data is sent raw after commands.
      // But for socket/P2P protocol, we wrap it in pkt-line packets so the
      // server's pktLineReader can parse it correctly.
      // Split into chunks if large (max pkt-line data is 65516 bytes)
      const MAX_PKT_DATA = 65516;
      for (let offset = 0; offset < packData.length; offset += MAX_PKT_DATA) {
        const chunk = packData.subarray(offset, Math.min(offset + MAX_PKT_DATA, packData.length));
        await write(encodePacket(chunk));
      }

      // Send flush to indicate end of pack data
      await write(encodeFlush());
      protocolComplete = true;
    },

    async discoverRefs(): Promise<RefAdvertisement> {
      if (!connected) {
        // Send initial git protocol request
        // Format: "<service> <path>\0host=<hostname>\0"
        const request = `${service} ${path}\0host=${host}\0`;
        await write(encodePacket(request));
        connected = true;
      }

      if (refsDiscovered) {
        throw new Error("Refs already discovered");
      }

      // Read ref advertisement from server
      const packets = pktLineReader(input);
      const advertisement = await parseRefAdvertisement(packets);
      refsDiscovered = true;

      // Store the packets iterator for subsequent receive() calls
      // Note: The same read stream continues after ref advertisement
      receivingPackets = packets;

      return advertisement;
    },

    async send(packets: AsyncIterable<Packet>): Promise<void> {
      // Encode and send packets to server
      for await (const encoded of pktLineWriter(packets)) {
        await write(encoded);
      }
      // After sending packets, mark protocol as complete
      // (the packets should include a "done" packet to properly terminate)
      protocolComplete = true;
    },

    receive(): AsyncIterable<Packet> {
      // If we already have a packets iterator from discoverRefs, use it
      // Otherwise create a new one
      if (receivingPackets) {
        return receivingPackets;
      }
      return pktLineReader(input);
    },

    async close(): Promise<void> {
      // If we connected and discovered refs but didn't complete the protocol,
      // send a proper termination sequence so the server can move to the next request
      if (refsDiscovered && !protocolComplete) {
        try {
          if (service === "git-upload-pack") {
            // upload-pack expects: flush (end of wants) + done
            await write(encodeFlush());
            await write(encodePacket("done\n"));
          } else {
            // receive-pack expects: flush (empty command list = no updates)
            await write(encodeFlush());
          }
          protocolComplete = true;

          // IMPORTANT: Drain the server's response to prevent stale data
          // from polluting the port for the next operation
          const packets = receivingPackets || pktLineReader(input);
          for await (const packet of packets) {
            if (packet.type === "flush") {
              // Flush signals end of server response
              break;
            }
          }
        } catch {
          // Continue with cleanup even if termination fails
        }
      }

      if (ownsPort) {
        // Full close: send close signal, cleanup reader, close port
        await fullClose();
      } else if (!usingExternalIO) {
        // Partial close: just cleanup the reader (remove event listeners)
        // Only do this when NOT using external IO - with external IO,
        // the caller manages the reader lifecycle
        try {
          await input.return(undefined);
        } catch {
          // Ignore errors from generator cleanup
        }
      }
      // When using external IO, don't touch the input - it's shared
    },
  };
}
