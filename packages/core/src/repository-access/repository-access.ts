/**
 * RepositoryAccess interface - Abstract object storage for transport operations
 *
 * This interface provides byte-level access to Git objects in wire format,
 * abstracting away the underlying storage implementation (Git files, SQL, KV, etc).
 *
 * For transport layer operations (pack generation, object enumeration),
 * use RepositoryAccess. For typed object manipulation, use HistoryStore's
 * commits, trees, blobs stores directly.
 *
 * @see HistoryStore for typed object access
 */

import type { ObjectId } from "../id/object-id.js";
import type { ObjectTypeCode } from "../objects/object-types.js";

/**
 * Information about a stored object with type
 */
export interface RepositoryObjectInfo {
	/** Object ID (SHA-1 hash) */
	id: ObjectId;
	/** Object type (commit, tree, blob, tag) */
	type: ObjectTypeCode;
	/** Object size in bytes (uncompressed content, without header) */
	size: number;
}

/**
 * Object data with type and content
 */
export interface ObjectData {
	/** Object type code */
	type: ObjectTypeCode;
	/** Object content (raw bytes, without Git header) */
	content: Uint8Array;
}

/**
 * RepositoryAccess interface
 *
 * Provides byte-level access to Git objects in wire format.
 * Used by transport layer for pack generation and object transfer.
 *
 * Implementations:
 * - GitNativeRepositoryAccess: Reads from Git loose objects and pack files
 * - SerializingRepositoryAccess: Converts typed objects to wire format
 */
export interface RepositoryAccess {
	/**
	 * Check if an object exists in the repository
	 *
	 * @param id Object ID to check
	 * @returns True if object exists
	 */
	has(id: ObjectId): Promise<boolean>;

	/**
	 * Get object info without loading content
	 *
	 * @param id Object ID
	 * @returns Object info or null if not found
	 */
	getInfo(id: ObjectId): Promise<RepositoryObjectInfo | null>;

	/**
	 * Load object content
	 *
	 * @param id Object ID
	 * @returns Object data (type + content) or null if not found
	 */
	load(id: ObjectId): Promise<ObjectData | null>;

	/**
	 * Store an object
	 *
	 * @param type Object type
	 * @param content Object content (without header)
	 * @returns Object ID (computed from content)
	 */
	store(type: ObjectTypeCode, content: Uint8Array): Promise<ObjectId>;

	/**
	 * Enumerate all object IDs in the repository
	 *
	 * @returns Async iterable of all object IDs
	 */
	enumerate(): AsyncIterable<ObjectId>;

	/**
	 * Enumerate object IDs with their types
	 *
	 * @returns Async iterable of object info
	 */
	enumerateWithInfo(): AsyncIterable<RepositoryObjectInfo>;

	/**
	 * Get objects in Git wire format for pack generation
	 *
	 * Returns object content with Git header prepended (e.g., "blob 123\0...")
	 * Useful for computing pack file entries.
	 *
	 * @param id Object ID
	 * @returns Wire-format bytes or null if not found
	 */
	loadWireFormat(id: ObjectId): Promise<Uint8Array | null>;
}

/**
 * Extended RepositoryAccess with delta storage support
 *
 * For repositories that support delta compression at the storage level.
 */
export interface DeltaAwareRepositoryAccess extends RepositoryAccess {
	/**
	 * Check if object is stored as a delta
	 *
	 * @param id Object ID
	 * @returns True if stored as delta
	 */
	isDelta(id: ObjectId): Promise<boolean>;

	/**
	 * Get the base object ID for a delta-stored object
	 *
	 * @param id Object ID
	 * @returns Base object ID or null if not a delta
	 */
	getDeltaBase(id: ObjectId): Promise<ObjectId | null>;

	/**
	 * Get the delta chain depth for an object
	 *
	 * @param id Object ID
	 * @returns Chain depth (0 = full object)
	 */
	getChainDepth(id: ObjectId): Promise<number>;
}
