# @statewalker/content-transfer

Resumable, chunk-aware byte mover over the `@statewalker/webrun-streams` duplex substrate.

## Overview

Given the object ids a destination needs, `content-transfer` transfers only the chunks the destination is **missing** from a source `ContentStore` to a destination store, over the domain-neutral `webrun-streams` `Duplex` substrate. It is **symmetric** — either endpoint may be a wire `remoteStore` proxy in front of a `serveStore` handler (upload = remote `to`, download = remote `from`). Every received chunk is verified by re-hash before it is written, and a serializable checkpoint makes an interrupted transfer resumable.

It is shared infrastructure: the Phase-4 chunk-dedup `Transfer` that plugs into `@statewalker/files-sync`, and the engine `@statewalker/vcs-transport-xet` wraps as a Git LFS custom transfer agent. It builds on `@statewalker/content-store` and knows nothing of git, LFS, or sync — it moves opaque chunks between two content stores.

## Installation

```bash
pnpm add @statewalker/content-transfer
```

## Quick Start

```typescript
import { createHash } from "node:crypto";
import { memBlobStore } from "@statewalker/storage";
import { createContentStore } from "@statewalker/content-store";
import { transfer } from "@statewalker/content-transfer";

async function sha256(bytes: AsyncIterable<Uint8Array>): Promise<string> {
  const h = createHash("sha256");
  for await (const chunk of bytes) h.update(chunk);
  return `sha256:${h.digest("hex")}`;
}
const mkStore = () =>
  createContentStore({ chunks: memBlobStore(), manifests: memBlobStore(), hashContent: sha256 });

const from = mkStore();
const to = mkStore();
async function* streamOf(b: Uint8Array) { yield b; }
const { id } = await from.put(streamOf(payload));

// Move only the chunks `to` is missing; re-hash-verify each; emit progress.
for await (const event of transfer([id], from, to, { hashContent: sha256 })) {
  if (event.type === "object-done") console.log("done", event.objectId);
}
// to.read(id) now reconstructs the identical object.
```

For a remote peer, wrap a `webrun-streams` `Duplex`:

```typescript
import { remoteStore, serveStore } from "@statewalker/content-transfer";

const handler = serveStore(serverStore);   // server: Duplex handler over a ContentStore
const remote = remoteStore(clientDuplex);  // client: an AssemblingStore proxy
await drain(transfer([id], from, remote, { hashContent: sha256 })); // upload to the remote
```

## API

- **`transfer(objectIds, from, to, opts?): AsyncGenerator<TransferEvent>`** — the mover. Negotiates missing chunks per object, streams them, verifies by re-hash, and assembles. Events: `resumed` / `negotiated` / `chunk-sent` / `object-done`.
- **`remoteStore(call: Duplex): AssemblingStore`** — client-side proxy `ContentStore` over a duplex (adds `putManifest` / `capabilities`).
- **`serveStore(store): Duplex`** — server-side handler exposing a `ContentStore` over a duplex.
- **`chunkTransfer(local, remote): FileTransfer`** — the `files-sync`-shaped `Transfer` adapter.

`TransferOptions` carries optional `limits` (`TransferLimits`: `concurrency`, `maxBufferedBytes`, `batchSize`), `checkpoint` (`TransferCheckpoint`), and `hashContent`. Types: `AssemblingStore`, `Capabilities`, `TransferEvent`, `HashContent`.

## Notes

- **Integrity by re-hash.** The re-hash of a received chunk must equal its id (the same injected `hashContent` both stores use) or the chunk is rejected and the transfer fails loudly.
- **Resumable + bounded.** A serializable `TransferCheckpoint` (done / pending chunk sets) resumes an interrupted transfer after re-verifying the source still holds every object; the pipeline is bounded by `TransferLimits` + `maxBufferedBytes` backpressure.
- **Symmetric wire.** `hasChunks` negotiation is batched; the `remoteStore` proxy can `putManifest` so assemble costs only the manifest, not the object's bytes.
- Built red/green TDD.
