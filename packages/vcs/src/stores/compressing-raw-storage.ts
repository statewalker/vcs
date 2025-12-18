/**
 * Compressing raw storage wrapper
 *
 * Wraps any RawStorage implementation with ZLIB compression/decompression.
 * This enables Git-compatible loose object storage where objects must be
 * stored in ZLIB compressed format.
 *
 * Data flow:
 * - store(): content -> compress (ZLIB) -> inner.store()
 * - load(): inner.load() -> decompress (ZLIB) -> content
 */

import { deflate, inflate } from "@webrun-vcs/utils";
import type { RawStorage } from "../interfaces/raw-storage.js";

/**
 * Compression options for CompressingRawStorage
 */
export interface CompressingRawStorageOptions {
  /**
   * Use raw DEFLATE format (no ZLIB header/trailer).
   * Default: false (ZLIB format, as required by Git)
   */
  raw?: boolean;
}

/**
 * A RawStorage wrapper that compresses content on store and decompresses on load.
 *
 * Uses ZLIB format by default to match Git loose object requirements.
 *
 * @example
 * ```ts
 * const fileStorage = new FileRawStorage(files, objectsDir);
 * const compressed = new CompressingRawStorage(fileStorage);
 *
 * // Store: content is compressed with ZLIB before writing to disk
 * await compressed.store(objectId, contentStream);
 *
 * // Load: content is decompressed from ZLIB when reading
 * const content = compressed.load(objectId);
 * ```
 */
export class CompressingRawStorage implements RawStorage {
  private readonly raw: boolean;

  constructor(
    private readonly inner: RawStorage,
    options?: CompressingRawStorageOptions,
  ) {
    this.raw = options?.raw ?? false;
  }

  async store(key: string, content: AsyncIterable<Uint8Array>): Promise<void> {
    const compressed = deflate(content, { raw: this.raw });
    await this.inner.store(key, compressed);
  }

  load(key: string): AsyncIterable<Uint8Array> {
    const compressed = this.inner.load(key);
    return inflate(compressed, { raw: this.raw });
  }

  has(key: string): Promise<boolean> {
    return this.inner.has(key);
  }

  delete(key: string): Promise<boolean> {
    return this.inner.delete(key);
  }

  keys(): AsyncIterable<string> {
    return this.inner.keys();
  }
}
