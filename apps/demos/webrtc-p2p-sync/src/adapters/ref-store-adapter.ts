/**
 * Adapter from core Refs interface to transport RefStore interface.
 *
 * The transport layer's RefStore has a simpler interface than the core Refs:
 * - get(name) returns string|undefined (not RefValue)
 * - update(name, oid) instead of set(name, oid)
 * - listAll() returns Iterable<[string, string]> (not AsyncIterable<RefEntry>)
 */

import type { Refs } from "@statewalker/vcs-core";
import type { RefStore } from "@statewalker/vcs-transport";

/**
 * Create a transport RefStore from a core Refs instance.
 *
 * Resolves symbolic refs to their final object IDs.
 * Skips refs with undefined objectIds (unborn branches).
 *
 * @param refs - Core Refs instance
 * @returns Transport RefStore interface
 */
export function createRefStoreAdapter(refs: Refs): RefStore {
  return {
    async get(name: string): Promise<string | undefined> {
      const resolved = await refs.resolve(name);
      return resolved?.objectId;
    },

    async update(name: string, oid: string): Promise<void> {
      await refs.set(name, oid);
    },

    async listAll(): Promise<Iterable<[string, string]>> {
      const result: [string, string][] = [];
      for await (const entry of refs.list()) {
        if ("objectId" in entry && entry.objectId !== undefined) {
          result.push([entry.name, entry.objectId]);
        }
      }
      return result;
    },
  };
}
