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
  type PartialDecompressionResult,
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
      } else if (algorithm === CompressionAlgorithm.ZLIB) {
        zlib.deflate(data, zlibOptions, callback);
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
      } else if (algorithm === CompressionAlgorithm.ZLIB) {
        zlib.inflate(data, zlibOptions, callback);
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
      } else if (algorithm === CompressionAlgorithm.ZLIB) {
        result = zlib.deflateSync(data, zlibOptions);
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
      } else if (algorithm === CompressionAlgorithm.ZLIB) {
        result = zlib.inflateSync(data, zlibOptions);
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

  async decompressPartial(
    data: Uint8Array,
    options?: DecompressionOptions,
  ): Promise<PartialDecompressionResult> {
    const algorithm = options?.algorithm ?? CompressionAlgorithm.ZLIB;

    if (algorithm === CompressionAlgorithm.NONE) {
      return { data, bytesRead: data.length };
    }

    const zlib = await this.getZlib();

    return new Promise((resolve, reject) => {
      // Create appropriate inflater based on algorithm
      let inflater:
        | import("node:zlib").Inflate
        | import("node:zlib").Gunzip
        | import("node:zlib").InflateRaw;
      if (algorithm === CompressionAlgorithm.GZIP) {
        inflater = zlib.createGunzip();
      } else if (algorithm === CompressionAlgorithm.ZLIB) {
        inflater = zlib.createInflate();
      } else {
        inflater = zlib.createInflateRaw();
      }

      const chunks: Buffer[] = [];
      let totalSize = 0;
      let bytesRead = data.length; // Default to full input

      inflater.on("data", (chunk: Buffer) => {
        chunks.push(chunk);
        totalSize += chunk.length;

        // Check max size limit
        if (options?.maxSize && totalSize > options.maxSize) {
          inflater.destroy(
            new Error(
              `Decompressed size (${totalSize}) exceeds maximum allowed (${options.maxSize})`,
            ),
          );
        }
      });

      inflater.on("end", () => {
        const result = Buffer.concat(chunks, totalSize);
        // Calculate bytes read from bytesWritten on the inflater
        // Node's zlib exposes bytesWritten which is how many input bytes were consumed
        const inflaterAny = inflater as { bytesWritten?: number };
        if (typeof inflaterAny.bytesWritten === "number") {
          bytesRead = inflaterAny.bytesWritten;
        }
        resolve({ data: new Uint8Array(result), bytesRead });
      });

      inflater.on("error", (err) => {
        // If we got some data, the error might be due to trailing data
        // This is expected for partial decompression
        if (totalSize > 0) {
          const result = Buffer.concat(chunks, totalSize);
          const inflaterAny = inflater as { bytesWritten?: number };
          if (typeof inflaterAny.bytesWritten === "number") {
            bytesRead = inflaterAny.bytesWritten;
          }
          resolve({ data: new Uint8Array(result), bytesRead });
        } else {
          reject(new CompressionError(`Decompression failed: ${err.message}`, err));
        }
      });

      // Write data and signal end of input
      inflater.write(Buffer.from(data));
      inflater.end();
    });
  }
}
