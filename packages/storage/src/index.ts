/**
 * @statewalker/storage
 *
 * Domain-neutral byte-persistence seam: an immutable content-addressed
 * {@link BlobStore} and a mutable {@link KvStore} with atomic compare-and-set,
 * plus a thin {@link RefStore} facade — all over the webrun-files FilesApi.
 * The seam stores bytes; it knows nothing of git objects, chunks, or hashing.
 */

export { refStore } from "./facades.js";
export { type FilesBlobStoreOptions, filesBlobStore } from "./files-blob-store.js";
export { memBlobStore, memKvStore } from "./mem.js";
export type { BlobStore, ByteStream, KvStore, ObjectStore, RefStore } from "./types.js";
