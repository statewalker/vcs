/**
 * @statewalker/content-store
 *
 * Domain-neutral, content-addressed large-object store. It stores large byte
 * streams as deduplicated, content-defined chunks over the `@statewalker/storage`
 * BlobStore seam. It is algorithm-agnostic — object and chunk identities are
 * computed by an injected `hashContent`, and every id is an opaque string. It
 * knows nothing of git, LFS, SHA-256, commits, or sync.
 */

export { createContentStore } from "./content-store.js";
export type {
  ByteStream,
  CdcParams,
  ChunkId,
  ChunkRef,
  ContentStore,
  ContentStoreDeps,
  ContentStoreOptions,
  ObjectDescriptor,
  ObjectId,
} from "./types.js";
