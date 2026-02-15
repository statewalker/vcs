/**
 * Adapter from core Refs to transport RefStore.
 */

import type { Refs } from "@statewalker/vcs-core";
import type { RefStore } from "@statewalker/vcs-transport";

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
