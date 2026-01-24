/**
 * Push report-status parser.
 *
 * Parses the server's response to a push operation.
 * The server sends status for each ref update.
 *
 * Based on JGit's ReceiveCommand.java and BaseReceivePack.java
 */

import { ServerError } from "./errors.js";
import type { Packet } from "./types.js";

/**
 * Status of a single ref update.
 */
export interface RefUpdateStatus {
  /** Ref name that was updated */
  refName: string;
  /** Whether the update succeeded */
  ok: boolean;
  /** Error message if failed */
  message?: string;
}

/**
 * Result of a push operation.
 */
export interface PushReportStatus {
  /** Whether the pack was unpacked successfully */
  unpackOk: boolean;
  /** Unpack error message if failed */
  unpackMessage?: string;
  /** Status of each ref update */
  refUpdates: RefUpdateStatus[];
  /** Overall success (unpack ok and all refs ok) */
  ok: boolean;
}

/**
 * Parse report-status from raw lines (shared implementation).
 *
 * This function provides the core parsing logic that can be used by both
 * the packet-based parser and HTTP client implementations.
 *
 * Format:
 * - unpack ok | unpack <error>
 * - ok <refname> | ng <refname> <reason>
 *
 * @param lines - Array of status lines to parse
 * @returns Parsed push report status
 */
export function parseReportStatusLines(lines: string[]): PushReportStatus {
  const result: PushReportStatus = {
    unpackOk: false,
    refUpdates: [],
    ok: false,
  };

  let firstLine = true;

  for (const rawLine of lines) {
    const line = rawLine.trim();
    if (!line) continue;

    if (firstLine) {
      // First line must be unpack status
      firstLine = false;
      if (line.startsWith("unpack ")) {
        const status = line.slice(7);
        if (status === "ok") {
          result.unpackOk = true;
        } else {
          result.unpackOk = false;
          result.unpackMessage = status;
        }
      }
    } else {
      // Subsequent lines are ref updates
      const refStatus = parseRefStatusLine(line);
      if (refStatus) {
        result.refUpdates.push(refStatus);
      }
    }
  }

  // Calculate overall success
  result.ok = result.unpackOk && result.refUpdates.every((r) => r.ok);

  return result;
}

/**
 * Parse report-status response from server.
 *
 * Format:
 * - unpack ok | unpack <error>
 * - ok <refname> | ng <refname> <reason>
 * - ...
 * - flush
 *
 * @param packets - Response packets from server
 */
export async function parseReportStatus(packets: AsyncIterable<Packet>): Promise<PushReportStatus> {
  const lines: string[] = [];

  for await (const packet of packets) {
    if (packet.type === "flush") {
      break;
    }

    if (packet.type !== "data" || !packet.data) {
      continue;
    }

    const line = new TextDecoder().decode(packet.data).trim();
    if (line) {
      lines.push(line);
    }
  }

  return parseReportStatusLines(lines);
}

/**
 * Parse a ref update status line.
 *
 * Format: "ok <refname>" or "ng <refname> <reason>"
 */
function parseRefStatusLine(line: string): RefUpdateStatus | undefined {
  if (line.startsWith("ok ")) {
    const refName = line.slice(3).trim();
    return {
      refName,
      ok: true,
    };
  }

  if (line.startsWith("ng ")) {
    const rest = line.slice(3);
    const spaceIdx = rest.indexOf(" ");

    if (spaceIdx === -1) {
      // No reason given
      return {
        refName: rest.trim(),
        ok: false,
      };
    }

    const refName = rest.slice(0, spaceIdx);
    const message = rest.slice(spaceIdx + 1).trim();

    return {
      refName,
      ok: false,
      message,
    };
  }

  // Unknown line format - ignore
  return undefined;
}

/**
 * Parse report-status-v2 response from server.
 *
 * Protocol v2 format has additional structure with option lines.
 * For now, we handle it similarly to v1.
 *
 * @param packets - Response packets from server
 */
export async function parseReportStatusV2(
  packets: AsyncIterable<Packet>,
): Promise<PushReportStatus> {
  // V2 format is similar but may have section markers
  // For basic implementation, we can use the same parser
  return parseReportStatus(packets);
}

/**
 * Convert push result to a human-readable summary.
 */
export function formatPushResult(result: PushReportStatus): string {
  const lines: string[] = [];

  if (result.unpackOk) {
    lines.push("Unpack: ok");
  } else {
    lines.push(`Unpack: FAILED - ${result.unpackMessage || "unknown error"}`);
  }

  for (const ref of result.refUpdates) {
    if (ref.ok) {
      lines.push(`  ${ref.refName}: ok`);
    } else {
      lines.push(`  ${ref.refName}: FAILED - ${ref.message || "rejected"}`);
    }
  }

  if (result.ok) {
    lines.push("\nPush successful");
  } else {
    lines.push("\nPush FAILED");
  }

  return lines.join("\n");
}

/**
 * Throw an error if push failed.
 */
export function assertPushSuccess(result: PushReportStatus): void {
  if (!result.unpackOk) {
    throw new ServerError(`Push failed: unpack error - ${result.unpackMessage || "unknown"}`);
  }

  const failures = result.refUpdates.filter((r) => !r.ok);
  if (failures.length > 0) {
    const messages = failures.map((f) => `${f.refName}: ${f.message || "rejected"}`);
    throw new ServerError(`Push failed:\n${messages.join("\n")}`);
  }
}
