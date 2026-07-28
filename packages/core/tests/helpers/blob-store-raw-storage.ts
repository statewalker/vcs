/**
 * B1 spike adapter (TEST SCOPE ONLY).
 *
 * Bridges a `@statewalker/storage` {@link BlobStore} to vcs-core's
 * {@link RawStorage} byte seam so the existing git engine can run over the new
 * storage package unchanged. It is a thin pass-through: the two contracts have
 * the same shape once `BlobStore` gained a ranged `get` + `size` (B1 deliverable
 * #1), so every method maps one-to-one.
 *
 * Production placement of this adapter is decided later (B2); for the spike it
 * lives in tests only and vcs-core `src/` never imports `@statewalker/storage`.
 */

import type { BlobStore } from "@statewalker/storage";
import type { RawStorage } from "../../src/storage/raw/raw-storage.js";

export function blobStoreToRawStorage(blob: BlobStore): RawStorage {
  return {
    store: (key, content) => blob.put(key, content),
    load: (key, options) => blob.get(key, options),
    has: (key) => blob.has(key),
    remove: (key) => blob.remove(key),
    keys: () => blob.list(),
    size: (key) => blob.size(key),
  };
}
