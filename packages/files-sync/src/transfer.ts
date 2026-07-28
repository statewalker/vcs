/**
 * The default {@link Transfer}: a whole-file copy.
 *
 * When source and destination are the SAME backend instance, it uses the
 * backend's native server-side `copy` ("capabilities allow"). Across two
 * distinct backends — the normal sync case, and all MemFilesApi pairs — it falls
 * back to streaming the bytes through `to.write(from.read(...))`.
 *
 * A later phase can plug a chunk-dedup Transfer into this same seam.
 */

import type { FilesApi } from "@statewalker/webrun-files";
import type { SyncAction, Transfer } from "./types.js";

export function createStreamingTransfer(): Transfer {
  return {
    async run(action: SyncAction, from: FilesApi, to: FilesApi): Promise<void> {
      if (action.kind !== "copy" && action.kind !== "update") {
        throw new Error(`streaming transfer only handles copy/update, got ${action.kind}`);
      }
      const path = action.path;
      if (from === to) {
        // Same backend: server-side copy avoids round-tripping the bytes.
        await from.copy(path, path);
        return;
      }
      await to.write(path, from.read(path));
    },
  };
}
