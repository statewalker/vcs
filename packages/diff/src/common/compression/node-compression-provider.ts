/**
 * Node.js zlib compression provider
 *
 * Uses Node.js built-in zlib module for compression/decompression
 */

import {
  CompressionAlgorithm,
  CompressionError,
  type CompressionOptions,
  type CompressionProvider,
  type DecompressionOptions,
} from "./types.js";

/**
 * Compression provider using Node.js zlib
 *
 * Supports both async and sync operations
 */
export class NodeCompressionProvider implements CompressionProvider {
  private zlib: typeof import("node:zlib") | null = null;

  private async getZlib(): Promise<typeof import("node:zlib")> {
    if (!this.zlib) {
      try {
        this.zlib = await import("node:zlib");
      } catch (error) {
        throw new CompressionError("Failed to load Node.js zlib module", error);
      }
    }
    return this.zlib;
  }

  private getZlibSync(): typeof import("node:zlib") {
    if (!this.zlib) {
      try {
        // Dynamic require for sync case
        // eslint-disable-next-line @typescript-eslint/no-require-imports
        this.zlib = require("node:zlib");
      } catch (error) {
        throw new CompressionError("Failed to load Node.js zlib module", error);
      }
    }
    if (!this.zlib) {
      throw new CompressionError("Failed to load Node.js zlib module");
    }
    return this.zlib;
  }

  async compress(data: Uint8Array, options?: CompressionOptions): Promise<Uint8Array> {
    const algorithm = options?.algorithm ?? CompressionAlgorithm.DEFLATE;

    if (algorithm === CompressionAlgorithm.NONE) {
      return data;
    }

    const zlib = await this.getZlib();

    return new Promise((resolve, reject) => {
      const zlibOptions = {
        level: options?.level ?? 6,
      };

      const callback = (error: Error | null, result: Buffer) => {
        if (error) {
          reject(new CompressionError(`Node compression failed: ${error.message}`, error));
        } else {
          resolve(new Uint8Array(result));
        }
      };

      if (algorithm === CompressionAlgorithm.GZIP) {
        zlib.gzip(data, zlibOptions, callback);
      } else {
        zlib.deflateRaw(data, zlibOptions, callback);
      }
    });
  }

  async decompress(data: Uint8Array, options?: DecompressionOptions): Promise<Uint8Array> {
    const algorithm = options?.algorithm ?? CompressionAlgorithm.DEFLATE;

    if (algorithm === CompressionAlgorithm.NONE) {
      return data;
    }

    const zlib = await this.getZlib();

    return new Promise((resolve, reject) => {
      const zlibOptions: Record<string, unknown> = {};

      // Set max output size if specified
      if (options?.maxSize) {
        zlibOptions.maxOutputLength = options.maxSize;
      }

      const callback = (error: Error | null, result: Buffer) => {
        if (error) {
          reject(new CompressionError(`Node decompression failed: ${error.message}`, error));
        } else {
          resolve(new Uint8Array(result));
        }
      };

      if (algorithm === CompressionAlgorithm.GZIP) {
        zlib.gunzip(data, zlibOptions, callback);
      } else {
        zlib.inflateRaw(data, zlibOptions, callback);
      }
    });
  }

  compressSync(data: Uint8Array, options?: CompressionOptions): Uint8Array {
    const algorithm = options?.algorithm ?? CompressionAlgorithm.DEFLATE;

    if (algorithm === CompressionAlgorithm.NONE) {
      return data;
    }

    const zlib = this.getZlibSync();

    try {
      const zlibOptions = {
        level: options?.level ?? 6,
      };

      let result: Buffer;
      if (algorithm === CompressionAlgorithm.GZIP) {
        result = zlib.gzipSync(data, zlibOptions);
      } else {
        result = zlib.deflateRawSync(data, zlibOptions);
      }

      return new Uint8Array(result);
    } catch (error) {
      throw new CompressionError(
        `Node sync compression failed: ${error instanceof Error ? error.message : error}`,
        error,
      );
    }
  }

  decompressSync(data: Uint8Array, options?: DecompressionOptions): Uint8Array {
    const algorithm = options?.algorithm ?? CompressionAlgorithm.DEFLATE;

    if (algorithm === CompressionAlgorithm.NONE) {
      return data;
    }

    const zlib = this.getZlibSync();

    try {
      const zlibOptions: Record<string, unknown> = {};

      // Set max output size if specified
      if (options?.maxSize) {
        zlibOptions.maxOutputLength = options.maxSize;
      }

      let result: Buffer;
      if (algorithm === CompressionAlgorithm.GZIP) {
        result = zlib.gunzipSync(data, zlibOptions);
      } else {
        result = zlib.inflateRawSync(data, zlibOptions);
      }

      return new Uint8Array(result);
    } catch (error) {
      throw new CompressionError(
        `Node sync decompression failed: ${error instanceof Error ? error.message : error}`,
        error,
      );
    }
  }

  supportsSyncOperations(): boolean {
    return true;
  }
}
