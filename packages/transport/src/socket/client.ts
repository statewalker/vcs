/**
 * Git socket client implementation.
 *
 * Provides a DiscoverableConnection implementation over BidirectionalSocket
 * for git protocol communication. Suitable for P2P synchronization where
 * both peers communicate over a MessagePort-based socket.
 */

import type { DiscoverableConnection } from "../connection/types.js";
import { parseRefAdvertisement } from "../negotiation/ref-advertiser.js";
import { encodePacket, pktLineReader, pktLineWriter } from "../protocol/pkt-line-codec.js";
import type { Packet, RefAdvertisement } from "../protocol/types.js";
import type { BidirectionalSocket } from "./types.js";

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
}

/**
 * Create a Git protocol client over a BidirectionalSocket.
 *
 * The client implements the DiscoverableConnection interface for use
 * with the Git transport layer. It communicates using the native
 * git protocol format (not HTTP).
 *
 * @param socket - The underlying bidirectional socket
 * @param options - Client options
 * @returns A DiscoverableConnection interface
 */
export function createGitSocketClient(
  socket: BidirectionalSocket,
  options: GitSocketClientOptions,
): DiscoverableConnection {
  const { path, host = "localhost", service = "git-upload-pack" } = options;
  let connected = false;
  let refsDiscovered = false;
  let receivingPackets: AsyncIterable<Packet> | null = null;

  return {
    async discoverRefs(): Promise<RefAdvertisement> {
      if (!connected) {
        // Send initial git protocol request
        // Format: "<service> <path>\0host=<hostname>\0"
        const request = `${service} ${path}\0host=${host}\0`;
        await socket.write(encodePacket(request));
        connected = true;
      }

      if (refsDiscovered) {
        throw new Error("Refs already discovered");
      }

      // Read ref advertisement from server
      const packets = pktLineReader(socket.read());
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
        await socket.write(encoded);
      }
    },

    receive(): AsyncIterable<Packet> {
      // If we already have a packets iterator from discoverRefs, use it
      // Otherwise create a new one
      if (receivingPackets) {
        return receivingPackets;
      }
      return pktLineReader(socket.read());
    },

    async close(): Promise<void> {
      await socket.close();
    },
  };
}
