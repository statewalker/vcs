/**
 * History implementation - concrete classes for the History interface
 */

import type { StorageBackend } from "../backend/storage-backend.js";
import type { Blobs } from "./blobs/blobs.js";
import type { Commits } from "./commits/commits.js";
import type { History, HistoryWithBackend } from "./history.js";
import type { Refs } from "./refs/refs.js";
import type { Tags } from "./tags/tags.js";
import type { Trees } from "./trees/trees.js";

/**
 * History implementation that composes individual stores
 *
 * This is the primary implementation used by applications.
 * It wraps individual store implementations into a unified facade.
 *
 * @example
 * ```typescript
 * const history = new HistoryImpl(blobs, trees, commits, tags, refs);
 * await history.initialize();
 *
 * // Use stores
 * const blobId = await history.blobs.store(content);
 * const commit = await history.commits.load(commitId);
 *
 * await history.close();
 * ```
 */
export class HistoryImpl implements History {
  private initialized = false;

  constructor(
    readonly blobs: Blobs,
    readonly trees: Trees,
    readonly commits: Commits,
    readonly tags: Tags,
    readonly refs: Refs,
  ) {}

  async initialize(): Promise<void> {
    if (this.initialized) return;

    // Initialize refs (creates HEAD, etc.)
    if (this.refs.initialize) {
      await this.refs.initialize();
    }

    this.initialized = true;
  }

  async close(): Promise<void> {
    // Flush any pending operations
    // Individual stores may have their own cleanup

    this.initialized = false;
  }

  isInitialized(): boolean {
    return this.initialized;
  }
}

/**
 * History implementation with backend access
 *
 * Used when delta compression, serialization, or GC is needed.
 * The backend provides direct access to storage optimization APIs.
 *
 * @example
 * ```typescript
 * const history = new HistoryWithBackendImpl(
 *   blobs, trees, commits, tags, refs, backend
 * );
 * await history.initialize();
 *
 * // Use backend for advanced operations
 * const pack = history.backend.serialization.createPack(objectIds);
 *
 * await history.close();
 * ```
 */
export class HistoryWithBackendImpl extends HistoryImpl implements HistoryWithBackend {
  constructor(
    blobs: Blobs,
    trees: Trees,
    commits: Commits,
    tags: Tags,
    refs: Refs,
    readonly backend: StorageBackend,
  ) {
    super(blobs, trees, commits, tags, refs);
  }

  async initialize(): Promise<void> {
    // Initialize backend first (creates storage structures)
    await this.backend.initialize();

    // Then initialize refs
    await super.initialize();
  }

  async close(): Promise<void> {
    // Close stores first
    await super.close();

    // Then close backend (flushes data)
    await this.backend.close();
  }
}
