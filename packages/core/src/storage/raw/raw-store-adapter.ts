/**
 * Adapter to use legacy RawStore as RawStorage
 *
 * This is a temporary adapter to allow GitObjectStoreImpl to work with
 * existing RawStore implementations during the migration to RawStorage.
 *
 * @deprecated This adapter will be removed when RawStore is fully migrated to RawStorage
 */

import type { RawStore } from "../binary/raw-store.js";
import type { RawStorage } from "./raw-storage.js";

/**
 * Wraps a RawStore to provide RawStorage interface
 *
 * Key differences handled:
 * - RawStore.store() returns number, RawStorage.store() returns void
 * - RawStore.load() uses {offset, length}, RawStorage.load() uses {start, end}
 * - RawStore.delete() vs RawStorage.remove()
 */
export class RawStoreAdapter implements RawStorage {
  constructor(private readonly inner: RawStore) {}

  async store(key: string, content: AsyncIterable<Uint8Array>): Promise<void> {
    await this.inner.store(key, content);
  }

  async *load(key: string, options?: { start?: number; end?: number }): AsyncIterable<Uint8Array> {
    // Convert start/end to offset/length
    const innerOptions =
      options?.start !== undefined || options?.end !== undefined
        ? {
            offset: options.start,
            length:
              options.end !== undefined && options.start !== undefined
                ? options.end - options.start
                : undefined,
          }
        : undefined;
    yield* this.inner.load(key, innerOptions);
  }

  async has(key: string): Promise<boolean> {
    return this.inner.has(key);
  }

  async remove(key: string): Promise<boolean> {
    return this.inner.delete(key);
  }

  async *keys(): AsyncIterable<string> {
    yield* this.inner.keys();
  }

  async size(key: string): Promise<number> {
    return this.inner.size(key);
  }
}

/**
 * Create a RawStorage adapter from a RawStore
 *
 * @deprecated Use RawStorage implementations directly when available
 */
export function adaptRawStore(store: RawStore): RawStorage {
  return new RawStoreAdapter(store);
}
