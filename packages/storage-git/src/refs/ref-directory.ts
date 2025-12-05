/**
 * Reference directory
 *
 * High-level interface for managing Git refs in a repository.
 * Handles both loose refs and packed-refs transparently.
 *
 * Based on:
 * - jgit/org.eclipse.jgit/src/org/eclipse/jgit/internal/storage/file/RefDirectory.java
 * - jgit/org.eclipse.jgit/src/org/eclipse/jgit/lib/RefDatabase.java
 */

import type { ObjectId } from "@webrun-vcs/storage";
import type { GitFilesApi } from "../git-files-api.js";
import { findPackedRef } from "./packed-refs-reader.js";
import { removePackedRef } from "./packed-refs-writer.js";
import { hasLooseRef, readAllRefs, readRef, resolveRef } from "./ref-reader.js";
import {
  HEAD,
  isSymbolicRef,
  R_HEADS,
  R_REMOTES,
  R_TAGS,
  type Ref,
  type SymbolicRef,
} from "./ref-types.js";
import {
  createRefsStructure,
  deleteRef as deleteLooseRef,
  writeObjectRef,
  writeSymbolicRef,
} from "./ref-writer.js";

/**
 * Reference directory interface
 */
export interface RefDirectory {
  /**
   * Read a ref by name
   *
   * @param refName Full ref name (e.g., "refs/heads/main")
   * @returns The ref or undefined if not found
   */
  exactRef(refName: string): Promise<Ref | SymbolicRef | undefined>;

  /**
   * Resolve a ref to its final object ID
   *
   * Follows symbolic refs until reaching a regular ref.
   *
   * @param refName Ref name to resolve
   * @returns The resolved ref or undefined
   */
  resolve(refName: string): Promise<Ref | undefined>;

  /**
   * Get the HEAD ref
   */
  getHead(): Promise<Ref | SymbolicRef | undefined>;

  /**
   * Get the current branch name
   *
   * @returns Branch name (e.g., "main") or undefined if HEAD is detached
   */
  getCurrentBranch(): Promise<string | undefined>;

  /**
   * Get all refs
   */
  getAllRefs(): Promise<(Ref | SymbolicRef)[]>;

  /**
   * Get refs by prefix
   *
   * @param prefix Prefix to filter (e.g., "refs/heads/")
   */
  getRefsByPrefix(prefix: string): Promise<(Ref | SymbolicRef)[]>;

  /**
   * Get all branches (refs/heads/*)
   */
  getBranches(): Promise<Ref[]>;

  /**
   * Get all tags (refs/tags/*)
   */
  getTags(): Promise<Ref[]>;

  /**
   * Get all remote tracking refs (refs/remotes/*)
   */
  getRemotes(): Promise<Ref[]>;

  /**
   * Check if a ref exists
   */
  has(refName: string): Promise<boolean>;

  /**
   * Create or update a ref
   *
   * @param refName Full ref name
   * @param objectId Object ID to point to
   */
  setRef(refName: string, objectId: ObjectId): Promise<void>;

  /**
   * Create or update HEAD
   *
   * @param target Either an object ID (detached HEAD) or branch name
   */
  setHead(target: ObjectId | string): Promise<void>;

  /**
   * Delete a ref
   *
   * @param refName Full ref name
   * @returns True if deleted
   */
  delete(refName: string): Promise<boolean>;

  /**
   * Create directory structure for refs
   */
  create(): Promise<void>;
}

/**
 * Create a ref directory instance
 *
 * @param files File system API
 * @param gitDir Path to .git directory
 * @returns RefDirectory instance
 */
export function createRefDirectory(files: GitFilesApi, gitDir: string): RefDirectory {
  return {
    async exactRef(refName: string): Promise<Ref | SymbolicRef | undefined> {
      return readRef(files, gitDir, refName);
    },

    async resolve(refName: string): Promise<Ref | undefined> {
      return resolveRef(files, gitDir, refName);
    },

    async getHead(): Promise<Ref | SymbolicRef | undefined> {
      return readRef(files, gitDir, HEAD);
    },

    async getCurrentBranch(): Promise<string | undefined> {
      const head = await readRef(files, gitDir, HEAD);
      if (head === undefined) return undefined;

      if (isSymbolicRef(head)) {
        const target = head.target;
        if (target.startsWith(R_HEADS)) {
          return target.substring(R_HEADS.length);
        }
        return target;
      }

      // Detached HEAD
      return undefined;
    },

    async getAllRefs(): Promise<(Ref | SymbolicRef)[]> {
      return readAllRefs(files, gitDir, "refs/");
    },

    async getRefsByPrefix(prefix: string): Promise<(Ref | SymbolicRef)[]> {
      return readAllRefs(files, gitDir, prefix);
    },

    async getBranches(): Promise<Ref[]> {
      const refs = await readAllRefs(files, gitDir, R_HEADS);
      return refs.filter((r) => !isSymbolicRef(r)) as Ref[];
    },

    async getTags(): Promise<Ref[]> {
      const refs = await readAllRefs(files, gitDir, R_TAGS);
      return refs.filter((r) => !isSymbolicRef(r)) as Ref[];
    },

    async getRemotes(): Promise<Ref[]> {
      const refs = await readAllRefs(files, gitDir, R_REMOTES);
      return refs.filter((r) => !isSymbolicRef(r)) as Ref[];
    },

    async has(refName: string): Promise<boolean> {
      // Check loose ref first
      if (await hasLooseRef(files, gitDir, refName)) {
        return true;
      }
      // Check packed refs
      const packed = await findPackedRef(files, gitDir, refName);
      return packed !== undefined;
    },

    async setRef(refName: string, objectId: ObjectId): Promise<void> {
      await writeObjectRef(files, gitDir, refName, objectId);
    },

    async setHead(target: ObjectId | string): Promise<void> {
      // Check if it looks like a branch name or object ID
      if (target.length === 40 && /^[0-9a-f]+$/i.test(target)) {
        // Detached HEAD - write object ID directly
        await writeObjectRef(files, gitDir, HEAD, target as ObjectId);
      } else {
        // Symbolic HEAD - ensure it starts with refs/
        const fullTarget = target.startsWith("refs/") ? target : `${R_HEADS}${target}`;
        await writeSymbolicRef(files, gitDir, HEAD, fullTarget);
      }
    },

    async delete(refName: string): Promise<boolean> {
      // Try to delete loose ref
      const deletedLoose = await deleteLooseRef(files, gitDir, refName);

      // Also remove from packed refs
      const deletedPacked = await removePackedRef(files, gitDir, refName);

      return deletedLoose || deletedPacked;
    },

    async create(): Promise<void> {
      await createRefsStructure(files, gitDir);
    },
  };
}

/**
 * Peel a ref to find the target commit
 *
 * For annotated tags, follows the tag to find the underlying commit.
 * This is a placeholder - full implementation requires object storage access.
 *
 * @param ref The ref to peel
 * @returns The peeled object ID, or the ref's object ID if not peelable
 */
export function peelRef(ref: Ref): ObjectId | undefined {
  if (ref.peeledObjectId !== undefined) {
    return ref.peeledObjectId;
  }
  return ref.objectId;
}

/**
 * Check if a ref name is valid
 *
 * @param refName The ref name to validate
 * @returns True if valid
 */
export function isValidRefName(refName: string): boolean {
  // Basic validation
  if (refName.length === 0) return false;
  if (refName.startsWith("/") || refName.endsWith("/")) return false;
  if (refName.includes("//")) return false;
  if (refName.includes("..")) return false;
  if (refName.includes("@{")) return false;
  if (refName.endsWith(".lock")) return false;

  // Check for invalid characters (control chars, space, and special chars)
  // biome-ignore lint/suspicious/noControlCharactersInRegex: intentionally checking for control characters in ref names
  const invalidChars = /[\x00-\x1f\x7f ~^:?*[\\]/;
  if (invalidChars.test(refName)) return false;

  return true;
}

/**
 * Get short ref name for display
 *
 * @param refName Full ref name
 * @returns Short name (e.g., "main" instead of "refs/heads/main")
 */
export function shortenRefName(refName: string): string {
  if (refName.startsWith(R_HEADS)) {
    return refName.substring(R_HEADS.length);
  }
  if (refName.startsWith(R_TAGS)) {
    return refName.substring(R_TAGS.length);
  }
  if (refName.startsWith(R_REMOTES)) {
    return refName.substring(R_REMOTES.length);
  }
  return refName;
}
