/**
 * Pack delta transfer utilities
 *
 * High-level functions for importing pack data into delta storage
 * and exporting objects from delta storage for pack creation.
 *
 * These utilities bridge the gap between transport layer (pack data)
 * and storage layer (DeltaStorageManager).
 */

import { serializeDeltaToGit } from "@webrun-vcs/utils";
import type { DeltaStorageManager, ObjectId, StoredDelta } from "@webrun-vcs/vcs";
import { type GitObjectType, parsePackEntries } from "./pack-entries-parser.js";

/**
 * Result of importing pack as deltas
 */
export interface ImportPackResult {
  /** Number of base objects imported */
  baseCount: number;
  /** Number of delta objects imported */
  deltaCount: number;
  /** Total number of objects imported */
  totalCount: number;
  /** Object IDs that were imported */
  importedIds: string[];
  /** Errors encountered during import (non-fatal) */
  errors: Array<{ id: string; error: string }>;
}

/**
 * Options for importing pack as deltas
 */
export interface ImportPackOptions {
  /** Skip objects that already exist in storage */
  skipExisting?: boolean;
  /** Verify delta application produces correct content */
  verify?: boolean;
  /** Progress callback */
  onProgress?: (current: number, total: number) => void;
}

/**
 * Import pack data into delta storage.
 *
 * This function parses the pack, preserves delta relationships,
 * and stores objects using DeltaStorageManager's storeDelta() method.
 *
 * @param storage Delta storage manager
 * @param packData Raw pack file bytes
 * @param options Import options
 * @returns Import result with statistics
 */
export async function importPackAsDeltas(
  storage: DeltaStorageManager,
  packData: Uint8Array,
  options?: ImportPackOptions,
): Promise<ImportPackResult> {
  const { skipExisting = false, onProgress } = options ?? {};

  // Parse pack entries with delta information preserved
  const parsed = await parsePackEntries(packData);
  const entries = parsed.entries;

  let baseCount = 0;
  let deltaCount = 0;
  const importedIds: string[] = [];
  const errors: Array<{ id: string; error: string }> = [];

  for (let i = 0; i < entries.length; i++) {
    const entry = entries[i];

    if (onProgress) {
      onProgress(i + 1, entries.length);
    }

    try {
      // Check if object already exists
      if (skipExisting && (await storage.has(entry.id))) {
        continue;
      }

      if (entry.type === "base") {
        // Store base object as full content
        await storage.store([entry.content]);
        baseCount++;
      } else {
        // Store delta using manager's storeDelta method
        // This handles validation and cleanup
        await storage.storeDelta(entry.id, entry.baseId, entry.delta);
        deltaCount++;
      }

      importedIds.push(entry.id);
    } catch (error) {
      errors.push({
        id: entry.id,
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }

  return {
    baseCount,
    deltaCount,
    totalCount: baseCount + deltaCount,
    importedIds,
    errors,
  };
}

/**
 * Object for pack export
 */
export interface ExportPackObject {
  /** Object ID */
  id: string;
  /** Object type */
  objectType: GitObjectType;
  /** Whether this is a delta */
  isDelta: boolean;
  /** If delta: base object ID */
  baseId?: string;
  /** If delta: delta data in Git binary format */
  deltaData?: Uint8Array;
  /** If base: full content */
  content?: Uint8Array;
}

/**
 * Options for exporting objects for pack
 */
export interface ExportForPackOptions {
  /** Include delta relationships (default: true) */
  preserveDeltas?: boolean;
}

/**
 * Export objects from delta storage for pack creation.
 *
 * This generator yields objects in a format suitable for PackWriterStream.
 * Delta objects include their delta data in Git binary format.
 *
 * @param storage Delta storage manager
 * @param objectIds Objects to export
 * @param options Export options
 */
export async function* exportForPack(
  storage: DeltaStorageManager,
  objectIds: ObjectId[],
  options?: ExportForPackOptions,
): AsyncGenerator<ExportPackObject> {
  const { preserveDeltas = true } = options ?? {};

  for (const id of objectIds) {
    // Try to load as delta
    let stored: StoredDelta | undefined;
    if (preserveDeltas) {
      stored = await storage.loadDelta(id);
    }

    if (stored && stored.delta.length > 0) {
      // Export as delta
      const deltaData = serializeDeltaToGit(stored.delta);

      // Get object type from content
      const objectType = await getObjectType(storage, id);

      yield {
        id,
        objectType,
        isDelta: true,
        baseId: stored.baseId,
        deltaData,
      };
    } else {
      // Export as base object (full content)
      const content = await loadFullContent(storage, id);
      const objectType = await getObjectType(storage, id);

      yield {
        id,
        objectType,
        isDelta: false,
        content,
      };
    }
  }
}

/**
 * Collect all objects needed for a pack, ordered by dependencies.
 *
 * This ensures base objects come before deltas that reference them.
 *
 * @param storage Delta storage manager
 * @param rootIds Starting object IDs (usually commits)
 * @returns Object IDs in dependency order
 */
export async function collectObjectsForPack(
  storage: DeltaStorageManager,
  rootIds: ObjectId[],
): Promise<ObjectId[]> {
  const visited = new Set<ObjectId>();
  const result: ObjectId[] = [];

  // Simple DFS to collect all reachable objects
  // In a real implementation, this would walk commits/trees
  async function visit(id: ObjectId): Promise<void> {
    if (visited.has(id)) return;
    visited.add(id);

    // Check if this is a delta and visit base first
    const stored = await storage.loadDelta(id);
    if (stored?.baseId) {
      await visit(stored.baseId);
    }

    result.push(id);
  }

  for (const id of rootIds) {
    await visit(id);
  }

  return result;
}

/**
 * Load full content of an object
 */
async function loadFullContent(storage: DeltaStorageManager, id: ObjectId): Promise<Uint8Array> {
  const chunks: Uint8Array[] = [];
  for await (const chunk of storage.load(id)) {
    chunks.push(chunk);
  }

  if (chunks.length === 0) {
    throw new Error(`Object ${id} not found`);
  }

  if (chunks.length === 1) {
    return chunks[0];
  }

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
 * Get object type (simplified - in real implementation would parse content)
 */
async function getObjectType(storage: DeltaStorageManager, id: ObjectId): Promise<GitObjectType> {
  // For now, return "blob" as default
  // A real implementation would:
  // 1. Check if storage tracks object types
  // 2. Parse the content to determine type
  // 3. Use git object header format

  // Try to get from delta chain info
  const chainInfo = await storage.getDeltaChainInfo(id);
  if (chainInfo) {
    // DeltaChainDetails doesn't include type, so we can't determine it here
    // This would need to be added to the interface
  }

  return "blob";
}
