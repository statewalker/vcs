/**
 * Git reference storage implementation
 *
 * Implements the RefStore interface for Git repositories,
 * managing refs stored as loose files and in packed-refs.
 *
 * Based on:
 * - jgit/org.eclipse.jgit/src/org/eclipse/jgit/internal/storage/file/RefDirectory.java
 */

import type { FilesApi } from "@statewalker/webrun-files";
import {
  isSymbolicRef,
  type ObjectId,
  type Ref,
  type RefStore,
  RefStoreLocation,
  type RefUpdateResult,
  type SymbolicRef,
} from "@webrun-vcs/vcs";
import { findPackedRef } from "./refs/packed-refs-reader.js";
import { packRefs as packRefsInternal, removePackedRef } from "./refs/packed-refs-writer.js";
import { hasLooseRef, readAllRefs, readRef, resolveRef } from "./refs/ref-reader.js";
import {
  type Ref as GitRef,
  RefStore as GitRefStorageLocation,
  type SymbolicRef as GitSymbolicRef,
  HEAD,
  isSymbolicRef as isGitSymbolicRef,
  R_HEADS,
} from "./refs/ref-types.js";
import {
  createRefsStructure,
  deleteRef as deleteLooseRef,
  updateRef,
  writeObjectRef,
  writeSymbolicRef,
} from "./refs/ref-writer.js";

/**
 * Convert Git-internal RefStore to public RefStoreLocation
 */
function toRefStorageLocation(storage: GitRefStorageLocation): RefStoreLocation {
  switch (storage) {
    case GitRefStorageLocation.NEW:
      return RefStoreLocation.NEW;
    case GitRefStorageLocation.LOOSE:
      return RefStoreLocation.PRIMARY;
    case GitRefStorageLocation.PACKED:
      return RefStoreLocation.PACKED;
    case GitRefStorageLocation.LOOSE_PACKED:
      return RefStoreLocation.PRIMARY;
    default:
      return RefStoreLocation.PRIMARY;
  }
}

/**
 * Convert Git-internal Ref to public Ref
 */
function toPublicRef(gitRef: GitRef): Ref {
  return {
    name: gitRef.name,
    objectId: gitRef.objectId,
    storage: toRefStorageLocation(gitRef.storage),
    peeled: gitRef.peeled,
    peeledObjectId: gitRef.peeledObjectId,
  };
}

/**
 * Convert Git-internal SymbolicRef to public SymbolicRef
 */
function toPublicSymbolicRef(gitRef: GitSymbolicRef): SymbolicRef {
  return {
    name: gitRef.name,
    target: gitRef.target,
    storage: toRefStorageLocation(gitRef.storage),
  };
}

/**
 * Convert Git-internal ref (Ref | SymbolicRef) to public format
 */
function toPublicRefOrSymbolic(gitRef: GitRef | GitSymbolicRef): Ref | SymbolicRef {
  if (isGitSymbolicRef(gitRef)) {
    return toPublicSymbolicRef(gitRef);
  }
  return toPublicRef(gitRef);
}

/**
 * Git reference storage implementation
 *
 * Implements RefStore for Git repositories using loose refs and packed-refs.
 */
export class GitRefStorage implements RefStore {
  private readonly files: FilesApi;
  private readonly gitDir: string;

  constructor(files: FilesApi, gitDir: string) {
    this.files = files;
    this.gitDir = gitDir;
  }

  async get(refName: string): Promise<Ref | SymbolicRef | undefined> {
    const gitRef = await readRef(this.files, this.gitDir, refName);
    if (gitRef === undefined) {
      return undefined;
    }
    return toPublicRefOrSymbolic(gitRef);
  }

  async resolve(refName: string): Promise<Ref | undefined> {
    const gitRef = await resolveRef(this.files, this.gitDir, refName);
    if (gitRef === undefined) {
      return undefined;
    }
    return toPublicRef(gitRef);
  }

  async has(refName: string): Promise<boolean> {
    // Check loose ref first
    if (await hasLooseRef(this.files, this.gitDir, refName)) {
      return true;
    }
    // Check packed refs
    const packed = await findPackedRef(this.files, this.gitDir, refName);
    return packed !== undefined;
  }

  async *list(prefix = "refs/"): AsyncIterable<Ref | SymbolicRef> {
    // Read HEAD if prefix matches
    if (prefix === "" || HEAD.startsWith(prefix)) {
      const headRef = await readRef(this.files, this.gitDir, HEAD);
      if (headRef !== undefined) {
        yield toPublicRefOrSymbolic(headRef);
      }
    }

    // Read all refs with prefix
    const gitRefs = await readAllRefs(this.files, this.gitDir, prefix);
    for (const gitRef of gitRefs) {
      yield toPublicRefOrSymbolic(gitRef);
    }
  }

  async set(refName: string, objectId: ObjectId): Promise<void> {
    await writeObjectRef(this.files, this.gitDir, refName, objectId);
  }

  async setSymbolic(refName: string, target: string): Promise<void> {
    // Ensure target starts with refs/ if it looks like a branch name
    const fullTarget = target.startsWith("refs/") ? target : `${R_HEADS}${target}`;
    await writeSymbolicRef(this.files, this.gitDir, refName, fullTarget);
  }

  async delete(refName: string): Promise<boolean> {
    // Try to delete loose ref
    const deletedLoose = await deleteLooseRef(this.files, this.gitDir, refName);

    // Also remove from packed refs
    const deletedPacked = await removePackedRef(this.files, this.gitDir, refName);

    return deletedLoose || deletedPacked;
  }

  async compareAndSwap(
    refName: string,
    expectedOld: ObjectId | undefined,
    newValue: ObjectId,
  ): Promise<RefUpdateResult> {
    const success = await updateRef(this.files, this.gitDir, refName, expectedOld, newValue);

    if (success) {
      return { success: true, previousValue: expectedOld };
    }

    // Get actual current value for error reporting
    const current = await this.resolve(refName);
    return {
      success: false,
      previousValue: current?.objectId,
      errorMessage: `CAS failed: expected ${expectedOld ?? "undefined"}, found ${current?.objectId ?? "undefined"}`,
    };
  }

  async initialize(): Promise<void> {
    await createRefsStructure(this.files, this.gitDir);
  }

  async optimize(): Promise<void> {
    // Collect all loose ref names
    const looseRefNames: string[] = [];
    for await (const ref of this.list("refs/")) {
      if (!isSymbolicRef(ref)) {
        looseRefNames.push(ref.name);
      }
    }

    if (looseRefNames.length > 0) {
      await this.packRefs(looseRefNames, true);
    }
  }

  /**
   * Pack loose refs into packed-refs file
   *
   * Git-specific optimization method. Consolidates specified loose refs
   * into the packed-refs file for better performance with many refs.
   *
   * @param refNames Names of refs to pack
   * @param deleteLoose Whether to delete loose ref files after packing
   */
  async packRefs(refNames: string[], deleteLoose = true): Promise<void> {
    await packRefsInternal(this.files, this.gitDir, refNames, deleteLoose);
  }
}
