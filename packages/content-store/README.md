# @statewalker/content-store

Domain-neutral, content-addressed large-object store with content-defined chunking and deduplication.

## Overview

`content-store` persists large byte streams as deduplicated, content-defined chunks over the `@statewalker/storage` `BlobStore` seam. It is **algorithm-agnostic**: the whole-object and per-chunk identities are computed by an **injected `hashContent`**, and every id is treated as an opaque string (it carries whatever prefix the hasher produces). The content-defined chunker lives in-package; content below a threshold is stored as a single direct blob.

It is shared infrastructure for both axes: it backs Axis A's "ask which chunks exist → send only the missing → assemble" transfer flow (via `@statewalker/content-transfer`) and Axis B's LFS-pointer-to-object indirection (`@statewalker/vcs-transport-lfs` / `-xet`). It knows nothing of git, LFS, SHA-256, commits, or sync — those live in the skins above it.

## Installation

```bash
pnpm add @statewalker/content-store
```

## Quick Start

```typescript
import { createHash } from "node:crypto";
import { memBlobStore } from "@statewalker/storage";
import { createContentStore } from "@statewalker/content-store";

async function sha256(bytes: AsyncIterable<Uint8Array>): Promise<string> {
  const h = createHash("sha256");
  for await (const chunk of bytes) h.update(chunk);
  return `sha256:${h.digest("hex")}`;
}

const store = createContentStore(
  { chunks: memBlobStore(), manifests: memBlobStore(), hashContent: sha256 },
  { chunkThreshold: 64, cdc: { min: 64, avg: 256, max: 1024 } },
);

async function* streamOf(bytes: Uint8Array) { yield bytes; }

// Object level: chunk + hash in one bounded-memory pass.
const d = await store.put(streamOf(payload)); // ObjectDescriptor { id, size, chunks }
const whole = store.read(d.id);               // reassembled stream
const slice = store.read(d.id, { offset: 3000, length: 2500 }); // arbitrary range across chunks

// Chunk level: negotiate and move only what a peer is missing.
const missing = await store.hasChunks(d.chunks.map((c) => c.id)); // ids NOT present
await store.gc([d.id]); // sweep everything not reachable from the live roots
```

## API

**Object level**
- `put(content): Promise<ObjectDescriptor>` — chunk + hash in a bounded-memory pass, store chunks + manifest.
- `read(id, range?)` — stream the object's bytes, optionally sliced by `{ offset?, length? }`; empty stream if absent.
- `has(id)`, `getManifest(id)`, `remove(id)`.

**Chunk level** (transfer / dedup)
- `hasChunks(ids): Promise<ChunkId[]>` — return exactly the ids **not** present.
- `putChunk(id, bytes)`, `getChunk(id)`.

**Maintenance**
- `gc(liveRoots): Promise<{ removedObjects, removedChunks }>` — mark-sweep from caller-supplied roots.

**Factory:** `createContentStore(deps, opts?)`, where `deps` is `{ chunks: BlobStore, manifests: BlobStore, hashContent }` and `opts` is `{ chunkThreshold?, cdc? }`. Types: `ContentStore`, `ObjectDescriptor`, `ChunkRef`, `ObjectId`, `ChunkId`, `CdcParams`.

## Notes

- **Injected hash, opaque ids.** The contract sketch spoke of intrinsic BLAKE3; the shipped code takes an injected `hashContent` and treats every id as opaque — the store commits to no algorithm, and object/chunk ids simply carry the hasher's own prefix.
- **CDC + direct-blob threshold.** Content-defined chunking (so dedup survives inserts/shifts) is the default; content strictly below `chunkThreshold` is stored as a single blob with no chunking overhead. `hasChunks`/`getChunk`/`putChunk` let `content-transfer` move only missing chunks.
- **Immutable + external liveness.** Chunks and objects are immutable and content-addressed; there are no refcounts — `gc(liveRoots)` reaches objects→chunks from caller roots and sweeps the rest.
- Built red/green TDD.
