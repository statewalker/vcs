/**
 * Reference storage interface
 */

import type { ObjectId } from "../types/index.js";

/**
 * Storage location of a reference (informational only)
 */
export enum RefStoreLocation {
  /** The ref does not exist yet */
  NEW = "new",
  /** Primary storage location */
  PRIMARY = "primary",
  /** Secondary/packed storage location */
  PACKED = "packed",
}

/**
 * A Git reference pointing to an object
 */
export interface Ref {
  readonly name: string;
  readonly objectId: ObjectId | undefined;
  readonly storage: RefStoreLocation;
  readonly peeled: boolean;
  readonly peeledObjectId?: ObjectId;
}

/**
 * A symbolic reference pointing to another ref
 */
export interface SymbolicRef {
  readonly name: string;
  readonly target: string;
  readonly storage: RefStoreLocation;
}

/**
 * Check if a reference is symbolic
 */
export function isSymbolicRef(ref: Ref | SymbolicRef): ref is SymbolicRef {
  return "target" in ref && typeof ref.target === "string";
}

/**
 * Result of a compare-and-swap update operation
 */
export interface RefUpdateResult {
  success: boolean;
  previousValue?: ObjectId;
  errorMessage?: string;
}

/**
 * Abstract reference storage interface
 *
 * Provides ref management without filesystem dependencies.
 * Implementations may use files, databases, or other backends.
 */
export interface RefStore {
  /**
   * Read a ref by exact name
   */
  get(refName: string): Promise<Ref | SymbolicRef | undefined>;

  /**
   * Resolve a ref to its final object ID (follows symbolic refs)
   */
  resolve(refName: string): Promise<Ref | undefined>;

  /**
   * Check if a ref exists
   */
  has(refName: string): Promise<boolean>;

  /**
   * List all refs matching a prefix
   *
   * @param prefix Optional prefix filter (e.g., "refs/heads/")
   * @returns AsyncIterable of refs
   */
  list(prefix?: string): AsyncIterable<Ref | SymbolicRef>;

  /**
   * Set a ref to point to an object ID
   *
   * Creates or updates the ref.
   */
  set(refName: string, objectId: ObjectId): Promise<void>;

  /**
   * Set a symbolic ref
   */
  setSymbolic(refName: string, target: string): Promise<void>;

  /**
   * Delete a ref
   *
   * @returns True if ref was deleted, false if it didn't exist
   */
  delete(refName: string): Promise<boolean>;

  /**
   * Compare-and-swap update (for concurrent safety)
   *
   * @param refName Ref to update
   * @param expectedOld Expected current value (undefined for new refs)
   * @param newValue New value to set
   */
  compareAndSwap(
    refName: string,
    expectedOld: ObjectId | undefined,
    newValue: ObjectId,
  ): Promise<RefUpdateResult>;

  /**
   * Initialize storage structure (if needed)
   */
  initialize?(): Promise<void>;

  /**
   * Perform implementation-specific optimizations
   *
   * Each implementation decides what this means:
   * - Git filesystem: pack loose refs into packed-refs
   * - SQL: VACUUM, rebuild indexes
   * - Memory: no-op
   * - S3: batch consolidation
   *
   * Generic maintenance code can call this without knowing the implementation.
   */
  optimize?(): Promise<void>;
}
