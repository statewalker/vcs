# @statewalker/vcs-core Architecture

This document explains the internal architecture of the core package, covering design decisions, module organization, and extension points.

## Design Philosophy

### Separation of Interfaces from Implementations

The core package defines contracts, not concrete implementations. Each store interface specifies what operations must be supported without dictating how backends implement them. This separation enables:

- **Multiple backends**: The same VCS logic works with filesystem storage, SQLite, IndexedDB, or cloud storage
- **Testing flexibility**: In-memory implementations enable fast unit tests
- **Gradual migration**: Applications can switch backends without changing business logic

When you see a file like `commit-store.ts` alongside `commit-store.impl.ts`, the former defines the interface while the latter provides a reference implementation that delegates to lower-level stores.

### Storage-Agnostic Design

The package never directly touches the filesystem or database. All I/O flows through abstract interfaces:

```
Application Code
       ↓
   Core Interfaces (this package)
       ↓
   Storage Backend (@statewalker/vcs-store-*)
       ↓
   Actual Storage (filesystem, SQLite, IndexedDB, etc.)
```

This architecture means the same commit logic, tree building, and reference management work identically regardless of where data lives.

### Streaming for Memory Efficiency

Large repositories can contain files of any size. Rather than loading entire files into memory, all content flows through `AsyncIterable<Uint8Array>` streams:

```typescript
interface BlobStore {
  store(content: AsyncIterable<Uint8Array> | Iterable<Uint8Array>): Promise<ObjectId>;
  load(id: ObjectId): AsyncIterable<Uint8Array>;
}
```

This design keeps memory consumption bounded. A 1GB file streams through with constant memory overhead rather than requiring 1GB+ of RAM.

### JGit-Inspired Architecture

The type system and constants align with Eclipse JGit, a mature Java implementation of Git. This alignment provides:

- Proven patterns for Git compatibility
- Clear precedent for edge cases
- Familiar concepts for developers coming from JGit

## Object Model Architecture

Git's content-addressable storage forms the foundation:

```
GitObject (conceptual base)
├── Blob (type 3)
│   └── Raw binary content, no parsing
├── Tree (type 2)
│   └── Sorted list of TreeEntry { mode, name, id }
├── Commit (type 1)
│   └── tree + parents[] + author + committer + message
└── Tag (type 4)
    └── object + objectType + tag + tagger + message
```

### Why Content-Addressable Storage

Every object's ID derives from its content via SHA-1 hashing. This provides:

1. **Automatic deduplication**: Identical files produce identical IDs
2. **Integrity verification**: Corrupted objects have wrong IDs
3. **Efficient synchronization**: Only transfer objects not already present
4. **Immutability guarantees**: Changing content changes the ID

### Object ID Generation

The ID comes from hashing the object with its Git header:

```
SHA-1("<type> <size>\0<content>")
```

For example, a blob containing "hello" produces:

```
SHA-1("blob 5\0hello") = "b6fc4c620b67d95f953a5c1c1230aaab5db5a1b0"
```

### Serialization Format

Objects serialize to Git's wire format for compatibility:

**Tree entries**: `<mode-octal> <name>\0<20-byte-hash>`
**Commits**: Header fields as `<key> <value>\n`, blank line, then message
**Tags**: Same format as commits with different header fields

The `format/` module handles streaming serialization and deserialization.

## Store Hierarchy

The package organizes stores in layers, each building on the one below:

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

### Two-Tier API Design

The Repository exposes both `GitObjectStore` and typed stores (`blobs`, `trees`, `commits`, `tags`) because they serve different purposes:

**GitObjectStore** provides low-level, type-agnostic, format-aware access. It works with raw Git objects including their headers (`"blob 123\0content"`), enabling operations that need the wire format: transport protocols, pack file generation, and object introspection.

**Typed stores** provide high-level, type-specific, parsed interfaces. They parse object content into structured data (`Commit`, `TreeEntry[]`, etc.) and handle serialization automatically. Application code typically uses these for everyday VCS operations.

Both layers are necessary. Transport code needs raw bytes with headers to build pack files. Application code needs parsed commits to display history. The architecture exposes both rather than forcing one abstraction for all use cases.

### RawStore - Foundation Layer

The lowest layer stores raw bytes by string key:

```typescript
interface RawStore {
  store(key: string, content: AsyncIterable<Uint8Array>): Promise<void>;
  load(key: string, options?: { offset?: number; length?: number }): AsyncIterable<Uint8Array>;
  has(key: string): Promise<boolean>;
  delete(key: string): Promise<boolean>;
  keys(): AsyncIterable<string>;
  size(key: string): Promise<number>;
}
```

Backends handle compression internally. Git-compatible stores use zlib deflate; others may use different compression or none at all.

### BinStore - Combined Storage

Combines raw storage with optional delta compression:

```typescript
interface BinStore {
  raw: RawStore;
  delta: DeltaStore;
  flush(): Promise<void>;
  close(): Promise<void>;
  refresh(): Promise<void>;
}
```

### GitObjectStore - Type-Aware Layer

Adds Git object semantics (type headers, content hashing):

```typescript
interface GitObjectStore {
  store(type: ObjectTypeString, content: AsyncIterable<Uint8Array>): Promise<ObjectId>;
  loadRaw(id: ObjectId): AsyncIterable<Uint8Array>;  // With header
  load(id: ObjectId): AsyncIterable<Uint8Array>;     // Without header
  loadWithHeader(id: ObjectId): Promise<[GitObjectHeader, AsyncGenerator<Uint8Array>]>;
  getHeader(id: ObjectId): Promise<GitObjectHeader>;
  has(id: ObjectId): Promise<boolean>;
  delete(id: ObjectId): Promise<boolean>;
  list(): AsyncIterable<ObjectId>;                   // All object IDs
}
```

The distinction between `loadRaw()` and `load()` matters for different use cases. Transport protocols need `loadRaw()` to get the complete Git object with header for pack file generation. Application code uses `load()` to get just the content, or works through typed stores that handle parsing.

### Semantic Stores

Built on GitObjectStore, these provide domain-specific operations:

| Store | Key Operations |
|-------|----------------|
| `BlobStore` | `store(content)`, `load(id)` |
| `TreeStore` | `storeTree(entries)`, `loadTree(id)`, `getEntry(treeId, name)` |
| `CommitStore` | `storeCommit()`, `loadCommit()`, `walkAncestry()`, `findMergeBase()` |
| `TagStore` | `storeTag()`, `loadTag()`, `getTarget(id, peel?)` |

### Why `objects` is Exposed in the Public API

The `Repository` and `GitStores` interfaces expose `objects: GitObjectStore` alongside the typed stores. This design choice enables several important use cases:

**Transport and Protocol Operations**

Git's HTTP and SSH protocols transfer objects in pack files, which contain raw objects with their Git headers. The transport layer needs direct access to `objects` for building pack files during push and receiving objects during fetch. The `@statewalker/vcs-transport` package's `createVcsRepositoryAdapter()` requires `objects` to implement protocol handlers:

```typescript
// From transport package - needs objects for protocol handling
const repositoryAccess = createVcsRepositoryAdapter({
  objects: store.objects,  // Required for loadObject, storeObject, hasObject
  refs: store.refs,
  commits: store.commits,
  trees: store.trees,
  tags: store.tags,
});
```

**Object Introspection**

Sometimes you need to query an object's type and size without parsing its content. The `getHeader()` method provides this efficiently:

```typescript
const header = await repository.objects.getHeader(unknownId);
console.log(`Type: ${header.type}, Size: ${header.size} bytes`);
```

**Raw Object Streaming**

The `loadRaw()` method streams objects with their Git headers intact, essential for network transfer and pack file generation:

```typescript
// Collect raw object for push operation
for await (const chunk of repository.objects.loadRaw(id)) {
  chunks.push(chunk);
}
const rawData = concatBytes(chunks);
const header = parseHeader(rawData);
const content = extractGitObjectContent(rawData);
```

**Unified Object Iteration**

The `list()` method returns all object IDs regardless of type, useful for garbage collection, repository analysis, and migration tools:

```typescript
for await (const id of repository.objects.list()) {
  const header = await repository.objects.getHeader(id);
  console.log(`${id}: ${header.type}`);
}
```

**Internal Composition**

The typed stores are thin wrappers that delegate to `GitObjectStore`. For example, `BlobStore.store()` simply calls `objects.store("blob", content)`. Exposing `objects` allows advanced users to bypass the typed layer when needed while keeping the common case simple.

## Directory Structure Deep Dive

### binary/

Low-level byte storage abstractions.

| File | Purpose |
|------|---------|
| `raw-store.ts` | `RawStore` interface for key-value byte storage |
| `raw-store.files.ts` | File-based RawStore implementation |
| `raw-store.memory.ts` | In-memory RawStore implementation |
| `raw-store.compressed.ts` | Zlib-compressed RawStore wrapper |
| `volatile-store.ts` | `VolatileStore` interface for transient data |
| `volatile-store.files.ts` | File-based VolatileStore implementation |
| `volatile-store.memory.ts` | In-memory VolatileStore implementation |

The `RawStore` interface is implemented by each storage backend. All higher layers build on this abstraction.

### blob/

Simplest object type - raw file contents.

| File | Purpose |
|------|---------|
| `blob-store.ts` | `BlobStore` interface |
| `blob-store.impl.ts` | Implementation delegating to `GitObjectStore` |

Blobs have no internal structure to parse. They're stored as-is with a Git header.

### commits/

Commit objects with ancestry traversal.

| File | Purpose |
|------|---------|
| `commit-store.ts` | `CommitStore` interface with traversal operations |
| `commit-store.impl.ts` | Implementation with graph algorithms |
| `commit-format.ts` | Serialization/deserialization |

Key algorithms:
- **walkAncestry**: Breadth-first traversal through parent links
- **findMergeBase**: Common ancestor detection for three-way merges
- **isAncestor**: Reachability test between commits

### commands/

High-level VCS operations exposed as interfaces.

| File | Purpose |
|------|---------|
| `add.command.ts` | `Add` interface for staging files |
| `add.command.impl.ts` | Implementation |
| `checkout.command.ts` | `Checkout` interface for materializing trees |
| `checkout.command.impl.ts` | Implementation with conflict detection |

Commands encapsulate multi-step workflows:
- `Add`: Hash files, update staging entries, handle ignore patterns
- `Checkout`: Compare trees, detect conflicts, update worktree

### delta/

Sophisticated delta compression system.

| File | Purpose |
|------|---------|
| `delta-store.ts` | `DeltaStore` interface |
| `delta-binary-format.ts` | Delta instruction encoding |
| `gc-controller.ts` | Garbage collection coordination |
| `packing-orchestrator.ts` | Batch delta computation |
| `raw-store-with-delta.ts` | Raw store with delta resolution |
| `storage-analyzer.ts` | Analyze storage for optimization |
| `types.ts` | Delta-related type definitions |
| `strategies/` | Delta candidate selection strategies |

Delta compression stores objects as differences from similar objects. The system manages:
- **Delta chains**: A → B → C where C is delta of B, B is delta of A
- **Chain depth limits**: Prevent excessively long chains
- **Candidate selection**: Find good base objects for deltaification

### files/

File mode constants and filesystem abstractions.

| File | Purpose |
|------|---------|
| `file-mode.ts` | `FileMode` constants matching Git |

```typescript
FileMode.TREE           // 0o040000
FileMode.REGULAR_FILE   // 0o100644
FileMode.EXECUTABLE_FILE // 0o100755
FileMode.SYMLINK        // 0o120000
FileMode.GITLINK        // 0o160000
```

### format/

Streaming serialization utilities.

| File | Purpose |
|------|---------|
| `person-ident.ts` | Author/committer identity formatting |
| `types.ts` | `CommitEntry`, `TagEntry` for streaming parse |

The streaming design uses discriminated unions:

```typescript
type CommitEntry =
  | { type: "tree"; value: string }
  | { type: "parent"; value: string }
  | { type: "author"; value: PersonIdent }
  | { type: "committer"; value: PersonIdent }
  | { type: "message"; value: string };
```

This allows incremental parsing without buffering entire objects.

### id/

Object identification.

| File | Purpose |
|------|---------|
| `object-id.ts` | `ObjectId` type, format constants |

```typescript
type ObjectId = string; // 40-char hex for SHA-1

const GitFormat = {
  OBJECT_ID_LENGTH: 20,        // Bytes
  OBJECT_ID_STRING_LENGTH: 40, // Hex characters
};
```

### ignore/

Gitignore pattern matching.

| File | Purpose |
|------|---------|
| `ignore-manager.ts` | `IgnoreManager` interface |
| `ignore-manager.impl.ts` | Implementation |
| `ignore-node.ts` | Trie node for efficient matching |
| `ignore-rule.ts` | Individual pattern parsing |

The implementation uses a trie structure for efficient path matching against potentially many ignore patterns.

### objects/

Unified Git object storage.

| File | Purpose |
|------|---------|
| `object-store.ts` | `GitObjectStore` interface |
| `object-store.impl.ts` | Implementation |
| `object-header.ts` | Header encoding/decoding |
| `object-types.ts` | Type codes and strings |
| `load-with-header.ts` | Combined header+content loading |

Header format: `"<type> <size>\0"`

```typescript
encodeObjectHeader("blob", 1234) // Uint8Array of "blob 1234\0"
parseHeader(data) // { type: "blob", size: 1234, contentOffset: 10 }
```

### pack/

Pack file format support.

| File | Purpose |
|------|---------|
| `pack-consolidator.ts` | Merge multiple packs |
| `pack-delta-store.ts` | Pack-file based delta storage |
| `pack-directory.ts` | Pack directory management |
| `pack-entries-parser.ts` | Parse pack entries |
| `pack-indexer.ts` | Build .idx files |
| `pack-index-reader.ts` | Read .idx files |
| `pack-index-writer.ts` | Write .idx files |
| `pack-reader.ts` | Read .pack files |
| `pack-writer.ts` | Write .pack files |
| `pending-pack.ts` | In-progress pack tracking |
| `delta-reverse-index.ts` | Reverse index for delta lookups |
| `types.ts` | Pack-related types |

Pack files bundle multiple objects efficiently for storage and transfer. The .idx file provides random access by object ID.

### person/

Author/committer identity.

| File | Purpose |
|------|---------|
| `person-ident.ts` | `PersonIdent` interface |

```typescript
interface PersonIdent {
  name: string;
  email: string;
  timestamp: number;  // Unix seconds
  tzOffset: string;   // "+0000" format
}
```

Git format: `"Name <email> 1234567890 +0100"`

### refs/

Reference management (branches, tags, HEAD).

| File | Purpose |
|------|---------|
| `ref-store.ts` | `RefStore` interface |
| `ref-store.files.ts` | File-based RefStore implementation |
| `ref-store.memory.ts` | In-memory RefStore implementation |
| `ref-types.ts` | `Ref`, `SymbolicRef`, `RefStorage` |
| `ref-reader.ts` | Read loose refs |
| `ref-writer.ts` | Write loose refs |
| `ref-directory.ts` | Refs directory structure |
| `packed-refs-reader.ts` | Read packed-refs |
| `packed-refs-writer.ts` | Write packed-refs |

Reference types:

```typescript
interface Ref {
  name: string;           // "refs/heads/main"
  objectId: ObjectId;
  storage: RefStorage;    // LOOSE, PACKED, or LOOSE_PACKED
}

interface SymbolicRef {
  name: string;           // "HEAD"
  target: string;         // "refs/heads/main"
  storage: RefStorage;
}
```

The `compareAndSwap` operation enables atomic updates:

```typescript
refs.compareAndSwap("refs/heads/main", expectedOldId, newId)
```

### staging/

Index/staging area with merge conflict support.

| File | Purpose |
|------|---------|
| `staging-store.ts` | `StagingStore` interface |
| `staging-edits.ts` | `StagingEdit` for modifications |
| `staging-store.files.ts` | File-based implementation |
| `staging-store.memory.ts` | In-memory implementation |
| `index-format.ts` | Git index format parsing |
| `conflict-utils.ts` | Merge conflict handling |

Modification patterns:

```typescript
// Builder: bulk modifications, replaces entire index
const builder = staging.builder();
await builder.addTree(trees, treeId, "");
await builder.finish();

// Editor: targeted modifications, preserves unaffected entries
const editor = staging.editor();
editor.add({ path: "file.txt", apply: (existing) => newEntry });
await editor.finish();
```

Merge stages:

```typescript
const MergeStage = {
  MERGED: 0,   // Normal, no conflict
  BASE: 1,     // Common ancestor version
  OURS: 2,     // Current branch version
  THEIRS: 3,  // Incoming branch version
};
```

### status/

Repository status calculation.

| File | Purpose |
|------|---------|
| `status-calculator.ts` | `StatusCalculator` interface |
| `status-calculator.impl.ts` | Implementation |

Three-way comparison:

```
HEAD (last commit)
  ↓ compare
Index (staging area)
  ↓ compare
Working Tree (filesystem)
```

Each file gets two statuses: `indexStatus` (vs HEAD) and `workTreeStatus` (vs index).

### tags/

Annotated tag objects.

| File | Purpose |
|------|---------|
| `tag-store.ts` | `TagStore` interface |
| `tag-store.impl.ts` | Implementation |
| `tag-format.ts` | Serialization |

Annotated tags can point to any object type and optionally chain (tag pointing to tag). The `getTarget(id, peel)` method resolves chains to the final target.

### trees/

Directory snapshot objects.

| File | Purpose |
|------|---------|
| `tree-store.ts` | `TreeStore` interface |
| `tree-store.impl.ts` | Implementation |
| `tree-entry.ts` | `TreeEntry` type |
| `tree-format.ts` | Binary format |

Tree entries are sorted canonically (directories sort as if they had trailing `/`). This canonical ordering ensures identical trees always produce identical IDs.

### worktree/

Working tree filesystem traversal.

| File | Purpose |
|------|---------|
| `working-tree-iterator.ts` | `WorkingTreeIterator` interface |
| `working-tree-iterator.impl.ts` | Implementation |

Provides platform-agnostic filesystem iteration with:
- Ignore pattern matching
- File mode detection
- Content hashing (Git blob format)

### utils/

Internal utilities.

| File | Purpose |
|------|---------|
| `file-utils.ts` | File path utilities |
| `varint.ts` | Variable-length integer encoding |

Varint encoding is used in pack files and delta instructions.

### repository.ts

Main entry point combining all stores.

```typescript
interface Repository {
  objects: GitObjectStore;
  commits: CommitStore;
  trees: TreeStore;
  blobs: BlobStore;
  tags: TagStore;
  refs: RefStore;
  config: RepositoryConfig;

  initialize(): Promise<void>;
  close(): Promise<void>;
  isInitialized(): Promise<boolean>;
}
```

The `GitStores` type provides just object stores without refs/config for transport operations.

### stores/

Repository factory functions.

| File | Purpose |
|------|---------|
| `create-repository.ts` | Factory for creating Git-compatible repositories |

The `createGitRepository()` function creates a fully configured repository with all stores:

```typescript
import { createGitRepository } from "@statewalker/vcs-core";

// In-memory repository (default)
const memRepo = await createGitRepository();

// File-based repository
import { FilesApi, NodeFilesApi } from "@statewalker/webrun-files";
const files = new FilesApi(new NodeFilesApi({ fs, rootDir: "/path/to/project" }));
const fileRepo = await createGitRepository(files, ".git");
```

## Key Algorithms

### Commit Ancestry Traversal

The `walkAncestry` method performs breadth-first traversal:

```
       C1 (start)
      /  \
    C2    C3
    |     |
    C4    C5
     \   /
      C6
```

With `firstParentOnly: true`, follows only first parent for linear history.

### Merge Base Detection

Finding common ancestors for three-way merge:

1. Mark ancestors of commit A
2. Find first marked ancestor reachable from B
3. Handle octopus merges by finding all merge bases

### Delta Chain Resolution

When loading a deltified object:

1. Find base object(s) in chain
2. Load base content
3. Apply delta instructions sequentially
4. Cache intermediate results for efficiency

## Extension Points

### Implementing Custom Storage Backends

Create implementations of the core interfaces:

```typescript
class MyRawStore implements RawStore {
  async store(key: string, content: AsyncIterable<Uint8Array>): Promise<void> {
    // Your storage logic
  }
  // ... other methods
}
```

Then compose higher-level stores using the provided implementations:

```typescript
const rawStore = new MyRawStore();
const objectStore = new GitObjectStoreImpl(rawStore);
const commitStore = new CommitStoreImpl(objectStore);
```

### Custom Delta Strategies

Implement `DeltaCandidateStrategy` for domain-specific delta selection:

```typescript
interface DeltaCandidateStrategy {
  findCandidates(
    targetId: ObjectId,
    storage: StorageAnalyzer
  ): AsyncIterable<ObjectId>;
}
```

Built-in strategies:
- `CommitWindowCandidateStrategy`: Sliding window through recent commits
- `SimilarSizeCandidateStrategy`: Objects of similar size

### Custom Ignore Rules

The `IgnoreManager` interface allows custom ignore logic beyond `.gitignore`:

```typescript
interface IgnoreManager {
  isIgnored(path: string): boolean;
  addPattern(pattern: string): void;
}
```

## Performance Considerations

### Streaming Everything

Never buffer entire objects in memory. Use generators:

```typescript
async function* processContent(
  input: AsyncIterable<Uint8Array>
): AsyncIterable<Uint8Array> {
  for await (const chunk of input) {
    yield transform(chunk);
  }
}
```

### Lazy Loading

Load objects only when needed. The `has()` method checks existence without loading content.

### Delta Chain Limits

Configure `maxChainDepth` to balance compression ratio against reconstruction cost. Deep chains save space but slow random access.

### Packed Refs

Call `refs.optimize?.()` periodically to pack loose refs. Many loose ref files slow directory operations.

## Testing Patterns

### In-Memory Backend

Use `createGitRepository()` without arguments for in-memory tests:

```typescript
import { createGitRepository } from "@statewalker/vcs-core";

// Creates an in-memory repository (uses MemFilesApi by default)
const repo = await createGitRepository();
// Tests run fast with no filesystem I/O
```

### Interface-Based Mocking

Since everything is interface-based, create focused mocks:

```typescript
const mockCommitStore: CommitStore = {
  storeCommit: vi.fn().mockResolvedValue("abc123"),
  loadCommit: vi.fn().mockResolvedValue(testCommit),
  // ...
};
```

### Parametrized Tests

The `@statewalker/vcs-testing` package provides test suites that verify any backend:

```typescript
import { describe } from "vitest";
import { objectStorageSuite, commitStoreSuite, refStoreSuite } from "@statewalker/vcs-testing";

describe("MyCustomStorage", () => {
  objectStorageSuite({
    createStore: () => new MyCustomObjectStore(),
    cleanup: async (store) => await store.close(),
  });

  commitStoreSuite({
    createStore: () => new MyCustomCommitStore(),
  });
});
```
