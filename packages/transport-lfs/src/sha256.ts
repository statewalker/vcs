import { createHash } from "node:crypto";

/**
 * The authoritative LFS object id: whole-object SHA-256 as bare lowercase hex.
 * SHA-256 is mandated by the LFS spec, so it is fixed here (not injected).
 */
export function sha256Hex(bytes: Uint8Array): string {
  return createHash("sha256").update(bytes).digest("hex");
}
