/**
 * LRU (Least Recently Used) cache implementation
 *
 * Manages cached content with size and entry count limits,
 * evicting least recently used items when limits are exceeded.
 */

import type { ObjectId } from "./types.js";

/**
 * Cache entry with content and metadata
 */
interface CacheEntry {
  /** Cached content */
  content: Uint8Array;
  /** Content size in bytes */
  size: number;
  /** Timestamp of when entry was added/accessed */
  timestamp: number;
}

/**
 * LRU cache for object content
 *
 * Maintains both size and entry count limits, evicting oldest entries
 * when either limit is exceeded.
 */
export class LRUCache {
  private cache = new Map<ObjectId, CacheEntry>();
  private accessOrder: ObjectId[] = [];
  private totalSize = 0;

  /**
   * Create LRU cache with specified limits
   *
   * @param maxSize Maximum total size in bytes (default: 50MB)
   * @param maxEntries Maximum number of entries (default: 500)
   */
  constructor(
    private readonly maxSize = 50 * 1024 * 1024,
    private readonly maxEntries = 500,
  ) {}

  /**
   * Check if object is in cache
   *
   * @param id Object ID
   * @returns True if cached
   */
  has(id: ObjectId): boolean {
    return this.cache.has(id);
  }

  /**
   * Get cached content
   *
   * @param id Object ID
   * @returns Cached content or undefined
   */
  get(id: ObjectId): Uint8Array | undefined {
    const entry = this.cache.get(id);
    if (!entry) {
      return undefined;
    }

    // Move to end of access order (most recently used)
    this.updateAccessOrder(id);

    return entry.content;
  }

  /**
   * Add content to cache
   *
   * @param id Object ID
   * @param content Content to cache
   */
  set(id: ObjectId, content: Uint8Array): void {
    // Remove if already exists
    if (this.cache.has(id)) {
      this.delete(id);
    }

    // Add to cache
    const entry: CacheEntry = {
      content,
      size: content.length,
      timestamp: Date.now(),
    };

    this.cache.set(id, entry);
    this.accessOrder.push(id);
    this.totalSize += content.length;

    // Evict if over limits
    this.enforceLimit();
  }

  /**
   * Remove entry from cache
   *
   * @param id Object ID
   * @returns True if entry was removed
   */
  delete(id: ObjectId): boolean {
    const entry = this.cache.get(id);
    if (!entry) {
      return false;
    }

    this.totalSize -= entry.size;
    this.cache.delete(id);

    // Remove from access order
    const index = this.accessOrder.indexOf(id);
    if (index !== -1) {
      this.accessOrder.splice(index, 1);
    }

    return true;
  }

  /**
   * Clear all cached entries
   */
  clear(): void {
    this.cache.clear();
    this.accessOrder = [];
    this.totalSize = 0;
  }

  /**
   * Get current number of cached entries
   *
   * @returns Number of entries
   */
  size(): number {
    return this.cache.size;
  }

  /**
   * Get total size of cached content
   *
   * @returns Total size in bytes
   */
  getTotalSize(): number {
    return this.totalSize;
  }

  /**
   * Update access order by moving ID to end (most recently used)
   */
  private updateAccessOrder(id: ObjectId): void {
    const index = this.accessOrder.indexOf(id);
    if (index !== -1) {
      this.accessOrder.splice(index, 1);
    }
    this.accessOrder.push(id);
  }

  /**
   * Enforce size and entry count limits by evicting oldest entries
   */
  private enforceLimit(): void {
    while (
      (this.totalSize > this.maxSize || this.cache.size > this.maxEntries) &&
      this.accessOrder.length > 1 // Keep at least one entry
    ) {
      const evictId = this.accessOrder.shift();
      if (evictId) {
        this.evict(evictId);
      }
    }
  }

  /**
   * Evict entry from cache
   */
  private evict(id: ObjectId): void {
    const entry = this.cache.get(id);
    if (entry) {
      this.totalSize -= entry.size;
      this.cache.delete(id);
    }
  }
}
