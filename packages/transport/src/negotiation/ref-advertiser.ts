/**
 * Reference advertisement parser.
 *
 * Parses the server's ref advertisement response during connection
 * establishment. The first line contains capabilities, subsequent
 * lines contain refs.
 *
 * Based on JGit's RefAdvertiser and BasePackConnection.readAdvertisedRefs()
 */

import { bytesToHex, hexToBytes } from "@webrun-vcs/utils/hash/utils";
import { parseCapabilities } from "../protocol/capabilities.js";
import { OBJECT_ID_STRING_LENGTH, ZERO_ID } from "../protocol/constants.js";
import { PackProtocolError } from "../protocol/errors.js";
import { packetDataToString } from "../protocol/pkt-line-codec.js";
import type { Packet, RefAdvertisement } from "../protocol/types.js";

/**
 * Parse server ref advertisement from packet stream.
 *
 * Format for first line:
 *   <object-id> <ref-name>\0<capability list>
 *
 * Subsequent lines:
 *   <object-id> <ref-name>
 *
 * Peeled tags have an extra line:
 *   <object-id> <ref-name>^{}
 */
export async function parseRefAdvertisement(
  packets: AsyncIterable<Packet>,
): Promise<RefAdvertisement> {
  const refs = new Map<string, Uint8Array>();
  const symrefs = new Map<string, string>();
  let capabilities = new Set<string>();
  let agent: string | undefined;
  let firstLine = true;

  for await (const packet of packets) {
    if (packet.type === "flush") {
      break;
    }
    if (packet.type !== "data" || !packet.data) {
      continue;
    }

    const line = packetDataToString(packet);

    if (firstLine) {
      firstLine = false;

      // First line has capabilities after null byte
      const nullIdx = line.indexOf("\0");
      if (nullIdx === -1) {
        // Empty repository or no capabilities
        parseRefLine(line, refs);
      } else {
        const refPart = line.slice(0, nullIdx);
        const capsPart = line.slice(nullIdx + 1);

        // Parse capabilities
        const parsed = parseCapabilities(capsPart);
        capabilities = parsed.capabilities;
        for (const [from, to] of parsed.symrefs) {
          symrefs.set(from, to);
        }
        agent = parsed.agent;

        // Parse ref (may be zero-id for empty repo)
        parseRefLine(refPart, refs);
      }
    } else {
      parseRefLine(line, refs);
    }
  }

  return { refs, capabilities, symrefs, agent };
}

/**
 * Parse a single ref line.
 */
function parseRefLine(line: string, refs: Map<string, Uint8Array>): void {
  const spaceIdx = line.indexOf(" ");
  if (spaceIdx === -1) {
    return;
  }

  const idHex = line.slice(0, spaceIdx);
  const refName = line.slice(spaceIdx + 1);

  if (!idHex || !refName) {
    return;
  }

  if (idHex.length !== OBJECT_ID_STRING_LENGTH) {
    throw new PackProtocolError(
      `Invalid object ID length: ${idHex.length} (expected ${OBJECT_ID_STRING_LENGTH})`,
    );
  }

  // Skip peeled refs for now (marked with ^{})
  // These provide the target object for annotated tags
  if (refName.endsWith("^{}")) {
    return;
  }

  // Skip zero ID (empty repository marker)
  if (idHex === ZERO_ID) {
    return;
  }

  refs.set(refName, hexToBytes(idHex));
}

/**
 * Format a ref for advertisement (server-side).
 */
export function formatRefLine(
  objectId: Uint8Array,
  refName: string,
  capabilities?: string,
): string {
  const idHex = bytesToHex(objectId);

  if (capabilities) {
    return `${idHex} ${refName}\0${capabilities}\n`;
  }
  return `${idHex} ${refName}\n`;
}

/**
 * Check if a ref name matches a prefix pattern.
 */
export function refMatchesPrefix(refName: string, prefix: string): boolean {
  if (prefix.endsWith("*")) {
    const base = prefix.slice(0, -1);
    return refName.startsWith(base);
  }
  return refName === prefix;
}

/**
 * Filter refs by patterns.
 *
 * @param refs - Map of ref names to object IDs
 * @param patterns - Array of patterns (supports trailing *)
 */
export function filterRefs(
  refs: Map<string, Uint8Array>,
  patterns?: string[],
): Map<string, Uint8Array> {
  if (!patterns || patterns.length === 0) {
    return refs;
  }

  const result = new Map<string, Uint8Array>();
  for (const [refName, objectId] of refs) {
    for (const pattern of patterns) {
      if (refMatchesPrefix(refName, pattern)) {
        result.set(refName, objectId);
        break;
      }
    }
  }
  return result;
}

/**
 * Get the default branch from symrefs (usually HEAD -> refs/heads/main).
 */
export function getDefaultBranch(symrefs: Map<string, string>): string | undefined {
  const target = symrefs.get("HEAD");
  if (target?.startsWith("refs/heads/")) {
    return target.slice("refs/heads/".length);
  }
  return undefined;
}
