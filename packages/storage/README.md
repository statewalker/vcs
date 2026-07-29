# @statewalker/storage

Domain-neutral byte-persistence seam: an immutable content-addressed `BlobStore` and a mutable `KvStore` with atomic compare-and-set.

## Overview

`storage` is the persistence seam both axes of the two-axis VCS architecture plug into. It defines two small low-level primitives — a `BlobStore` (immutable, keyed by a caller-supplied id, with ranged reads and byte `size`) and a `KvStore` (mutable, keyed, with an atomic `cas`) — plus a thin typed `RefStore` facade over the KV primitive. It stores bytes and nothing more: it knows nothing of git objects, chunks, or hashing algorithms (**the caller owns every id**).

Adapters implement the two primitives over different backends; `content-store` and `vcs-core` ride on top. This package ships an in-memory adapter and a `FilesApi`-backed adapter; SQL / KV backends are separate adapters over the same interfaces.

## Installation

```bash
pnpm add @statewalker/storage
```

## Quick Start

```typescript
import { MemFilesApi } from "@statewalker/webrun-files-mem";
import { filesBlobStore, memBlobStore, memKvStore, refStore } from "@statewalker/storage";

// Immutable, content-addressed blobs (in-memory, or over any FilesApi):
const blobs = memBlobStore();
const overFiles = filesBlobStore(new MemFilesApi());

async function* streamOf(...parts: string[]) {
  for (const p of parts) yield new TextEncoder().encode(p);
}

await blobs.put("a1", streamOf("hello ", "world")); // caller owns the id
await blobs.has("a1"); // true
await blobs.size("a1"); // 11, or -1 if absent
const tail = blobs.get("a1", { start: 6 }); // ranged read -> "world"

// Mutable KV with atomic compare-and-set, and the ref facade over it:
const kv = memKvStore();
const created = await kv.cas("head", undefined, new TextEncoder().encode("v1")); // true (create)

const refs = refStore(kv);
await refs.compareAndSet("refs/heads/main", undefined, "commit-1");
const id = await refs.read("refs/heads/main"); // "commit-1"
```

## API

- **`BlobStore`** — `put(id, bytes, opts?)` (streaming, bounded-memory; `opts.verify` re-derives and checks the id), `get(id, range?)` with `{ start?, end? }` (end exclusive), `has(id)`, `remove(id)`, `size(id)` (`-1` when absent), `list(prefix?)`. Re-putting the same id is idempotent. `ObjectStore` is an alias.
- **`KvStore`** — `get` / `put` / `remove` / `list`, plus `cas(key, expected, next)` (writes and returns `true` only if the current value deep-equals `expected`; `next === undefined` deletes).
- **`RefStore`** — thin string-id facade over a `KvStore`: `read`, `compareAndSet`, `list`.

**Adapters & facade:** `memBlobStore()`, `memKvStore()`, `filesBlobStore(files, opts?)`, `refStore(kv)`.

## Notes

- **Hash-agnostic.** `put(id, …)` takes the id from the caller — `content-store` hashes chunks, `vcs-core` computes git object ids. Optional integrity verification is a caller-injected `verify` on `put`.
- **CAS is a required primitive** so `RefStore` always gets atomic compare-and-set with no per-consumer branching.
- **One backend object per blob;** packing/CDC-grouping lives in the layers above (`vcs-core` packfiles, `content-store` chunks).
- The same behavioural suite runs against every adapter (mem and files), and the seam is bounded-memory by construction. Built red/green TDD.
