/**
 * Transport-specific facade for repository operations.
 *
 * Defined in `packages/transport` (not `packages/core`).
 * Composes methods from core APIs into a transport-friendly interface.
 *
 * Delegates to:
 * - SerializationApi.importPack / createPack
 * - ObjectStore.has / collectReachable
 * - CommitStore.walkAncestors (via AncestryWalker)
 *
 * @example Factory implementation
 * ```ts
 * function createRepositoryFacade(historyStore: HistoryStore): RepositoryFacade {
 *   const { objectStore, commitStore, serialization } = historyStore;
 *
 *   return {
 *     importPack: (stream) => serialization.importPack(stream),
 *     async *exportPack(wants, exclude) {
 *       const objects = objectStore.collectReachable(wants, exclude);
 *       yield* serialization.createPack(objects);
 *     },
 *     has: (oid) => objectStore.has(oid),
 *     async *walkAncestors(startOid) {
 *       yield* commitStore.walkAncestors(startOid);
 *     },
 *   };
 * }
 * ```
 */
export interface RepositoryFacade {
  /**
   * Imports a pack stream into the repository.
   * Parses pack format and stores objects.
   *
   * Delegates to: SerializationApi.importPack
   *
   * @param packStream - Stream of pack bytes
   * @returns Import statistics
   */
  importPack(packStream: AsyncIterable<Uint8Array>): Promise<PackImportResult>;

  /**
   * Exports objects as a pack stream.
   * Collects reachable objects and serializes to pack format.
   *
   * Delegates to: ObjectStore.collectReachable + SerializationApi.createPack
   *
   * @param wants - Object IDs to include (with all reachable objects)
   * @param exclude - Object IDs to exclude (client already has these)
   * @yields Pack data chunks
   */
  exportPack(
    wants: Set<string>,
    exclude: Set<string>,
  ): AsyncIterable<Uint8Array>;

  /**
   * Checks if an object exists in the repository.
   *
   * Delegates to: ObjectStore.has
   *
   * @param oid - Object ID to check
   * @returns true if object exists locally
   */
  has(oid: string): Promise<boolean>;

  /**
   * Walks commit ancestry from a starting point.
   * Used during negotiation to find common ancestors.
   *
   * Delegates to: AncestryWalker / CommitStore.walkAncestors
   *
   * @param startOid - Commit to start walking from
   * @yields Commit OIDs in topological order
   */
  walkAncestors(startOid: string): AsyncGenerator<string>;
}

/**
 * Statistics from pack import operation.
 */
export interface PackImportResult {
  /** Total number of objects imported */
  objectsImported: number;
  /** Number of blob objects with delta compression */
  blobsWithDelta: number;
  /** Number of tree objects imported */
  treesImported: number;
  /** Number of commit objects imported */
  commitsImported: number;
  /** Number of tag objects imported */
  tagsImported: number;
}
