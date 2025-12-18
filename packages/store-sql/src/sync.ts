/**
 * Synchronization utilities for dual-store architecture
 *
 * These utilities enable data transfer between:
 * - Git-compatible streaming stores (for Git interop/transport)
 * - Native SQL stores (for queries and application logic)
 *
 * Both store types produce identical Git object IDs, so synchronization
 * is straightforward - load from source, store to destination.
 */

import type { GitStores, ObjectId } from "@webrun-vcs/vcs";
import type { SqlNativeStores } from "./native/types.js";

/**
 * Object type for synchronization
 */
export type SyncObjectType = "commit" | "tree" | "blob" | "tag";

/**
 * Object reference for synchronization
 */
export interface SyncObject {
  id: ObjectId;
  type: SyncObjectType;
}

/**
 * Import Git objects into native SQL store format
 *
 * Use after fetching from remote Git repository to populate
 * the native stores with queryable data.
 *
 * Since both stores compute identical Git object IDs, the resulting
 * IDs in the native store will match the source.
 *
 * @param gitStores Source stores with Git-formatted objects
 * @param nativeStores Target stores with native format
 * @param objects Object IDs with their types to import
 * @returns Count of objects imported (skips existing)
 *
 * @example
 * ```typescript
 * const gitStores = createStreamingSqlStores(db);
 * const nativeStores = createSqlNativeStores(db);
 *
 * // After fetching objects from remote
 * const imported = await importToNative(
 *   gitStores,
 *   nativeStores,
 *   objects
 * );
 * console.log(`Imported ${imported} objects`);
 * ```
 */
export async function importToNative(
  gitStores: GitStores,
  nativeStores: SqlNativeStores,
  objects: AsyncIterable<SyncObject>,
): Promise<number> {
  let count = 0;

  for await (const { id, type } of objects) {
    switch (type) {
      case "commit": {
        // Skip if already exists
        if (await nativeStores.commits.hasCommit(id)) continue;

        // Load from Git store and convert to Commit object
        const commit = await gitStores.commits.loadCommit(id);
        await nativeStores.commits.storeCommit(commit);
        count++;
        break;
      }

      case "tree": {
        // Skip if already exists
        if (await nativeStores.trees.hasTree(id)) continue;

        // Load entries from Git store
        const entries = gitStores.trees.loadTree(id);
        await nativeStores.trees.storeTree(entries);
        count++;
        break;
      }

      case "blob": {
        // Skip if already exists
        if (await nativeStores.blobs.has(id)) continue;

        // Load content from Git store
        const content = gitStores.blobs.load(id);
        await nativeStores.blobs.store(content);
        count++;
        break;
      }

      case "tag": {
        // Skip if already exists
        if (await nativeStores.tags.hasTag(id)) continue;

        // Load from Git store and convert to AnnotatedTag object
        const tag = await gitStores.tags.loadTag(id);
        await nativeStores.tags.storeTag(tag);
        count++;
        break;
      }
    }
  }

  return count;
}

/**
 * Export native store objects to Git format
 *
 * Use before pushing to remote Git repository to ensure all
 * objects are available in Git-compatible format.
 *
 * Since native stores compute Git-compatible IDs during storage,
 * the IDs are already known - we just load and re-store.
 *
 * @param nativeStores Source stores with native format
 * @param gitStores Target stores with Git-formatted objects
 * @param objects Object IDs with their types to export
 * @returns Count of objects exported (skips existing)
 *
 * @example
 * ```typescript
 * const nativeStores = createSqlNativeStores(db);
 * const gitStores = createStreamingSqlStores(db);
 *
 * // Before pushing to remote
 * const exported = await exportToGit(
 *   nativeStores,
 *   gitStores,
 *   objects
 * );
 * console.log(`Exported ${exported} objects`);
 * ```
 */
export async function exportToGit(
  nativeStores: SqlNativeStores,
  gitStores: GitStores,
  objects: AsyncIterable<SyncObject>,
): Promise<number> {
  let count = 0;

  for await (const { id, type } of objects) {
    switch (type) {
      case "commit": {
        // Skip if already exists in Git store
        if (await gitStores.commits.hasCommit(id)) continue;

        // Load from native store and store to Git store
        const commit = await nativeStores.commits.loadCommit(id);
        await gitStores.commits.storeCommit(commit);
        count++;
        break;
      }

      case "tree": {
        // Skip if already exists in Git store
        if (await gitStores.trees.hasTree(id)) continue;

        // Load entries from native store
        const entries = nativeStores.trees.loadTree(id);
        await gitStores.trees.storeTree(entries);
        count++;
        break;
      }

      case "blob": {
        // Skip if already exists in Git store
        if (await gitStores.blobs.has(id)) continue;

        // Load content from native store
        const content = nativeStores.blobs.load(id);
        await gitStores.blobs.store(content);
        count++;
        break;
      }

      case "tag": {
        // Skip if already exists in Git store
        if (await gitStores.tags.hasTag(id)) continue;

        // Load from native store and store to Git store
        const tag = await nativeStores.tags.loadTag(id);
        await gitStores.tags.storeTag(tag);
        count++;
        break;
      }
    }
  }

  return count;
}

/**
 * Create sync object iterator from object IDs with type
 *
 * Helper function to create the objects parameter for sync functions.
 *
 * @param ids Object IDs to sync
 * @param type Object type for all IDs
 * @returns Async iterable of SyncObject
 */
export async function* syncObjects(
  ids: Iterable<ObjectId> | AsyncIterable<ObjectId>,
  type: SyncObjectType,
): AsyncIterable<SyncObject> {
  if (Symbol.asyncIterator in ids) {
    for await (const id of ids as AsyncIterable<ObjectId>) {
      yield { id, type };
    }
  } else {
    for (const id of ids as Iterable<ObjectId>) {
      yield { id, type };
    }
  }
}

/**
 * Combine multiple sync object sources
 *
 * Helper function to sync multiple object types at once.
 *
 * @param sources Async iterables of SyncObject
 * @returns Combined async iterable
 */
export async function* combineSyncSources(
  ...sources: AsyncIterable<SyncObject>[]
): AsyncIterable<SyncObject> {
  for (const source of sources) {
    yield* source;
  }
}
