/**
 * Pack file utilities for the Git transport protocol.
 */

/**
 * Creates an empty packfile (32 bytes: header + SHA-1 checksum).
 * Used when pushing ref deletions or updates that don't require object transfer.
 *
 * Format:
 * - Bytes 0-3: "PACK" signature
 * - Bytes 4-7: Version 2 (big-endian)
 * - Bytes 8-11: Object count 0 (big-endian)
 * - Bytes 12-31: SHA-1 checksum of bytes 0-11
 */
export function createEmptyPack(): Uint8Array {
  return new Uint8Array([
    // "PACK" signature
    0x50, 0x41, 0x43, 0x4b,
    // Version 2 (big-endian)
    0x00, 0x00, 0x00, 0x02,
    // 0 objects (big-endian)
    0x00, 0x00, 0x00, 0x00,
    // SHA-1 checksum of the 12-byte header above
    // SHA-1("PACK\x00\x00\x00\x02\x00\x00\x00\x00")
    0x02, 0x9d, 0x08, 0x82, 0x3b, 0xd8, 0xa8, 0xea, 0xb5, 0x10, 0xad, 0x6a, 0xc7, 0x5c, 0x82, 0x3c,
    0xfd, 0x3e, 0xd3, 0x1e,
  ]);
}
