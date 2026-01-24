/**
 * Repository Access Types
 *
 * Defines the RepositoryAccess interface and related types for
 * transport-layer repository operations.
 *
 * These types are used by adapters to provide a consistent interface
 * for protocol handlers to access repository data.
 */

/**
 * Object identifier (SHA-1 hex string).
 */
export type ObjectId = string;

/**
 * Git object type codes.
 *
 * - 1: commit
 * - 2: tree
 * - 3: blob
 * - 4: tag
 */
export type ObjectTypeCode = 1 | 2 | 3 | 4;

/**
 * Object metadata.
 */
export interface ObjectInfo {
  /** Object type code */
  type: ObjectTypeCode;
  /** Object content size in bytes */
  size: number;
}

/**
 * Reference information.
 */
export interface RefInfo {
  /** Full reference name (e.g., "refs/heads/main") */
  name: string;
  /** Object ID the ref points to */
  objectId: string;
  /** For annotated tags, the peeled (dereferenced) object ID */
  peeledId?: string;
}

/**
 * HEAD reference information.
 *
 * HEAD can be either:
 * - Symbolic: points to another ref (target)
 * - Detached: points directly to an object (objectId)
 */
export interface HeadInfo {
  /** Object ID if HEAD is detached */
  objectId?: string;
  /** Target ref name if HEAD is symbolic (e.g., "refs/heads/main") */
  target?: string;
}

/**
 * Repository access interface for transport protocol handlers.
 *
 * Provides the operations needed to implement Git protocol
 * server-side functionality.
 */
export interface RepositoryAccess {
  /**
   * Check if an object exists in the repository.
   *
   * @param id - Object ID to check
   * @returns true if object exists
   */
  hasObject(id: ObjectId): Promise<boolean>;

  /**
   * Get object type and size.
   *
   * @param id - Object ID
   * @returns Object info, or null if not found
   */
  getObjectInfo(id: ObjectId): Promise<ObjectInfo | null>;

  /**
   * Load raw object content.
   *
   * The returned content includes the Git object header
   * in wire format (type + space + size + null + content).
   *
   * @param id - Object ID
   * @yields Raw object content chunks
   */
  loadObject(id: ObjectId): AsyncIterable<Uint8Array>;

  /**
   * Store an object.
   *
   * @param type - Object type code
   * @param content - Object content (without header)
   * @returns Object ID of stored object
   */
  storeObject(type: ObjectTypeCode, content: Uint8Array): Promise<ObjectId>;

  /**
   * List all refs in the repository.
   *
   * @yields Reference information
   */
  listRefs(): AsyncIterable<RefInfo>;

  /**
   * Get HEAD reference.
   *
   * @returns HEAD info, or null if not set
   */
  getHead(): Promise<HeadInfo | null>;

  /**
   * Update a reference.
   *
   * Performs an atomic compare-and-swap update if oldId is provided.
   *
   * @param name - Reference name
   * @param oldId - Expected current value (null for create)
   * @param newId - New value (null for delete)
   * @returns true if update succeeded
   */
  updateRef(name: string, oldId: ObjectId | null, newId: ObjectId | null): Promise<boolean>;

  /**
   * Walk object graph from starting points.
   *
   * Collects all objects reachable from wants, excluding haves.
   * Used by protocol handlers to build pack files.
   *
   * @param wants - Object IDs to include (with all reachable objects)
   * @param haves - Object IDs to exclude (client already has these)
   * @yields Objects with their ID, type, and content
   */
  walkObjects(
    wants: ObjectId[],
    haves: ObjectId[],
  ): AsyncIterable<{ id: ObjectId; type: ObjectTypeCode; content: Uint8Array }>;
}
