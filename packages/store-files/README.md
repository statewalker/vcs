# @webrun-vcs/store-files

Git-compatible file storage for reading and writing standard Git repository format.

## Overview

This package implements storage that reads and writes the standard Git repository format. Open an existing `.git` directory, clone from a remote server, or create repositories that standard Git clients can work with seamlessly. The implementation handles loose objects, pack files, references, and the index file format.

Git compatibility is the primary goal. Every object stored by this package produces the same SHA-1 hash that Git would compute. Pack files use the same format Git uses, enabling efficient storage and network transfer. References follow Git's conventions for both loose refs and packed-refs.

The package uses `@statewalker/webrun-files` for file system access, enabling it to work with both Node.js file systems and browser-based virtual file systems. This flexibility lets you work with Git repositories in environments where native file access isn't available.

## Installation

```bash
pnpm add @webrun-vcs/store-files
```

## Public API

### Main Storage Class

```typescript
import { GitStorage } from "@webrun-vcs/store-files";

const storage = new GitStorage(fileSystem, "/path/to/repo/.git");
```

### Key Exports

| Export | Description |
|--------|-------------|
| `GitStorage` | Main Git-compatible storage |
| `GitObjectStorage` | Object storage with loose/pack support |
| `GitPackStorage` | Pack file handling |
| `GitRawObjectsStorage` | Raw object access |
| `GitRefStorage` | Reference management |
| `GitCommitStorage` | Commit parsing and storage |
| `GitFileTreeStorage` | Tree parsing and storage |
| `GitTagStorage` | Tag parsing and storage |
| `CompositeObjectStorage` | Combines loose + pack storage |

### Sub-modules

The package organizes functionality into focused sub-modules:

| Module | Contents |
|--------|----------|
| `./format/` | Git object format utilities |
| `./pack/` | Pack file reading and writing |
| `./refs/` | Reference handling |
| `./staging/` | Index file operations |
| `./backends/` | Delta architecture backends |

## Usage Examples

### Opening an Existing Repository

```typescript
import { GitStorage } from "@webrun-vcs/store-files";
import { NodeFileSystem } from "@statewalker/webrun-files";

const fs = new NodeFileSystem();
const storage = new GitStorage(fs, "/path/to/project/.git");

// Read the current HEAD
const head = await storage.refStore.getRef("HEAD");

// Load a commit
const commit = await storage.commitStore.getCommit(head);
console.log(commit.message);
```

### Creating a New Repository

```typescript
import { GitStorage } from "@webrun-vcs/store-files";

const fs = new NodeFileSystem();
const gitDir = "/new-project/.git";

// Initialize directory structure
await fs.mkdir(gitDir, { recursive: true });
await fs.mkdir(`${gitDir}/objects`, { recursive: true });
await fs.mkdir(`${gitDir}/refs/heads`, { recursive: true });

// Write initial HEAD
await fs.writeFile(`${gitDir}/HEAD`, "ref: refs/heads/main\n");

// Now open with GitStorage
const storage = new GitStorage(fs, gitDir);
```

### Working with Pack Files

Pack files provide efficient storage for many objects:

```typescript
import { GitPackStorage } from "@webrun-vcs/store-files";

const packStorage = new GitPackStorage(fs, `${gitDir}/objects/pack`);

// List available pack files
const packs = await packStorage.listPacks();

// Load object from pack
const content = await packStorage.load(objectHash);
```

### Reading Loose Objects

Loose objects store individual files:

```typescript
import { GitRawObjectsStorage } from "@webrun-vcs/store-files";

const looseStorage = new GitRawObjectsStorage(fs, `${gitDir}/objects`);

// Store a new object
const hash = await looseStorage.store(type, content);

// Load existing object
const data = await looseStorage.load(hash);
```

### Composite Storage

Combine loose and pack storage for complete object access:

```typescript
import { CompositeObjectStorage } from "@webrun-vcs/store-files";

const composite = new CompositeObjectStorage({
  looseStorage,
  packStorage,
});

// Tries pack files first, then loose objects
const object = await composite.load(hash);
```

## Architecture

### Design Decisions

Full Git format compatibility drives all implementation choices. The package doesn't invent custom formats; it implements Git's specifications precisely. This means repositories created here work with `git` CLI, GitHub, and any other Git-compatible tool.

The composite storage pattern reflects how Git itself works: it checks pack files first (more efficient for bulk access), then falls back to loose objects. This ordering optimizes for the common case where most objects live in packs.

### Implementation Details

**Loose Objects** follow the `objects/xx/yyyy...` directory structure, where `xx` is the first two hex characters of the SHA-1 hash. Each object is zlib-compressed with a header indicating type and size.

**Pack Files** use Git's pack format with `.pack` and `.idx` file pairs. The implementation reads pack index v1 and v2 formats, supporting both delta-compressed and full objects within packs.

**References** support both loose refs (individual files under `refs/`) and packed-refs (single file with multiple refs). Symbolic refs like HEAD are handled correctly.

**Index/Staging** implements the Git index file format for staging area operations, including cache tree extensions for performance.

## JGit References

This package maps closely to JGit's file-based storage:

| webrun-vcs | JGit |
|------------|------|
| `GitStorage` | `FileRepository` |
| `GitObjectStorage` | `ObjectDirectory`, `FileObjectDatabase` |
| `GitRawObjectsStorage` | `LooseObjects`, `UnpackedObject` |
| `GitPackStorage` | `Pack`, `PackFile`, `PackIndex`, `PackIndexV1`, `PackIndexV2` |
| `GitRefStorage` | `RefDirectory` |
| Index handling | `DirCache` |
| Pack reading | `PackParser`, `PackInputStream` |
| Delta handling | `BinaryDelta` |

## Dependencies

**Runtime:**
- `@statewalker/webrun-files` - File system abstraction
- `@webrun-vcs/vcs` - Interface definitions
- `@webrun-vcs/utils` - Hashing, compression, delta algorithms

**Development:**
- `@webrun-vcs/testing` - Test suites for validation
- `vitest` - Testing
- `rolldown` - Bundling
- `typescript` - Type definitions

## License

MIT
