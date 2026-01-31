/**
 * Git binary format layer
 *
 * Handles Git-specific binary formats:
 * - Pack files (.pack, .idx)
 * - Object storage format
 * - Reference format
 */

export * from "./pack/index.js";
