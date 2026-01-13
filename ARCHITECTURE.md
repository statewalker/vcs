# StateWalker VCS Architecture

This document explains the overall architecture of the StateWalker VCS monorepo, covering design philosophy, package organization, and how the components work together.

## Design Philosophy

### Git Compatibility Without Git Dependencies

StateWalker VCS implements Git's object model and protocols entirely in TypeScript. Applications can read and write Git repositories without native Git binaries, making the library portable across Node.js, browsers, edge functions, and any JavaScript runtime.

The implementation produces identical output to native Git: same object IDs, same pack file formats, same protocol messages. Repositories created with StateWalker VCS work with standard Git tools and vice versa.

### Separation of Concerns

The architecture strictly separates three concerns:

```
┌─────────────────────────────────────────────────────────────┐
│  Commands (@statewalker/vcs-commands)                            │
│  High-level operations: clone, fetch, push, commit          │
├─────────────────────────────────────────────────────────────┤
│  Core Interfaces (@statewalker/vcs-core)                         │
│  Storage contracts, object model, format specifications     │
├─────────────────────────────────────────────────────────────┤
│  Storage Backends (@statewalker/vcs-store-*)                  │
│  Concrete implementations for different storage systems     │
└─────────────────────────────────────────────────────────────┘
```

This separation enables:
- **Multiple backends**: Same VCS logic works with filesystem, SQLite, IndexedDB, or cloud storage
- **Testing flexibility**: In-memory implementations enable fast unit tests
- **Platform portability**: Core logic has no platform-specific dependencies

### Streaming by Default

Large repositories can contain files of any size. Rather than loading entire files into memory, all content flows through `AsyncIterable<Uint8Array>` streams. This design keeps memory consumption bounded regardless of file size.

### JGit-Inspired Implementation

The type system and algorithms align with Eclipse JGit, a mature Java implementation of Git. This alignment provides proven patterns for Git compatibility and clear precedent for edge cases.

## Package Dependency Graph

```
                    ┌──────────────────┐
                    │    commands      │
                    │   (Git API)      │
                    └────────┬─────────┘
                             │
          ┌──────────────────┼──────────────────┐
          │                  │                  │
          ▼                  ▼                  ▼
┌─────────────────┐  ┌──────────────┐  ┌──────────────┐
│   transport     │  │  store-mem   │  │  store-sql   │
│  (protocols)    │  │  (testing)   │  │  (persist)   │
└────────┬────────┘  └──────┬───────┘  └──────┬───────┘
         │                  │                 │
         └──────────────────┼─────────────────┘
                            │
                            ▼
                   ┌──────────────────┐
                   │       core       │
                   │ (repository,     │
                   │  stores, packs,  │
                   │  staging, refs)  │
                   └────────┬─────────┘
                            │
                            ▼
                      ┌───────────┐
                      │   utils   │
                      │(algorithms)│
                      └───────────┘
```

### Foundation Layer

**@statewalker/vcs-utils** provides pure algorithmic implementations with zero VCS-specific dependencies:
- Cryptographic hashing (SHA-1, CRC32, rolling checksums)
- JGit-compatible rolling hash (16-byte blocks with T[]/U[] lookup tables)
- Compression (zlib via pako, optional Node.js native)
- Diff algorithms (Myers text diff, binary delta encoding)
- Git delta format encoding/decoding
- Streaming utilities

**@statewalker/vcs-core** defines the VCS contracts and object model:
- Store interfaces (RawStore, GitObjectStore, CommitStore, etc.)
- Git object types (blob, tree, commit, tag)
- Reference management
- Pack file format
- Delta compression system

### Storage Layer

Storage backends implement core interfaces for different systems:

| Package | Storage Target | Use Case |
|---------|---------------|----------|
| `@statewalker/vcs-core` | Git `.git/` directory | Native Git compatibility |
| `@statewalker/vcs-store-mem` | Memory | Testing, ephemeral repos |
| `@statewalker/vcs-store-sql` | SQLite | Server deployments |
| `@statewalker/vcs-store-kv` | Key-value stores | Custom backends |
| `@statewalker/vcs-sandbox` | Isolated storage | Safe experimentation |

Note: `@statewalker/vcs-core` includes Git filesystem storage, staging/index area, delta storage engine, and working tree iteration - all consolidated from previously separate packages.

### Protocol Layer

**@statewalker/vcs-transport** implements Git's network protocols:
- HTTP smart protocol (v1 and v2)
- Pkt-line encoding
- Capability negotiation
- Pack transfer
- Server-side handlers (UploadPack, ReceivePack)

### Command Layer

**@statewalker/vcs-commands** provides high-level operations:
- Clone, fetch, push
- Commit, checkout
- Branch management

## Layered Store Architecture

Each storage backend implements a layered structure:

```
┌─────────────────────────────────────────────────────────────┐
│                      Repository                              │
│  Unified entry point with lifecycle management               │
├─────────────────────────────────────────────────────────────┤
│  CommitStore    TreeStore    BlobStore    TagStore           │
│  Semantic operations on specific object types                │
├─────────────────────────────────────────────────────────────┤
│                    GitObjectStore                            │
│  Unified object storage with type headers                    │
├─────────────────────────────────────────────────────────────┤
│               BinStore (binary storage)                      │
│  Combines raw storage with delta compression                 │
├─────────────────────────────────────────────────────────────┤
│    RawStore              DeltaStore                          │
│    (key-value bytes)     (delta relationships)               │
└─────────────────────────────────────────────────────────────┘
```

### RawStore - Foundation

The lowest layer provides key-value byte storage:

```typescript
interface RawStore {
  store(key: string, content: AsyncIterable<Uint8Array>): Promise<void>;
  load(key: string): AsyncIterable<Uint8Array>;
  has(key: string): Promise<boolean>;
  delete(key: string): Promise<boolean>;
  keys(): AsyncIterable<string>;
}
```

Each storage backend (filesystem, SQLite, memory) implements this interface differently.

### GitObjectStore - Type Awareness

Adds Git object semantics (type headers, content hashing):

```typescript
interface GitObjectStore {
  store(type: ObjectTypeString, content: AsyncIterable<Uint8Array>): Promise<ObjectId>;
  load(id: ObjectId): AsyncIterable<Uint8Array>;
  getHeader(id: ObjectId): Promise<GitObjectHeader>;
  has(id: ObjectId): Promise<boolean>;
}
```

### Semantic Stores

Built on GitObjectStore, these provide domain-specific operations:

- **BlobStore**: Raw file content storage
- **TreeStore**: Directory snapshots with sorted entries
- **CommitStore**: Commits with ancestry traversal and merge base detection
- **TagStore**: Annotated tags with target resolution

## Content-Addressable Storage

Every object's ID derives from its content via SHA-1:

```
SHA-1("<type> <size>\0<content>") = ObjectId
```

This provides:
- **Automatic deduplication**: Identical files produce identical IDs
- **Integrity verification**: Corrupted objects have wrong IDs
- **Efficient sync**: Only transfer objects not already present
- **Immutability**: Changing content changes the ID

## Unified Storage Architecture

The storage layer is organized into three main APIs accessed through the `StorageBackend` interface:

```
┌─────────────────────────────────────────────────────────────┐
│                     StorageBackend                           │
│  Unified entry point for all storage operations              │
├─────────────────────────────────────────────────────────────┤
│  StructuredStores   │   DeltaApi      │   SerializationApi   │
│  (semantic objects) │   (compression) │   (format handling)  │
├─────────────────────┼─────────────────┼─────────────────────┤
│  BlobStore          │   BlobDeltaApi  │   Pack encoding      │
│  TreeStore          │   Batch ops     │   Object serializing │
│  CommitStore        │   Chain queries │   Format conversion  │
│  TagStore           │                 │                      │
│  RefStore           │                 │                      │
└─────────────────────────────────────────────────────────────┘
```

### StructuredStores - Semantic Object Access

Bundles all five Git object stores under a single interface:

```typescript
interface StructuredStores {
  readonly blobs: BlobStore;     // File content (streaming)
  readonly trees: TreeStore;     // Directory snapshots
  readonly commits: CommitStore; // Version history
  readonly tags: TagStore;       // Annotated tags
  readonly refs: RefStore;       // Branch/tag references
}
```

### DeltaApi - Compression Operations

Provides delta compression with a blobs-only strategy:

```typescript
interface DeltaApi {
  readonly blobs: BlobDeltaApi;  // Blob-specific delta operations

  isDelta(id: ObjectId): Promise<boolean>;
  getDeltaChain(id: ObjectId): Promise<DeltaChainInfo | undefined>;
  listDeltas(): AsyncIterable<DeltaRelationship>;
  getDependents(baseId: ObjectId): AsyncIterable<ObjectId>;

  // Batch operations for efficient packing
  startBatch(): void;
  endBatch(): Promise<void>;
  cancelBatch(): void;
}
```

### Blobs-Only Delta Strategy

Delta compression is applied only to blob objects, not trees or commits:

**Rationale:**
- **90%+ of storage is blobs**: File content dominates repository size
- **Trees/commits are small**: Typically < 1KB, delta overhead exceeds savings
- **Simpler GC**: No tree delta chains to manage during garbage collection
- **Faster access**: Commits/trees don't require delta reconstruction

This matches Git's internal behavior where pack files primarily deltify blobs.

## Delta Compression

Similar objects are stored as differences from a base object:

```
Source: [----A----][----B----][----C----]
Target: [----B----][--new--][----A----]

Delta:
  COPY from source offset 10, length 10  (block B)
  INSERT [--new--]                       (new data)
  COPY from source offset 0, length 10   (block A)
```

The delta system manages:
- **Delta chains**: A → B → C where C is delta of B, B is delta of A
- **Chain depth limits**: Prevent excessively long reconstruction chains
- **Candidate selection**: Find good base objects for deltaification

## Transport Protocol

The transport layer implements Git's smart HTTP protocol:

```
Client                          Server
   │                               │
   │ ── GET /info/refs ──────────► │  Discover refs
   │ ◄── refs + capabilities ───── │
   │                               │
   │ ── POST git-upload-pack ────► │  Request objects
   │    want <oid>                 │
   │    have <oid>                 │
   │    done                       │
   │ ◄── pack data (sideband) ──── │  Receive pack
   │                               │
```

Features:
- Protocol v1 and v2 support
- Capability negotiation (multi_ack, thin-pack, side-band-64k)
- Shallow clone support
- Server implementation using Web Standard APIs (Request/Response)

## Extension Points

### Custom Storage Backends

Implement the core interfaces for your storage system:

```typescript
class MyRawStore implements RawStore {
  async store(key: string, content: AsyncIterable<Uint8Array>): Promise<void> {
    // Your storage logic
  }
  // ... other methods
}
```

Then compose higher-level stores using provided implementations.

### Custom Delta Strategies

Implement `DeltaCandidateStrategy` for domain-specific delta selection:

```typescript
interface DeltaCandidateStrategy {
  findCandidates(targetId: ObjectId, storage: StorageAnalyzer): AsyncIterable<ObjectId>;
}
```

### Custom Compression

The compression layer supports pluggable implementations:

```typescript
import { setCompression } from "@statewalker/vcs-utils/compression";
import { createNodeCompression } from "@statewalker/vcs-utils/compression-node";

setCompression(createNodeCompression()); // Use native zlib
```

### Custom Authentication

The HTTP server supports flexible authentication:

```typescript
const server = createGitHttpServer({
  authenticate: async (request) => {
    // Validate credentials
  },
  authorize: async (request, repo, operation) => {
    // Check permissions for "fetch" or "push"
  },
});
```

## Development Packages

**@statewalker/vcs-testing** provides shared test utilities and fixtures for verifying storage implementations.

**@statewalker/vcs-storage-tests** contains parametrized test suites that validate any storage backend against the expected behavior.

## Performance Considerations

### Streaming Everything

Never buffer entire objects in memory. Use async generators for constant memory overhead:

```typescript
async function* processContent(input: AsyncIterable<Uint8Array>) {
  for await (const chunk of input) {
    yield transform(chunk);
  }
}
```

### Lazy Loading

Load objects only when needed. The `has()` method checks existence without loading content.

### Delta Chain Limits

Configure chain depth to balance compression ratio against reconstruction cost. Deep chains save space but slow random access.

### Pack File Optimization

Large repositories benefit from periodic repacking to optimize delta relationships and reduce file count.

## Browser Compatibility

The core packages work in browsers without polyfills:
- **@statewalker/vcs-utils**: Pure TypeScript algorithms
- **@statewalker/vcs-core**: Interface definitions and format handling (Git filesystem storage requires a FilesApi implementation)
- **@statewalker/vcs-transport**: Web Standard APIs (fetch, Request/Response)

Storage backends may have platform requirements:
- **core (Git storage)**: Requires FilesApi implementation (available for Node.js, browser IndexedDB, etc.)
- **store-sql**: Requires SQLite (Node.js only)
- **store-mem**: Works everywhere
- **store-kv**: Works with any key-value backend (IndexedDB, LocalStorage, etc.)
