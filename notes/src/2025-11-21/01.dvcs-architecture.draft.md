# DVCS Architecture Draft
## Git/Fossil Compatible, TypeScript, Streaming-Based


## Overview

This draft summarizes the architecture for a TypeScript-based
Distributed Version Control System (DVCS) compatible with *Git* and
*Fossil*, while supporting *custom storages*, *Fossil-style
deltas*, *streaming I/O*, and *WinterTC APIs*.

The core idea is strict separation between *domain logic* and
*persistence*, enabling interchangeable backends such as `.git`
directories, Fossil SQLite databases, or custom KV/SQL stores.

------------------------------------------------------------------------

## Architecture Layers

### 1. Core Domain Layer

Pure TypeScript, no I/O. Contains: 
*  Object identifiers, commits, trees,
blobs, tags, branches. 
*  Algorithms for commit creation, merge, history
traversal, etc.

### 2. Storage Abstraction Layer

Defines high-level SCM concepts decoupled from physical formats.

Key abstractions: 
* `BinaryStore` -- reads/writes raw byte streams.
* `ObjectStore` -- stores blobs/trees/commits/tags. 
* `TreeStore` -- stores file trees. 
* `RefStore` -- manages branches/tags.
* `HistoryStore` -- traversal and metadata. 

Entirely based on`AsyncIterable<Uint8Array>`.

Supports multiple backends:
* Git filesystem (.git)
* Fossil SQLite DB
* Native DVCS store (SQL/KV)

### 3. Delta Engine

Uses Fossil binary diff algorithm.\
Exposes streaming API: 
* `createDelta(base, target) -> ByteStream`
* `applyDelta(base, delta) -> ByteStream`

Deltas are used for compact storage in custom backends.

### 4. Protocol Layer

Implements: 
*  Git Wire Protocol (pkt-line, v2) 
*  Fossil Sync (`/xfer`)

Over a transport-agnostic `DuplexStream` that can run on: 
*  WinterTC
sockets API 
*  Fetch streaming 
*  WebSockets

### 5. Transport Layer

Abstracts runtime differences using WinterTC-compatible primitives: -
`fetch` 
*  Streams 
*  Sockets (when available) 
*  Browser FS APIs (OPFS,
File System Access)

### 6. Repository Facade

Combines ObjectStore, TreeStore, RefStore, Protocols into a unified
API: 
*  `open()` 
*  `clone()` 
*  `fetch()` 
*  `commit()` 
*  `checkout()` -
Works over any backend or protocol.

------------------------------------------------------------------------

## Storage Backends

### Git `.git` Backend

Implements: 
*  Loose objects, zlib compression 
*  Packfile parsing -
`.git/refs`, `packed-refs` 
*  Git tree object encoding/decoding

Enables reading/writing standard bare Git repositories.

### Fossil SQLite Backend

Implements: 
*  `blob` and `delta` tables 
*  Manifest interpretation
(commit trees) 
*  Artifact-based object representation

Uses WASM SQLite in browser environments.

### Native Compact Store

Stores objects using Fossil-style deltas for efficient disk usage. 
*  SQL
or KV implementation 
*  Short delta chains, periodic repacking -
Streaming reads and writes

------------------------------------------------------------------------

## Streaming Convention

Core type:

    type ByteStream = AsyncIterable<Uint8Array>;

Bridges: 
*  `ReadableStream <-> AsyncIterable` 
*  Chunked file
reads/writes 
*  Chunked HTTP streaming for Git/Fossil protocols

------------------------------------------------------------------------

## Protocol Compatibility

### Git

Implements: 
*  pkt-line 
*  capability negotiation 
*  fetch/push logic

### Fossil

Implements: 
*  `/xfer` protocol 
*  artifact exchange 
*  sync/merge workflow

------------------------------------------------------------------------

## Suggested Implementation Phases

### Phase 0: Core + Streams

-   Core types and algorithms
-   Stream utilities
-   Hashing (SHA‑1, SHA‑256)

### Phase 1: Git Backend

-   Git filesystem storage
-   Git objects/trees/refs
-   Bare repo read/write

### Phase 2: Fossil Backend

-   SQLite blob/delta access
-   Manifest parsing and creation

### Phase 3: Delta Engine + Native Store

-   Fossil delta streaming wrapper
-   Custom SQL/KV compact store

### Phase 4: Protocol Support

-   Git fetch/push over HTTP/WebSocket
-   Fossil `/xfer` sync

### Phase 5: High-Level Porcelain

-   Branch, merge, rebase, tagging
-   GC/packing
-   Cross-backend migration

------------------------------------------------------------------------

## Summary

This DVCS architecture allows: 
*  Full compatibility with Git and
Fossil 
*  Interchangeable storage backends 
*  Efficient binary storage
using Fossil deltas 
*  Browser-ready execution using WinterTC APIs 
*  Pure
TypeScript domain logic decoupled from persistence

The system is designed for extensibility, streaming safety, and protocol
correctness.
