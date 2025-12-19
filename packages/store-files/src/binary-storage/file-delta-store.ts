/**
 * File-based DeltaStore implementation
 *
 * Stores delta relationships and instructions in files.
 * Uses a simple JSON format for delta metadata.
 *
 * Implements the new DeltaStore interface from binary-storage.
 */

import { type FilesApi, joinPath } from "@statewalker/webrun-files";
import type { Delta } from "@webrun-vcs/utils";
import type {
  DeltaChainDetails,
  DeltaInfo,
  DeltaStore,
  StoredDelta,
} from "@webrun-vcs/vcs/binary-storage";

/**
 * Serialized delta entry format
 */
interface SerializedDelta {
  baseKey: string;
  targetKey: string;
  delta: SerializedDeltaInstruction[];
  ratio: number;
}

/**
 * Serialized delta instruction format
 */
type SerializedDeltaInstruction =
  | { type: "start"; targetLen: number }
  | { type: "copy"; start: number; len: number }
  | { type: "insert"; data: number[] }
  | { type: "finish"; checksum: number };

/**
 * Convert Delta array to serialized format
 */
function serializeDelta(delta: Delta[]): SerializedDeltaInstruction[] {
  return delta.map((d) => {
    switch (d.type) {
      case "start":
        return { type: "start", targetLen: d.targetLen };
      case "copy":
        return { type: "copy", start: d.start, len: d.len };
      case "insert":
        return { type: "insert", data: Array.from(d.data) };
      case "finish":
        return { type: "finish", checksum: d.checksum };
    }
  });
}

/**
 * Convert serialized format to Delta array
 */
function deserializeDelta(serialized: SerializedDeltaInstruction[]): Delta[] {
  return serialized.map((d) => {
    switch (d.type) {
      case "start":
        return { type: "start", targetLen: d.targetLen };
      case "copy":
        return { type: "copy", start: d.start, len: d.len };
      case "insert":
        return { type: "insert", data: new Uint8Array(d.data) };
      case "finish":
        return { type: "finish", checksum: d.checksum };
    }
  });
}

/**
 * File-based delta storage
 *
 * Stores delta relationships in files with a two-level directory structure.
 * Each delta is stored as a JSON file.
 */
export class FileDeltaStore implements DeltaStore {
  private readonly maxChainDepth = 50;

  /**
   * Create file-based delta store
   *
   * @param files FilesApi for file operations
   * @param basePath Base directory for storing deltas
   */
  constructor(
    private readonly files: FilesApi,
    private readonly basePath: string,
  ) {}

  /**
   * Get the file path for a target key
   */
  private getPath(targetKey: string): string {
    const prefix = targetKey.substring(0, 2);
    const suffix = targetKey.substring(2);
    return joinPath(this.basePath, prefix, `${suffix}.delta`);
  }

  /**
   * Ensure directory exists
   */
  private async ensureDir(path: string): Promise<void> {
    const dir = path.substring(0, path.lastIndexOf("/"));
    await this.files.mkdir(dir);
  }

  /**
   * Store a delta relationship
   */
  async storeDelta(info: DeltaInfo, delta: Delta[]): Promise<boolean> {
    const path = this.getPath(info.targetKey);
    await this.ensureDir(path);

    // Calculate ratio
    const deltaSize = delta.reduce((sum, d) => {
      switch (d.type) {
        case "copy":
          return sum + 8;
        case "insert":
          return sum + 1 + d.data.length;
        case "start":
        case "finish":
          return sum + 4;
        default:
          return sum;
      }
    }, 0);

    const ratio = deltaSize > 0 ? 1 : 0;

    const entry: SerializedDelta = {
      baseKey: info.baseKey,
      targetKey: info.targetKey,
      delta: serializeDelta(delta),
      ratio,
    };

    const encoder = new TextEncoder();
    const content = encoder.encode(JSON.stringify(entry));
    await this.files.write(path, [content]);

    return true;
  }

  /**
   * Load delta for an object
   */
  async loadDelta(targetKey: string): Promise<StoredDelta | undefined> {
    const path = this.getPath(targetKey);

    try {
      const content = await this.files.readFile(path);
      const decoder = new TextDecoder();
      const entry: SerializedDelta = JSON.parse(decoder.decode(content));

      return {
        baseKey: entry.baseKey,
        targetKey: entry.targetKey,
        delta: deserializeDelta(entry.delta),
        ratio: entry.ratio,
      };
    } catch (error) {
      if (this.isNotFoundError(error)) {
        return undefined;
      }
      throw error;
    }
  }

  /**
   * Check if object is stored as delta
   */
  async isDelta(targetKey: string): Promise<boolean> {
    const path = this.getPath(targetKey);
    return this.files.exists(path);
  }

  /**
   * Remove delta relationship
   */
  async removeDelta(targetKey: string, _keepAsBase?: boolean): Promise<boolean> {
    const path = this.getPath(targetKey);

    try {
      await this.files.remove(path);
      return true;
    } catch (error) {
      if (this.isNotFoundError(error)) {
        return false;
      }
      throw error;
    }
  }

  /**
   * Get delta chain info for an object
   */
  async getDeltaChainInfo(targetKey: string): Promise<DeltaChainDetails | undefined> {
    const entry = await this.loadDelta(targetKey);
    if (!entry) {
      return undefined;
    }

    // Build chain
    const chain: string[] = [targetKey];
    let currentKey = entry.baseKey;
    let depth = 1;
    let compressedSize = this.calculateDeltaSize(entry.delta);

    while (depth < this.maxChainDepth) {
      const baseEntry = await this.loadDelta(currentKey);
      if (!baseEntry) {
        // Found the base object
        chain.push(currentKey);
        break;
      }
      chain.push(currentKey);
      compressedSize += this.calculateDeltaSize(baseEntry.delta);
      currentKey = baseEntry.baseKey;
      depth++;
    }

    return {
      baseKey: chain[chain.length - 1],
      targetKey,
      depth,
      originalSize: 0, // Not tracked in this implementation
      compressedSize,
      chain,
    };
  }

  /**
   * Calculate approximate delta size
   */
  private calculateDeltaSize(delta: Delta[]): number {
    return delta.reduce((sum, d) => {
      switch (d.type) {
        case "copy":
          return sum + 8;
        case "insert":
          return sum + 1 + d.data.length;
        case "start":
        case "finish":
          return sum + 4;
        default:
          return sum;
      }
    }, 0);
  }

  /**
   * List all delta relationships
   */
  async *listDeltas(): AsyncIterable<DeltaInfo> {
    try {
      for await (const prefixEntry of this.files.list(this.basePath)) {
        if (prefixEntry.kind !== "directory") continue;
        if (prefixEntry.name.length !== 2) continue;

        const prefixPath = joinPath(this.basePath, prefixEntry.name);
        try {
          for await (const suffixEntry of this.files.list(prefixPath)) {
            if (suffixEntry.kind !== "file") continue;
            if (!suffixEntry.name.endsWith(".delta")) continue;

            const targetKey =
              prefixEntry.name + suffixEntry.name.replace(".delta", "");
            const stored = await this.loadDelta(targetKey);
            if (stored) {
              yield {
                baseKey: stored.baseKey,
                targetKey: stored.targetKey,
              };
            }
          }
        } catch {
          // Skip inaccessible directories
        }
      }
    } catch {
      // Base path doesn't exist or is inaccessible
    }
  }

  /**
   * Check if error is a "not found" error
   */
  private isNotFoundError(error: unknown): boolean {
    if (error && typeof error === "object" && "code" in error) {
      return (error as { code: string }).code === "ENOENT";
    }
    return false;
  }
}

/**
 * Create a new file-based delta store
 */
export function createFileDeltaStore(
  files: FilesApi,
  basePath: string,
): FileDeltaStore {
  return new FileDeltaStore(files, basePath);
}
