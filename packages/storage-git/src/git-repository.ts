/**
 * Git Repository implementation
 *
 * Implements the Repository interface from @webrun-vcs/core,
 * providing a complete Git-compatible repository backed by FilesApi.
 *
 * Factory function: (files: FilesApi) => Repository
 */

import type { FilesApi } from "@statewalker/webrun-files";
import type {
  BlobStore,
  CommitStore,
  GitObjectHeader,
  GitObjectStore,
  ObjectId,
  ObjectTypeCode,
  ObjectTypeString,
  RefStore,
  Repository,
  RepositoryConfig,
  TagStore,
  TreeStore,
} from "@webrun-vcs/core";
import { ObjectType } from "@webrun-vcs/core";
import { parseObjectHeader } from "./format/object-header.js";
import type { LooseObjectStorage } from "./git-delta-object-storage.js";
import { GitStorage, type GitStorageOptions } from "./git-storage.js";
import { loadTypedObject, storeTypedObject } from "./typed-object-utils.js";

/**
 * Adapter from raw storage to GitObjectStore interface.
 *
 * The raw storage stores objects with Git format (header + content).
 * This adapter provides the typed GitObjectStore interface on top of it.
 */
class GitObjectStoreAdapter implements GitObjectStore {
  constructor(private readonly rawStorage: LooseObjectStorage) {}

  async store(
    type: ObjectTypeString,
    content: AsyncIterable<Uint8Array> | Iterable<Uint8Array>,
  ): Promise<ObjectId> {
    // Collect content into a single buffer
    const chunks: Uint8Array[] = [];
    if (Symbol.asyncIterator in content) {
      for await (const chunk of content as AsyncIterable<Uint8Array>) {
        chunks.push(chunk);
      }
    } else {
      for (const chunk of content as Iterable<Uint8Array>) {
        chunks.push(chunk);
      }
    }
    const data = concatBytes(chunks);

    // Store using the typed object utility
    const typeCode = stringToTypeCode(type);
    return storeTypedObject(this.rawStorage, typeCode, data);
  }

  async *load(id: ObjectId): AsyncIterable<Uint8Array> {
    const obj = await loadTypedObject(this.rawStorage, id);
    yield obj.content;
  }

  async *loadRaw(id: ObjectId): AsyncIterable<Uint8Array> {
    yield* this.rawStorage.load(id);
  }

  async getHeader(id: ObjectId): Promise<GitObjectHeader> {
    // Load first chunk to parse header
    const chunks: Uint8Array[] = [];
    for await (const chunk of this.rawStorage.load(id)) {
      chunks.push(chunk);
      // Stop after getting enough bytes for header (max ~32 bytes)
      const totalLength = chunks.reduce((sum, c) => sum + c.length, 0);
      if (totalLength >= 32) break;
    }

    const data = concatBytes(chunks);
    const header = parseObjectHeader(data);

    return {
      type: typeCodeToString(header.typeCode),
      size: header.size,
    };
  }

  async has(id: ObjectId): Promise<boolean> {
    return this.rawStorage.has(id);
  }

  async delete(id: ObjectId): Promise<boolean> {
    return this.rawStorage.delete(id);
  }

  async *list(): AsyncIterable<ObjectId> {
    yield* this.rawStorage.listObjects();
  }
}

/**
 * BlobStore implementation using GitObjectStore.
 *
 * Blobs are the simplest object type - just raw binary content.
 */
class GitBlobStoreAdapter implements BlobStore {
  constructor(private readonly objects: GitObjectStore) {}

  async store(content: AsyncIterable<Uint8Array> | Iterable<Uint8Array>): Promise<ObjectId> {
    return this.objects.store("blob", content);
  }

  load(id: ObjectId): AsyncIterable<Uint8Array> {
    return this.objects.load(id);
  }

  async has(id: ObjectId): Promise<boolean> {
    return this.objects.has(id);
  }
}

/**
 * Git Repository implementation.
 *
 * Wraps GitStorage to provide the Repository interface from @webrun-vcs/core.
 * Includes all typed stores (objects, commits, trees, blobs, tags) and refs.
 */
export class GitRepository implements Repository {
  readonly objects: GitObjectStore;
  readonly commits: CommitStore;
  readonly trees: TreeStore;
  readonly blobs: BlobStore;
  readonly tags: TagStore;
  readonly refs: RefStore;
  readonly config: RepositoryConfig;

  private readonly storage: GitStorage;
  private readonly files: FilesApi;
  private readonly gitDir: string;

  private constructor(
    files: FilesApi,
    gitDir: string,
    storage: GitStorage,
    config: RepositoryConfig = {},
  ) {
    this.files = files;
    this.gitDir = gitDir;
    this.storage = storage;
    this.config = config;

    // Wrap raw storage with GitObjectStore adapter
    this.objects = new GitObjectStoreAdapter(storage.rawStorage);

    // Use existing typed stores from GitStorage
    this.commits = storage.commits;
    this.trees = storage.trees;
    this.tags = storage.tags;
    this.refs = storage.refs;

    // Create blob store from object store
    this.blobs = new GitBlobStoreAdapter(this.objects);
  }

  /**
   * Open an existing Git repository.
   *
   * @param files File system API
   * @param gitDir Path to .git directory
   * @param config Optional repository configuration
   */
  static async open(
    files: FilesApi,
    gitDir: string,
    config?: RepositoryConfig,
  ): Promise<GitRepository> {
    const storage = await GitStorage.open(files, gitDir);
    return new GitRepository(files, gitDir, storage, config);
  }

  /**
   * Create or open a Git repository.
   *
   * @param files File system API
   * @param gitDir Path to .git directory
   * @param options Creation options
   */
  static async init(
    files: FilesApi,
    gitDir: string,
    options: GitStorageOptions & { config?: RepositoryConfig } = {},
  ): Promise<GitRepository> {
    const storage = await GitStorage.init(files, gitDir, options);
    return new GitRepository(files, gitDir, storage, {
      bare: options.bare,
      ...options.config,
    });
  }

  /**
   * Initialize repository structure.
   *
   * Creates necessary storage structures (directories, etc.).
   * Safe to call on already-initialized repositories.
   */
  async initialize(): Promise<void> {
    // GitStorage.init already creates the structure
    // This method is safe to call on existing repos
    await GitStorage.init(this.files, this.gitDir, { create: true });
  }

  /**
   * Close repository and release resources.
   */
  async close(): Promise<void> {
    await this.storage.close();
  }

  /**
   * Check if repository is initialized.
   *
   * @returns True if repository has been initialized
   */
  async isInitialized(): Promise<boolean> {
    try {
      const head = await this.refs.get("HEAD");
      return head !== undefined;
    } catch {
      return false;
    }
  }

  /**
   * Get HEAD commit ID.
   */
  async getHead(): Promise<ObjectId | undefined> {
    return this.storage.getHead();
  }

  /**
   * Get current branch name.
   */
  async getCurrentBranch(): Promise<string | undefined> {
    return this.storage.getCurrentBranch();
  }

  /**
   * Refresh pack files (call after gc or fetch).
   */
  async refresh(): Promise<void> {
    await this.storage.refresh();
  }
}

/**
 * Create a Git repository instance.
 *
 * Factory function: (files: FilesApi) => Repository
 *
 * @param files File system API
 * @param gitDir Path to .git directory (default: ".git")
 * @param options Creation/open options
 */
export async function createGitRepository(
  files: FilesApi,
  gitDir = ".git",
  options: GitStorageOptions & { config?: RepositoryConfig } = {},
): Promise<Repository> {
  if (options.create) {
    return GitRepository.init(files, gitDir, options);
  }
  return GitRepository.open(files, gitDir, options.config);
}

/**
 * Convert type string to type code.
 */
function stringToTypeCode(type: ObjectTypeString): ObjectTypeCode {
  switch (type) {
    case "commit":
      return ObjectType.COMMIT;
    case "tree":
      return ObjectType.TREE;
    case "blob":
      return ObjectType.BLOB;
    case "tag":
      return ObjectType.TAG;
    default:
      throw new Error(`Unknown object type: ${type}`);
  }
}

/**
 * Convert type code to string.
 */
function typeCodeToString(typeCode: ObjectTypeCode): ObjectTypeString {
  switch (typeCode) {
    case ObjectType.COMMIT:
      return "commit";
    case ObjectType.TREE:
      return "tree";
    case ObjectType.BLOB:
      return "blob";
    case ObjectType.TAG:
      return "tag";
    default:
      throw new Error(`Unknown type code: ${typeCode}`);
  }
}

/**
 * Concatenate byte arrays.
 */
function concatBytes(arrays: Uint8Array[]): Uint8Array {
  if (arrays.length === 0) return new Uint8Array(0);
  if (arrays.length === 1) return arrays[0];

  const totalLength = arrays.reduce((sum, arr) => sum + arr.length, 0);
  const result = new Uint8Array(totalLength);
  let offset = 0;
  for (const arr of arrays) {
    result.set(arr, offset);
    offset += arr.length;
  }
  return result;
}
