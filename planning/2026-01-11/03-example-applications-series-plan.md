# Example Applications Series Plan

**Date:** 2026-01-11
**Based on:** Marketing positioning document, WebRTC sync proposal, sync protocols plan

## Overview

This plan proposes a structured series of example applications organized into three categories:
- **examples/** - Progressive learning tutorials
- **demos/** - Complete workflow demonstrations
- **benchmarks/** - Performance testing and comparisons

The goal is to showcase WebRun VCS capabilities from beginner-friendly introductions to advanced real-world use cases.

---

## Target Topics

### 1. Porcelain Commands API
Full Git workflow using high-level commands: init, add, commit, branch, checkout, merge, log, diff.

### 2. Internal APIs (Low-Level Integration)
Using VCS internals for application-specific versioning with remote synchronization capability.

### 3. HTTP Git Client/Server from Scratch
Building a complete Git HTTP server and client without native git dependencies.

### 4. Binary Communication Channel (WebRTC)
P2P repository synchronization using WebRTC data channels with QR code signaling.

---

## Proposed Application Structure

```
apps/
├── examples/                    # Progressive learning tutorials
│   ├── 01-quick-start/          # First steps with VCS
│   ├── 02-porcelain-commands/   # Full Git workflow with commands API
│   ├── 03-object-model/         # Understanding blobs, trees, commits
│   ├── 04-branching-merging/    # Branch operations and merge strategies
│   ├── 05-history-operations/   # Log, diff, blame, ancestry
│   ├── 06-internal-storage/     # Low-level object and pack operations
│   ├── 07-staging-checkout/     # Index, working tree, checkout
│   └── 08-transport-basics/     # Clone, fetch, push fundamentals
│
├── demos/                       # Complete workflow demonstrations
│   ├── browser-vcs-app/         # Pure browser app with FilesApi backends
│   ├── git-workflow-complete/   # Full Git lifecycle demo
│   ├── http-server-scratch/     # HTTP Git server from scratch
│   ├── versioned-documents/     # Document versioning in browser
│   ├── webrtc-p2p-sync/         # P2P sync with QR codes
│   └── offline-first-pwa/       # PWA with offline Git operations
│
└── benchmarks/                  # Performance testing
    ├── delta-compression/       # Delta algorithm benchmarks
    ├── pack-operations/         # Pack read/write performance
    └── real-repo-perf/          # Real repository benchmarks
```

---

## Detailed Example Plans

### examples/01-quick-start/

**Goal:** Get running in 5 minutes. Create a repository, make commits, view history.

**Topics:**
- Initialize in-memory repository
- Create files (blobs)
- Make commits
- View history

**Key Code:**
```typescript
import { createGitRepository, createInMemoryFilesApi } from "@statewalker/vcs-core";
import { add, commit, log } from "@statewalker/vcs-commands";

// Initialize
const files = createInMemoryFilesApi();
const repo = await createGitRepository(files, "/.git", { create: true });

// Add content
await files.write("/README.md", encode("# My Project"));
await add(repo, "README.md");

// Commit
await commit(repo, { message: "Initial commit" });

// View history
for await (const entry of log(repo)) {
  console.log(`${entry.id.slice(0, 7)} - ${entry.message}`);
}
```

**Output:** Demonstrates the simplest possible workflow.

---

### examples/02-porcelain-commands/

**Goal:** Complete Git workflow using the Commands API (porcelain layer).

**Topics:**
1. Repository initialization with options
2. File staging with patterns
3. Commit with author/committer
4. Branch creation and switching
5. Merge operations
6. Conflict resolution
7. Log with formatting options
8. Diff between commits

**Key Code:**
```typescript
import {
  init, add, commit, branch, checkout, merge, log, diff, status
} from "@statewalker/vcs-commands";

// Initialize with configuration
const repo = await init(files, "/project", {
  defaultBranch: "main",
  author: { name: "Developer", email: "dev@example.com" }
});

// Full workflow
await add(repo, ["src/**/*.ts", "package.json"]);
await commit(repo, { message: "Add source files" });

// Branching
await branch(repo, "feature/login");
await checkout(repo, "feature/login");

// Make changes and commit
await add(repo, "src/auth.ts");
await commit(repo, { message: "Implement login" });

// Merge back
await checkout(repo, "main");
const result = await merge(repo, "feature/login");

if (result.conflicts.length > 0) {
  // Handle conflicts
}

// View history
for await (const entry of log(repo, { format: "oneline" })) {
  console.log(entry);
}
```

**Files:** 8 step files covering each operation.

---

### examples/03-object-model/

**Goal:** Understand Git's internal object model (blobs, trees, commits, tags).

**Topics:**
1. Blob storage and content addressing
2. Tree structure and file modes
3. Commit object anatomy
4. Annotated vs lightweight tags
5. Object deduplication demonstration

**Key Insight:** Show that identical content produces identical hashes, enabling deduplication.

---

### examples/04-branching-merging/

**Goal:** Deep dive into branch operations and merge strategies.

**Topics:**
1. Branch creation and listing
2. HEAD management
3. Fast-forward merge
4. Three-way merge
5. Merge strategies (OURS, THEIRS, UNION)
6. Conflict detection and resolution
7. Rebase concepts

---

### examples/05-history-operations/

**Goal:** Working with repository history.

**Topics:**
1. Log traversal with filters
2. Commit ancestry (isAncestor, commonAncestor)
3. Diff between commits
4. Blame (line-by-line attribution)
5. File history across renames

---

### examples/06-internal-storage/

**Goal:** Low-level storage operations for application integration.

**Topics:**
1. Direct object storage (bypassing index)
2. Pack file structure
3. Delta compression internals
4. Index file format
5. Garbage collection

**Use Case:** Applications that need versioning but not full Git workflow.

**Key Code:**
```typescript
// Direct low-level access
import { createBinaryStore, createPackWriter } from "@statewalker/vcs-core";

const store = await createBinaryStore(files, ".data/objects");

// Store content directly
const id = await store.store([encode("version 1 content")]);

// Create pack files manually
const writer = new PackWriterStream();
await writer.addObject(id, PackObjectType.BLOB, content);
const pack = await writer.finalize();
```

---

### examples/07-staging-checkout/

**Goal:** Working directory and staging area operations.

**Topics:**
1. Index/staging area concepts
2. Staging changes (add)
3. Unstaging changes
4. Working tree status
5. Checkout files from commits
6. Checkout branches
7. Clean/reset operations

---

### examples/08-transport-basics/

**Goal:** Network operations fundamentals.

**Topics:**
1. Remote URL configuration
2. Fetch operation
3. Push operation
4. Ref negotiation
5. Pack transfer

---

## Demo Applications

### demos/browser-vcs-app/

**Goal:** Pure browser-based VCS application using `@statewalker/webrun-files` with swappable storage backends.

**Key Concept:** Demonstrate that the same VCS code works with different storage implementations by using the `FilesApi` abstraction from `@statewalker/webrun-files`.

**Storage Backends:**

| Package | Description | Use Case |
|---------|-------------|----------|
| `@statewalker/webrun-files` | Core FilesApi interface | Base abstraction |
| `@statewalker/webrun-files-browser` | Browser File System Access API | Persistent local files |
| `@statewalker/webrun-files-mem` | In-memory implementation | Testing, temporary storage |

**Architecture:**
```
┌─────────────────────────────────────────────────────────────────┐
│                    Browser VCS Application                       │
├─────────────────────────────────────────────────────────────────┤
│                                                                  │
│  ┌────────────────────────────────────────────────────────────┐ │
│  │                    @statewalker/vcs-core                    │ │
│  │                    @statewalker/vcs-commands                │ │
│  └────────────────────────────────────────────────────────────┘ │
│                              ↓                                   │
│                    FilesApi Interface                            │
│                    (@statewalker/webrun-files)                   │
│                              ↓                                   │
│  ┌──────────────────────┬──────────────────────────────────────┐│
│  │                      │                                       ││
│  │  webrun-files-mem    │     webrun-files-browser              ││
│  │  (In-Memory)         │     (File System Access API)          ││
│  │                      │                                       ││
│  │  - Quick testing     │     - Persistent storage              ││
│  │  - No permission     │     - User picks directory            ││
│  │  - Lost on refresh   │     - Survives refresh                ││
│  │                      │     - Works with local files          ││
│  └──────────────────────┴──────────────────────────────────────┘│
│                                                                  │
└─────────────────────────────────────────────────────────────────┘
```

**Key Features:**
1. **Storage Switcher UI** - Toggle between in-memory and browser filesystem
2. **Directory Picker** - Use File System Access API to pick local folder
3. **Full Git Operations** - init, add, commit, branch, log, diff
4. **Works Offline** - No server required
5. **Portable Code** - Same VCS code works with any FilesApi implementation

**Key Code:**
```typescript
import { createGitRepository } from "@statewalker/vcs-core";
import { add, commit, log, status } from "@statewalker/vcs-commands";

// Storage implementations
import { createFilesApi as createMemoryFiles } from "@statewalker/webrun-files-mem";
import { createFilesApi as createBrowserFiles } from "@statewalker/webrun-files-browser";

// Option 1: In-memory storage (for testing/demos)
const memFiles = createMemoryFiles();

// Option 2: Browser File System Access API (persistent)
const dirHandle = await window.showDirectoryPicker();
const browserFiles = createBrowserFiles(dirHandle);

// Same VCS code works with either storage!
async function initRepo(files: FilesApi) {
  const repo = await createGitRepository(files, "/.git", { create: true });

  // Create a file
  await files.write("/README.md", encode("# My Project\n"));

  // Git operations
  await add(repo, "README.md");
  await commit(repo, { message: "Initial commit" });

  // Show status
  for await (const entry of log(repo)) {
    console.log(`${entry.id.slice(0, 7)} - ${entry.message}`);
  }

  return repo;
}

// User can switch storage at runtime
const files = useMemoryStorage ? memFiles : browserFiles;
const repo = await initRepo(files);
```

**UI Components:**
- Storage selector (Memory / Browser Filesystem)
- Directory picker button (for browser filesystem)
- File tree view
- Commit history panel
- Status indicator
- Commit dialog

**Browser Compatibility:**
- File System Access API: Chrome 86+, Edge 86+, Opera 72+
- Fallback to in-memory for unsupported browsers

**Dependencies:**
```json
{
  "@statewalker/vcs-core": "workspace:*",
  "@statewalker/vcs-commands": "workspace:*",
  "@statewalker/webrun-files": "^0.7.0",
  "@statewalker/webrun-files-mem": "^0.7.0",
  "@statewalker/webrun-files-browser": "^0.7.0"
}
```

---

### demos/git-workflow-complete/

**Goal:** Showcase complete Git workflow in browser environment.

**Storage:** Uses `@statewalker/webrun-files-mem` for in-memory or `@statewalker/webrun-files-browser` for persistent storage.

**Includes:**
- In-browser repository with swappable storage
- Visual commit graph
- File tree browser
- Diff viewer
- Branch visualization
- All porcelain commands

**Target Audience:** Web developers exploring VCS integration.

---

### demos/http-server-scratch/

**Goal:** Build HTTP Git server from scratch, demonstrate full clone/push cycle.

**Architecture:**
```
┌─────────────────────────────────────────────────────────┐
│                    HTTP Git Server                       │
│         (Node.js/Deno/Bun using VCS transport)          │
├─────────────────────────────────────────────────────────┤
│  Endpoints:                                              │
│  GET  /repo.git/info/refs?service=git-upload-pack       │
│  POST /repo.git/git-upload-pack                         │
│  GET  /repo.git/info/refs?service=git-receive-pack      │
│  POST /repo.git/git-receive-pack                        │
└─────────────────────────────────────────────────────────┘
                          ↕
┌─────────────────────────────────────────────────────────┐
│                    VCS Client                            │
│  - Create local repository with VCS                      │
│  - Make commits, branches                                │
│  - Push to server using VCS transport                    │
│  - Clone to separate folder using VCS                    │
│  - Verify with native git (optional)                     │
└─────────────────────────────────────────────────────────┘
```

**Steps:**
1. Create bare repository on server
2. Start HTTP server (using VCS git-http-server)
3. Create local repository with VCS
4. Add files, create commits
5. Push to server
6. Clone to new folder
7. Verify files match

**Key Code:**
```typescript
// Server
import { createGitHttpServer } from "@statewalker/vcs-transport";

const server = createGitHttpServer({
  resolveRepository: async (path) => {
    return await openGitRepository(files, path);
  }
});

await server.listen(8080);

// Client
import { clone, push } from "@statewalker/vcs-transport";

await clone({
  url: "http://localhost:8080/repo.git",
  target: localRepo,
});

await push({
  repository: localRepo,
  url: "http://localhost:8080/repo.git",
  refspecs: ["refs/heads/main:refs/heads/main"],
});
```

---

### demos/versioned-documents/

**Goal:** Document versioning in browser (DOCX/ODF decomposition).

**Based on:** Marketing document use case #1

**Storage:** Uses `@statewalker/webrun-files-mem` for in-memory storage or `@statewalker/webrun-files-browser` for persistent local storage.

**Architecture:**
```
┌─────────────────────────────────────────────────────────┐
│                   Browser Application                    │
├─────────────────────────────────────────────────────────┤
│  ┌───────────────┐    ┌───────────────┐                │
│  │   Document    │───▶│   Decomposer  │                │
│  │   (DOCX)      │    │   (Unzip)     │                │
│  └───────────────┘    └───────┬───────┘                │
│                               │                         │
│                               ▼                         │
│                    ┌─────────────────────┐              │
│                    │   VCS Repository    │              │
│                    │   (FilesApi)        │              │
│                    │                     │              │
│                    │   /document.xml     │              │
│                    │   /styles.xml       │              │
│                    │   /media/image1.png │              │
│                    └─────────────────────┘              │
│                               │                         │
│       ┌───────────────────────┼───────────────────────┐ │
│       ▼                       ▼                       ▼ │
│  webrun-files-mem      webrun-files-browser    (future) │
│  (temporary)           (persistent local)     IndexedDB │
│                                                         │
│                    ┌─────────────────────┐              │
│                    │   History View      │              │
│                    │   Version Compare   │              │
│                    │   Restore Version   │              │
│                    └─────────────────────┘              │
└─────────────────────────────────────────────────────────┘
```

**Features:**
- Upload DOCX/ODF file
- Decompose to XML components
- Store each component as blob
- Track changes per save
- View history
- Restore previous versions
- Reconstruct document from any version
- **Storage options:** In-memory (quick demo) or browser filesystem (persistent)

---

### demos/webrtc-p2p-sync/

**Goal:** P2P repository synchronization using WebRTC with QR code signaling.

**Based on:** WebRTC P2P sync proposal

**Storage:** Uses `@statewalker/webrun-files-mem` for in-memory or `@statewalker/webrun-files-browser` for persistent storage. Both peers can use different storage backends.

**Architecture:**
```
┌─────────────────────────────────────────────────────────┐
│                      Peer A (Initiator)                  │
│  ┌─────────────────┐    ┌───────────────────────────┐   │
│  │  Local Repo     │    │     QR Code Display       │   │
│  │  (IndexedDB)    │    │   ┌─────────────────┐     │   │
│  │                 │    │   │ █▀▀▀▀▀▀▀▀▀▀▀█   │     │   │
│  │  📁 project/    │    │   │ █ ▄▀█▀▄ █▀█ █   │     │   │
│  └─────────────────┘    │   └─────────────────┘     │   │
│                         │   Compressed SDP offer     │   │
│                         └───────────────────────────┘   │
└─────────────────────────────────────────────────────────┘
                    ↕ QR Code / Camera Scan
┌─────────────────────────────────────────────────────────┐
│                      Peer B (Responder)                  │
│  ┌─────────────────┐    ┌───────────────────────────┐   │
│  │  Local Repo     │    │     QR Scanner            │   │
│  │  (empty)        │    │   📷 Camera Feed          │   │
│  └─────────────────┘    └───────────────────────────┘   │
│                                                          │
│  After connection: Bidirectional Git protocol            │
│  - Fetch refs from peer                                  │
│  - Push/pull changes                                     │
│  - Real-time collaboration                               │
└─────────────────────────────────────────────────────────┘
```

**Connection Flow:**
1. Peer A generates RTCPeerConnection offer
2. Compress SDP + ICE candidates (LZMA → ~400 bytes)
3. Display as QR code
4. Peer B scans QR code
5. Peer B creates answer
6. Peer B displays answer QR (or sends via existing channel)
7. Peer A scans/receives answer
8. WebRTC data channel established
9. Git protocol flows over data channel

**Features:**
- No server required for signaling
- End-to-end encrypted (DTLS)
- Bidirectional fetch/push
- Visual progress indicators
- File tree browser

**Dependencies:**
```json
{
  "@statewalker/vcs-core": "workspace:*",
  "@statewalker/vcs-transport": "workspace:*",
  "@statewalker/vcs-transport-webrtc": "workspace:*",
  "@statewalker/webrun-files": "^0.7.0",
  "@statewalker/webrun-files-mem": "^0.7.0",
  "@statewalker/webrun-files-browser": "^0.7.0",
  "simple-peer": "^9.11.1",
  "pako": "^2.1.0",
  "qrcode": "^1.5.3",
  "jsqr": "^1.4.0"
}
```

---

### demos/offline-first-pwa/

**Goal:** Progressive Web App with complete offline Git operations.

**Storage:** Uses `@statewalker/webrun-files-browser` for persistent storage via File System Access API. Falls back to `@statewalker/webrun-files-mem` on unsupported browsers.

**Features:**
- Works entirely offline
- Service worker for caching
- Persistent storage via File System Access API
- Falls back to in-memory on unsupported browsers
- Optional HTTP sync when online
- Install as native app

---

## Benchmarks

### benchmarks/delta-compression/

**Goal:** Measure delta compression algorithm performance.

**Metrics:**
- Compression ratio
- Encoding speed (MB/s)
- Decoding speed (MB/s)
- Memory usage

**Comparison:**
- VCS delta vs native git
- Different content types (text, binary, mixed)

---

### benchmarks/pack-operations/

**Goal:** Pack file read/write performance.

**Metrics:**
- Pack file creation time
- Index generation time
- Object lookup time
- Delta resolution time

---

### benchmarks/real-repo-perf/

**Goal:** Benchmark against real repositories.

**Test Cases:**
- Clone git/git repository
- Traverse 1000 commits
- Checkout different branches
- Compare with native git timing

---

## Implementation Priority

### Phase 1: Core Examples (Foundation)
1. `examples/01-quick-start/` - Entry point for all users
2. `examples/02-porcelain-commands/` - Main API showcase
3. `examples/03-object-model/` - Conceptual foundation

### Phase 2: Browser Demos (Key Differentiators)
4. `demos/browser-vcs-app/` - Pure browser app with FilesApi backends (showcases webrun-files integration)
5. `demos/git-workflow-complete/` - Polish existing example-git-cycle

### Phase 3: Server & Integration
6. `demos/http-server-scratch/` - HTTP Git server from scratch
7. `examples/06-internal-storage/` - For integrators

### Phase 4: Advanced Use Cases
8. `demos/versioned-documents/` - Novel browser use case
9. `demos/offline-first-pwa/` - PWA with offline Git

### Phase 5: P2P and Transport
10. `demos/webrtc-p2p-sync/` - Revolutionary P2P feature
11. `examples/08-transport-basics/` - Transport fundamentals

### Phase 6: Performance
12. `benchmarks/delta-compression/` - Validate performance claims

---

## Required Package Development

### Already Available (External)

The following packages from `@statewalker/webrun-files` ecosystem are already available:

| Package | Description | Status |
|---------|-------------|--------|
| `@statewalker/webrun-files` | Core FilesApi interface | Published v0.7.0 |
| `@statewalker/webrun-files-mem` | In-memory implementation | Published v0.7.0 |
| `@statewalker/webrun-files-browser` | Browser File System Access API | Published v0.7.0 |
| `@statewalker/webrun-files-node` | Node.js implementation | Published v0.7.0 |
| `@statewalker/webrun-files-s3` | S3-compatible storage | Published v0.7.0 |

### New Packages Needed

#### @statewalker/vcs-transport-webrtc
- WebRTC DataChannel stream adapter
- Peer connection manager
- QR code signaling utilities

#### @statewalker/webrun-files-indexeddb (Optional)
- IndexedDB storage backend for browsers without File System Access API
- Alternative to webrun-files-browser for older browsers
- Optimized for VCS access patterns

#### @statewalker/webrun-files-opfs (Optional)
- Origin Private File System backend
- Better performance for large repositories
- Available in modern browsers

---

## Cross-Cutting Concerns

### Shared Utilities
Create `apps/shared/` with common code:
- Console output formatting
- Progress indicators
- Error handling patterns
- Test data generation

### Documentation Standards
Each example should have:
- README.md with goals and prerequisites
- Inline code comments explaining key concepts
- Links to API documentation
- "Learn More" references

### Testing
Each example should:
- Run without errors
- Produce verifiable output
- Work with both in-memory and file storage
- Be CI-verified

---

## Success Metrics

1. **Quick Start:** User creates first commit in < 5 minutes
2. **Porcelain Commands:** Complete workflow demo in < 15 minutes
3. **HTTP Server:** Working clone/push cycle in < 30 minutes
4. **WebRTC Sync:** Two browsers synced in < 10 minutes

---

## Relationship to Marketing Positioning

| Marketing Position | Primary Demo/Example |
|-------------------|---------------------|
| "Git for the Browser" | demos/browser-vcs-app, demos/git-workflow-complete |
| "Version Control as a Service Component" | examples/06-internal-storage |
| "Portable Data Platform" | demos/versioned-documents |
| "Edge-Native Version Control" | demos/http-server-scratch |
| "Conflict-Free Collaboration Engine" | demos/webrtc-p2p-sync |
| "Storage Independence" | demos/browser-vcs-app (shows swappable FilesApi backends) |

---

## Appendix: WebRTC Transport Details

From the WebRTC proposal, the transport implementation:

```typescript
// packages/transport-webrtc/src/webrtc-stream.ts

export function createWebRTCBidirectionalStream(
  dataChannel: RTCDataChannel
): GitBidirectionalStream {
  const receiveBuffer: Uint8Array[] = [];
  let resolveNext: ((data: Uint8Array) => void) | null = null;

  dataChannel.binaryType = "arraybuffer";
  dataChannel.onmessage = (event) => {
    const data = new Uint8Array(event.data);
    if (resolveNext) {
      resolveNext(data);
      resolveNext = null;
    } else {
      receiveBuffer.push(data);
    }
  };

  return {
    input: asyncIterableFromChannel(dataChannel, receiveBuffer),
    output: {
      async write(data: Uint8Array) {
        // Handle backpressure
        while (dataChannel.bufferedAmount > 256 * 1024) {
          await sleep(10);
        }
        dataChannel.send(data);
      },
      async flush() {
        while (dataChannel.bufferedAmount > 0) {
          await sleep(10);
        }
      }
    },
    close: () => dataChannel.close()
  };
}
```

This enables Git protocol to flow over any WebRTC data channel, enabling P2P repository sync.
