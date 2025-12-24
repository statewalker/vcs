/**
 * Pack file receiver with streaming support.
 *
 * Receives pack data from a transport connection, handling sideband
 * demultiplexing and progress reporting.
 *
 * Based on JGit's BasePackFetchConnection.receivePack()
 */

import { SIDEBAND_DATA, SIDEBAND_PROGRESS } from "../protocol/constants.js";
import { demuxSideband } from "../protocol/sideband.js";
import type { Packet, ProgressInfo } from "../protocol/types.js";

/**
 * Result of receiving a pack.
 */
export interface PackReceiveResult {
  /** Raw pack data */
  packData: Uint8Array;
  /** Total bytes received */
  bytesReceived: number;
  /** Progress messages received */
  progressMessages: string[];
}

/**
 * Options for pack receiver.
 */
export interface PackReceiverOptions {
  /** Progress callback */
  onProgress?: (info: ProgressInfo) => void;
  /** Raw progress message callback */
  onProgressMessage?: (message: string) => void;
}

/**
 * Receive pack data from a packet stream.
 *
 * This function handles:
 * 1. Sideband demultiplexing (if server uses sideband)
 * 2. Progress message extraction
 * 3. Pack data collection
 */
export async function receivePack(
  packets: AsyncIterable<Packet>,
  options: PackReceiverOptions = {},
): Promise<PackReceiveResult> {
  const { onProgress, onProgressMessage } = options;
  const chunks: Uint8Array[] = [];
  const progressMessages: string[] = [];
  let bytesReceived = 0;

  // Demultiplex sideband
  const sideband = demuxSideband(packets);

  for await (const msg of sideband) {
    if (msg.channel === SIDEBAND_DATA) {
      chunks.push(msg.data);
      bytesReceived += msg.data.length;
    } else if (msg.channel === SIDEBAND_PROGRESS) {
      const message = new TextDecoder().decode(msg.data);
      progressMessages.push(message);

      if (onProgressMessage) {
        onProgressMessage(message);
      }

      if (onProgress) {
        const parsed = parseProgressMessage(message);
        if (parsed) {
          onProgress(parsed);
        }
      }
    }
  }

  // Combine chunks into single pack
  const packData = concatChunks(chunks);

  return {
    packData,
    bytesReceived,
    progressMessages,
  };
}

/**
 * Stream pack data from a packet stream.
 *
 * This is a streaming version that yields pack chunks as they arrive.
 */
export async function* streamPackData(
  packets: AsyncIterable<Packet>,
  options: PackReceiverOptions = {},
): AsyncGenerator<Uint8Array> {
  const { onProgress, onProgressMessage } = options;
  const sideband = demuxSideband(packets);

  for await (const msg of sideband) {
    if (msg.channel === SIDEBAND_DATA) {
      yield msg.data;
    } else if (msg.channel === SIDEBAND_PROGRESS) {
      const message = new TextDecoder().decode(msg.data);

      if (onProgressMessage) {
        onProgressMessage(message);
      }

      if (onProgress) {
        const parsed = parseProgressMessage(message);
        if (parsed) {
          onProgress(parsed);
        }
      }
    }
  }
}

/**
 * Parse a git progress message.
 *
 * Formats:
 * - "remote: Counting objects: 123"
 * - "Receiving objects:  45% (123/456)"
 * - "Resolving deltas: 100% (456/456), done."
 */
export function parseProgressMessage(message: string): ProgressInfo | null {
  // Remove "remote: " prefix if present
  let msg = message.trim();
  if (msg.startsWith("remote: ")) {
    msg = msg.slice(8);
  }

  // Match: "Stage: N% (current/total)"
  const percentMatch = msg.match(/^(.+?):\s*(\d+)%\s*\((\d+)\/(\d+)\)/);
  if (percentMatch) {
    return {
      stage: percentMatch[1].trim(),
      percent: parseInt(percentMatch[2], 10),
      current: parseInt(percentMatch[3], 10),
      total: parseInt(percentMatch[4], 10),
    };
  }

  // Match: "Stage: N% ... done"
  const doneMatch = msg.match(/^(.+?):\s*(\d+)%.*done/i);
  if (doneMatch) {
    return {
      stage: doneMatch[1].trim(),
      percent: 100,
      current: 0,
      total: 0,
    };
  }

  // Match: "Stage: N"
  const countMatch = msg.match(/^(.+?):\s*(\d+)$/);
  if (countMatch) {
    return {
      stage: countMatch[1].trim(),
      current: parseInt(countMatch[2], 10),
    };
  }

  return null;
}

/**
 * Concatenate chunks into a single Uint8Array.
 */
function concatChunks(chunks: Uint8Array[]): Uint8Array {
  const totalLength = chunks.reduce((sum, chunk) => sum + chunk.length, 0);
  const result = new Uint8Array(totalLength);
  let offset = 0;
  for (const chunk of chunks) {
    result.set(chunk, offset);
    offset += chunk.length;
  }
  return result;
}

/**
 * Verify pack data starts with valid pack header.
 */
export function verifyPackHeader(data: Uint8Array): {
  valid: boolean;
  version?: number;
  objectCount?: number;
  error?: string;
} {
  if (data.length < 12) {
    return { valid: false, error: "Pack data too short" };
  }

  // Check magic "PACK"
  const magic = String.fromCharCode(data[0], data[1], data[2], data[3]);
  if (magic !== "PACK") {
    return { valid: false, error: `Invalid pack magic: ${magic}` };
  }

  // Version (should be 2 or 3)
  const version = (data[4] << 24) | (data[5] << 16) | (data[6] << 8) | data[7];
  if (version !== 2 && version !== 3) {
    return { valid: false, error: `Unsupported pack version: ${version}` };
  }

  // Object count
  const objectCount = (data[8] << 24) | (data[9] << 16) | (data[10] << 8) | data[11];

  return { valid: true, version, objectCount };
}
