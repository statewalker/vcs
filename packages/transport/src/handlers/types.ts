/**
 * Protocol handler types and interfaces.
 *
 * These types define the contract for protocol-independent Git handlers
 * that work with streams rather than specific transport mechanisms.
 *
 * Based on JGit's UploadPack and ReceivePack interfaces.
 */

/**
 * Git object type codes matching JGit Constants
 */
export declare const ObjectType: {
  readonly COMMIT: 1;
  readonly TREE: 2;
  readonly BLOB: 3;
  readonly TAG: 4;
};
export type ObjectTypeCode = (typeof ObjectType)[keyof typeof ObjectType];

/**
 * Object ID type (40-character hex string for SHA-1).
 */
export type ObjectId = string;

/**
 * Abstract repository access for protocol handlers.
 *
 * Provides the minimal interface needed for Git operations
 * without coupling to specific storage implementations.
 */
export interface RepositoryAccess {
  /**
   * List all refs in the repository.
   */
  listRefs(): AsyncIterable<RefInfo>;

  /**
   * Get HEAD reference (may be symbolic).
   */
  getHead(): Promise<HeadInfo | null>;

  /**
   * Check if an object exists.
   */
  hasObject(id: ObjectId): Promise<boolean>;

  /**
   * Get object type and size.
   */
  getObjectInfo(id: ObjectId): Promise<ObjectInfo | null>;

  /**
   * Load object content.
   */
  loadObject(id: ObjectId): AsyncIterable<Uint8Array>;

  /**
   * Store an object (for receive-pack).
   * Returns the object ID.
   */
  storeObject(type: ObjectTypeCode, content: Uint8Array): Promise<ObjectId>;

  /**
   * Update a ref (for receive-pack).
   * oldId can be null for creates, newId can be null for deletes.
   * Returns true if update succeeded.
   */
  updateRef(name: string, oldId: ObjectId | null, newId: ObjectId | null): Promise<boolean>;

  /**
   * Walk object graph from starting points.
   * Used for generating pack files.
   *
   * @param wants - Objects the client wants
   * @param haves - Objects the client already has (can be empty)
   */
  walkObjects(
    wants: ObjectId[],
    haves: ObjectId[],
  ): AsyncIterable<{ id: ObjectId; type: ObjectTypeCode; content: Uint8Array }>;
}

/**
 * Reference information.
 */
export interface RefInfo {
  /** Reference name (e.g., "refs/heads/main") */
  name: string;
  /** Object ID the ref points to */
  objectId: ObjectId;
  /** For annotated tags, the peeled object ID */
  peeledId?: ObjectId;
}

/**
 * HEAD reference information.
 */
export interface HeadInfo {
  /** Object ID if HEAD is detached */
  objectId?: ObjectId;
  /** Target ref if HEAD is symbolic (e.g., "refs/heads/main") */
  target?: string;
}

/**
 * Object metadata.
 */
export interface ObjectInfo {
  /** Object type code (1=commit, 2=tree, 3=blob, 4=tag) */
  type: ObjectTypeCode;
  /** Object size in bytes */
  size: number;
}

/**
 * Options for ref advertisement.
 */
export interface AdvertiseOptions {
  /** Include service announcement header (for HTTP smart protocol) */
  includeServiceAnnouncement?: boolean;
  /** Service name for announcement (e.g., "git-upload-pack") */
  serviceName?: string;
  /** Additional capabilities to advertise */
  extraCapabilities?: string[];
}

/**
 * Upload pack handler for git-upload-pack service.
 *
 * Handles fetch/clone operations by generating pack files
 * containing requested objects.
 */
export interface UploadPackHandler {
  /**
   * Generate ref advertisement for info/refs.
   *
   * Returns pkt-line encoded response with:
   * - Service announcement (if requested)
   * - Refs with capabilities
   * - Flush packet
   */
  advertise(options?: AdvertiseOptions): AsyncIterable<Uint8Array>;

  /**
   * Process upload-pack request.
   *
   * Reads want/have/done from input, generates pack with requested objects.
   *
   * @param input - Client request data (pkt-line encoded)
   * @returns Pack data response (NAK + pack via sideband if negotiated)
   */
  process(input: AsyncIterable<Uint8Array>): AsyncIterable<Uint8Array>;
}

/**
 * Options for creating an upload pack handler.
 */
export interface UploadPackOptions {
  /** Repository access */
  repository: RepositoryAccess;
  /** Timeout for pack generation (ms) */
  timeout?: number;
  /** Maximum pack size in bytes */
  maxPackSize?: number;
  /** Allow thin packs (deltas against objects client has) */
  allowThinPack?: boolean;
  /** Allow any SHA-1 in want (skip reachability check) */
  allowAnySha1InWant?: boolean;
  /** Allow filter specs (partial clone) */
  allowFilter?: boolean;
}

/**
 * Receive pack handler for git-receive-pack service.
 *
 * Handles push operations by receiving pack files
 * and updating refs.
 */
export interface ReceivePackHandler {
  /**
   * Generate ref advertisement for info/refs.
   */
  advertise(options?: AdvertiseOptions): AsyncIterable<Uint8Array>;

  /**
   * Process receive-pack request.
   *
   * Reads ref-updates and pack from input, applies changes,
   * returns status report.
   *
   * @param input - Client request data (ref-updates + pack)
   * @returns Status report response
   */
  process(input: AsyncIterable<Uint8Array>): AsyncIterable<Uint8Array>;
}

/**
 * Options for creating a receive pack handler.
 */
export interface ReceivePackOptions {
  /** Repository access */
  repository: RepositoryAccess;
  /** Allow creating new refs */
  allowCreates?: boolean;
  /** Allow deleting refs */
  allowDeletes?: boolean;
  /** Allow non-fast-forward updates */
  allowNonFastForwards?: boolean;
  /** Require atomic ref updates (all or nothing) */
  atomic?: boolean;
  /** Pre-receive hook - validate updates before applying */
  preReceive?: (updates: ServerRefUpdate[]) => Promise<ServerRefUpdateResult[]>;
  /** Post-receive hook - called after successful updates */
  postReceive?: (updates: ServerRefUpdate[]) => Promise<void>;
}

/**
 * Reference update command (server-side).
 * Named differently from push-negotiator's RefUpdate to avoid conflicts.
 */
export interface ServerRefUpdate {
  /** Reference name */
  refName: string;
  /** Old object ID (ZERO_ID for creates) */
  oldId: ObjectId;
  /** New object ID (ZERO_ID for deletes) */
  newId: ObjectId;
}

/**
 * Result of a reference update (server-side).
 */
export interface ServerRefUpdateResult {
  /** Reference name */
  refName: string;
  /** Status of the update */
  status: "ok" | "rejected";
  /** Error message if rejected */
  message?: string;
}

/**
 * Parsed upload-pack request.
 */
export interface UploadPackRequest {
  /** Object IDs the client wants */
  wants: ObjectId[];
  /** Object IDs the client already has */
  haves: ObjectId[];
  /** Capabilities requested by client */
  capabilities: Set<string>;
  /** Shallow clone depth (0 = not set) */
  depth?: number;
  /** Deepen since timestamp in seconds (0 = not set) */
  deepenSince?: number;
  /** Refs to exclude (deepen-not) */
  deepenNots?: string[];
  /** Whether depth is relative to client's shallow commits */
  deepenRelative?: boolean;
  /** Commits the client already has as shallow */
  clientShallowCommits?: Set<ObjectId>;
  /** Filter specification */
  filter?: string;
  /** Whether client sent "done" */
  done: boolean;
}

/**
 * Parsed receive-pack request.
 */
export interface ReceivePackRequest {
  /** Reference updates */
  updates: ServerRefUpdate[];
  /** Capabilities from first command */
  capabilities: Set<string>;
  /** Pack data (everything after commands) */
  packData: Uint8Array;
}
