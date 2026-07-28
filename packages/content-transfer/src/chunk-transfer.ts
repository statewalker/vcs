/**
 * files-sync interop: adapt content-store dedup transfer to the files-sync
 * {@link https://github.com/statewalker/vcs `Transfer`} seam. The returned object
 * is structurally a files-sync `Transfer` (kept structural so `src/` stays
 * domain-neutral and never imports files-sync). For a copy/update it ingests the
 * source file into the `local` store, moves the missing chunks to `remote` via
 * {@link transfer}, then writes the reassembled bytes to the destination — so a
 * file whose chunks the remote already holds costs nothing to move.
 */

import type { ContentStore } from "@statewalker/content-store";
import type { FilesApi } from "@statewalker/webrun-files";
import { transfer } from "./transfer.js";

/** The subset of a files-sync `SyncAction` this adapter reads (structural). */
export interface FileSyncAction {
  kind: string;
  path?: string;
}

/** Structurally compatible with files-sync's `Transfer`. */
export interface FileTransfer {
  run(action: FileSyncAction, from: FilesApi, to: FilesApi): Promise<void>;
}

export function chunkTransfer(local: ContentStore, remote: ContentStore): FileTransfer {
  return {
    async run(action, from, to) {
      if (action.kind !== "copy" && action.kind !== "update") {
        throw new Error(
          `content-transfer: chunkTransfer only handles copy/update, got ${action.kind}`,
        );
      }
      const path = action.path;
      if (!path) throw new Error(`content-transfer: ${action.kind} action has no path`);

      const descriptor = await local.put(from.read(path));

      const events = transfer([descriptor.id], local, remote);
      const iterator = events[Symbol.asyncIterator]();
      while (!(await iterator.next()).done) {
        /* drain the transfer to completion */
      }

      await to.write(path, remote.read(descriptor.id));
    },
  };
}
