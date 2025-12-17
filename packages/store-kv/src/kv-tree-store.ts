/**
 * KV-based TreeStore implementation
 *
 * Stores tree objects using a key-value backend with JSON serialization.
 */

import type { ObjectId, TreeEntry, TreeStore } from "@webrun-vcs/vcs";
import { FileMode } from "@webrun-vcs/vcs";
import type { KVStore } from "./kv-store.js";

/**
 * Well-known empty tree SHA-1 hash
 */
const EMPTY_TREE_ID = "4b825dc642cb6eb9a060e54bf8d69288fbee4904";

/**
 * Key prefix for tree data
 */
const TREE_PREFIX = "tree:";

/**
 * Serialized tree entry format
 */
interface SerializedEntry {
  m: number; // mode
  n: string; // name
  i: string; // id
}

/**
 * Compare tree entries for canonical Git sorting.
 */
function compareTreeEntries(a: TreeEntry, b: TreeEntry): number {
  const aName = a.mode === FileMode.TREE ? `${a.name}/` : a.name;
  const bName = b.mode === FileMode.TREE ? `${b.name}/` : b.name;
  return aName < bName ? -1 : aName > bName ? 1 : 0;
}

/**
 * Simple hash function for generating deterministic object IDs.
 */
function computeTreeHash(entries: TreeEntry[]): ObjectId {
  const content = entries.map((e) => `${e.mode.toString(8)} ${e.name}\0${e.id}`).join("");

  let hash = 2166136261;
  for (let i = 0; i < content.length; i++) {
    hash ^= content.charCodeAt(i);
    hash = Math.imul(hash, 16777619);
  }

  const hex = (hash >>> 0).toString(16).padStart(8, "0");
  return `tree${hex}${"0".repeat(28)}`;
}

/**
 * Text encoder/decoder for JSON serialization
 */
const encoder = new TextEncoder();
const decoder = new TextDecoder();

/**
 * KV-based TreeStore implementation.
 */
export class KVTreeStore implements TreeStore {
  constructor(private kv: KVStore) {}

  /**
   * Store a tree from a stream of entries.
   */
  async storeTree(entries: AsyncIterable<TreeEntry> | Iterable<TreeEntry>): Promise<ObjectId> {
    // Collect entries
    const entryArray: TreeEntry[] = [];

    if (Symbol.asyncIterator in entries) {
      for await (const entry of entries as AsyncIterable<TreeEntry>) {
        entryArray.push({ mode: entry.mode, name: entry.name, id: entry.id });
      }
    } else {
      for (const entry of entries as Iterable<TreeEntry>) {
        entryArray.push({ mode: entry.mode, name: entry.name, id: entry.id });
      }
    }

    // Empty tree has well-known hash
    if (entryArray.length === 0) {
      return EMPTY_TREE_ID;
    }

    // Sort entries canonically
    entryArray.sort(compareTreeEntries);

    // Compute hash
    const treeId = computeTreeHash(entryArray);

    // Check if tree already exists (deduplication)
    if (await this.kv.has(`${TREE_PREFIX}${treeId}`)) {
      return treeId;
    }

    // Serialize and store
    const serialized: SerializedEntry[] = entryArray.map((e) => ({
      m: e.mode,
      n: e.name,
      i: e.id,
    }));

    await this.kv.set(`${TREE_PREFIX}${treeId}`, encoder.encode(JSON.stringify(serialized)));

    return treeId;
  }

  /**
   * Load tree entries as a stream.
   */
  async *loadTree(id: ObjectId): AsyncIterable<TreeEntry> {
    // Empty tree
    if (id === EMPTY_TREE_ID) {
      return;
    }

    const data = await this.kv.get(`${TREE_PREFIX}${id}`);
    if (!data) {
      throw new Error(`Tree ${id} not found`);
    }

    const serialized: SerializedEntry[] = JSON.parse(decoder.decode(data));

    for (const entry of serialized) {
      yield {
        mode: entry.m,
        name: entry.n,
        id: entry.i,
      };
    }
  }

  /**
   * Get a specific entry from a tree.
   */
  async getEntry(treeId: ObjectId, name: string): Promise<TreeEntry | undefined> {
    // Empty tree
    if (treeId === EMPTY_TREE_ID) {
      return undefined;
    }

    const data = await this.kv.get(`${TREE_PREFIX}${treeId}`);
    if (!data) {
      throw new Error(`Tree ${treeId} not found`);
    }

    const serialized: SerializedEntry[] = JSON.parse(decoder.decode(data));
    const found = serialized.find((e) => e.n === name);

    return found
      ? {
          mode: found.m,
          name: found.n,
          id: found.i,
        }
      : undefined;
  }

  /**
   * Check if tree exists.
   */
  async hasTree(id: ObjectId): Promise<boolean> {
    // Empty tree always exists
    if (id === EMPTY_TREE_ID) {
      return true;
    }

    return this.kv.has(`${TREE_PREFIX}${id}`);
  }

  /**
   * Get the empty tree ObjectId.
   */
  getEmptyTreeId(): ObjectId {
    return EMPTY_TREE_ID;
  }
}
