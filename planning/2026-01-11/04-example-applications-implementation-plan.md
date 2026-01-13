# Example Applications Implementation Plan

**Date:** 2026-01-11
**Based on:** [03-example-applications-series-plan.md](./03-example-applications-series-plan.md)

## Executive Summary

This plan details the implementation strategy for the example applications series. Key approach:
1. **Refactor existing examples** when possible (reduces effort, maintains continuity)
2. **Leverage tested features** from unit tests as code references
3. **Progressive implementation** following phase priorities from the series plan

---

## Inventory: Existing Examples → Target Mapping

### Source Examples Analysis

| Existing Example | Key Features | Target Mapping |
|-----------------|--------------|----------------|
| `example-git-cycle` | Low-level blob/tree/commit, history traversal | `examples/01-quick-start`, `examples/03-object-model` |
| `example-readme-scripts/basic-repository-operations.ts` | Minimal repository init, blob, tree, commit | `examples/01-quick-start` |
| `example-readme-scripts/commands-api.ts` | Git facade, commit, branch, checkout, tag, status | `examples/02-porcelain-commands` |
| `example-git-lifecycle` | GC, pack files, native git verification | `examples/06-internal-storage` |
| `examples-git/06-high-level-api` | Repository API, typed stores | `examples/03-object-model` |
| `example-git-push` | Branch, commit, push with transport | `examples/08-transport-basics` |
| `example-vcs-http-roundtrip` | HTTP server, clone, push (VCS-only) | `demos/http-server-scratch` |
| `example-pack-gc` | Pack file operations, garbage collection | `benchmarks/pack-operations` |

### Refactoring Strategy

**REFACTOR** (existing code moves to new location with modifications):
- `example-readme-scripts/basic-repository-operations.ts` → `examples/01-quick-start/`
- `example-readme-scripts/commands-api.ts` → `examples/02-porcelain-commands/`
- `example-vcs-http-roundtrip` → `demos/http-server-scratch/`

**EXTRACT & EXTEND** (extract portions, create new structure):
- `example-git-cycle/steps/01-04` → `examples/03-object-model/`
- `example-git-cycle/steps/06-08` → `examples/04-branching-merging/`, `examples/05-history-operations/`
- `example-git-lifecycle` → `examples/06-internal-storage/`
- `example-git-push` → `examples/08-transport-basics/`

**NEW IMPLEMENTATIONS** (limited existing code):
- `demos/browser-vcs-app/` - New UI application
- `demos/versioned-documents/` - New demo concept
- `demos/webrtc-p2p-sync/` - New transport layer
- `demos/offline-first-pwa/` - New PWA structure
- `benchmarks/delta-compression/` - New benchmarks
- `benchmarks/real-repo-perf/` - New benchmarks

---

## Unit Test Coverage Analysis

The following features have comprehensive unit test coverage and can be demonstrated with confidence:

### Commands Package (`packages/commands/tests/`)

| Feature | Test File | Coverage Quality |
|---------|-----------|------------------|
| Add (staging) | `add-command.test.ts` | Full |
| Branch operations | `branch-command.test.ts` | Full |
| Checkout | `checkout-command.test.ts` | Full (staging-only) |
| Cherry-pick | `cherry-pick-command.test.ts` | Full |
| Clone | `clone-command.test.ts` | Full |
| Commit | `commit-command.test.ts` | Full |
| Diff | `diff-command.test.ts`, `diff-formatter.test.ts` | Full |
| Fetch | `fetch-command.test.ts` | Full |
| Log | `log-command.test.ts` | Full |
| Merge | `merge-command.test.ts` | Full (strategies, conflicts) |
| Pull | `pull-command.test.ts` | Full |
| Push | `push-command.test.ts` | Full |
| Rebase | `rebase-command.test.ts` | Full |
| Reset | `reset-command.test.ts` | Full |
| Revert | `revert-command.test.ts` | Full |
| Stash | `stash-*.test.ts` | Full |
| Status | `status-command.test.ts` | Full |
| Tag | `tag-command.test.ts` | Full |
| Blame | `blame-command.test.ts` | Full |

### Transport Package (`packages/transport/tests/`)

| Feature | Test File | Coverage Quality |
|---------|-----------|------------------|
| HTTP Server | `git-http-server.test.ts` | Full |
| Protocol V2 | `protocol-v2-handler.test.ts` | Full |
| Pack upload/receive | `upload-pack-handler.test.ts`, `receive-pack-handler.test.ts` | Full |
| Refspec | `refspec.test.ts` | Full |
| VCS adapter | `vcs-repository-adapter.test.ts` | Full |

### Core Package (`packages/core/tests/`)

| Feature | Test File | Coverage Quality |
|---------|-----------|------------------|
| Refs | `refs/refs.test.ts` | Full |
| Git interop | `interop/git-interop.test.ts` | Full |
| Ignore rules | `ignore/ignore-rule.test.ts` | Full |
| Staging conflicts | `staging/conflict-utils.test.ts` | Full |

### Utils Package (`packages/utils/tests/`)

| Feature | Test File | Coverage Quality |
|---------|-----------|------------------|
| Delta compression | `diff/delta/*.test.ts` | Extensive (6 test files) |
| Text diff | `diff/text-diff/*.test.ts` | Full (Myers, merge) |
| Patch application | `diff/patch/*.test.ts` | Full |
| SHA-1 hashing | `hash/sha1/*.test.ts` | Full |

---

## Detailed Implementation Plans

### Phase 1: Core Examples (Foundation)

#### 1.1 `examples/01-quick-start/`

**Source:** Refactor from `example-readme-scripts/basic-repository-operations.ts`

**File Structure:**
```
examples/01-quick-start/
├── package.json
├── README.md
├── src/
│   └── main.ts
└── tsconfig.json
```

**Implementation:**
```typescript
// src/main.ts - Simplified from basic-repository-operations.ts
import { createGitRepository, createInMemoryFilesApi, FileMode } from "@statewalker/vcs-core";

// Initialize repository
const files = createInMemoryFilesApi();
const repo = await createGitRepository(files, ".git", { create: true });

// Store content
const encoder = new TextEncoder();
const blobId = await repo.blobs.store([encoder.encode("# My Project\n")]);

// Create tree
const treeId = await repo.trees.storeTree([
  { mode: FileMode.REGULAR_FILE, name: "README.md", id: blobId }
]);

// Create commit
const commitId = await repo.commits.storeCommit({
  tree: treeId,
  parents: [],
  author: { name: "User", email: "user@example.com", timestamp: Date.now() / 1000, tzOffset: "+0000" },
  committer: { name: "User", email: "user@example.com", timestamp: Date.now() / 1000, tzOffset: "+0000" },
  message: "Initial commit"
});

// Update branch
await repo.refs.set("refs/heads/main", commitId);

console.log("Repository created! Commit:", commitId.slice(0, 7));
```

**Changes from source:**
- Simplify to single file (no step structure)
- Remove verbose output formatting
- Focus on minimal working example
- Add clear comments explaining each step

**Estimated effort:** 2 hours (refactoring)

---

#### 1.2 `examples/02-porcelain-commands/`

**Source:** Refactor from `example-readme-scripts/commands-api.ts`

**File Structure:**
```
examples/02-porcelain-commands/
├── package.json
├── README.md
├── src/
│   ├── main.ts              # Run all steps
│   └── steps/
│       ├── 01-init-and-commit.ts
│       ├── 02-branching.ts
│       ├── 03-checkout.ts
│       ├── 04-merge.ts
│       ├── 05-log-diff.ts
│       ├── 06-status.ts
│       ├── 07-tag.ts
│       └── 08-stash.ts
└── tsconfig.json
```

**Key Code References (from tests):**

**Merge with strategies** (`merge-command.test.ts:177-220`):
```typescript
// Three-way merge
const result = await git.merge()
  .include("feature-branch")
  .setStrategy(MergeStrategy.RECURSIVE)
  .call();

if (result.status === MergeStatus.CONFLICTING) {
  // Handle conflicts
  for (const conflict of result.conflicts) {
    console.log(`Conflict in: ${conflict.path}`);
  }
}
```

**Checkout** (`checkout-command.test.ts:56-77`):
```typescript
// Branch checkout
await git.checkout().setName("feature").call();

// Create and checkout in one step
await git.checkout().setCreateBranch(true).setName("new-branch").call();
```

**Log with filters** (`log-command.test.ts`):
```typescript
for await (const commit of await git.log()
  .setMaxCount(10)
  .addPath("src/")
  .call()) {
  console.log(commit.message);
}
```

**Implementation changes from source:**
- Split into step files for progressive learning
- Add merge conflict demonstration
- Include status examples
- Add stash operations (new)

**Estimated effort:** 6 hours

---

#### 1.3 `examples/03-object-model/`

**Source:** Extract from `example-git-cycle/steps/01-04` + `examples-git/06-high-level-api`

**File Structure:**
```
examples/03-object-model/
├── package.json
├── README.md
├── src/
│   ├── main.ts
│   └── steps/
│       ├── 01-blob-storage.ts       # Content addressing
│       ├── 02-tree-structure.ts     # Directory snapshots
│       ├── 03-commit-anatomy.ts     # Commit object details
│       ├── 04-tags.ts               # Lightweight vs annotated
│       └── 05-deduplication.ts      # Content deduplication demo
└── tsconfig.json
```

**Key demonstration (from `example-git-cycle/steps/02-create-files.ts`):**
```typescript
// Deduplication demonstration
const content = encoder.encode("Hello, World!");
const blob1 = await repo.blobs.store([content]);
const blob2 = await repo.blobs.store([content]); // Same content
console.log("Blob IDs match:", blob1 === blob2); // true - deduplication!
```

**Estimated effort:** 4 hours (extraction + documentation)

---

### Phase 2: Browser Demos (Key Differentiators)

#### 2.1 `demos/browser-vcs-app/`

**Source:** NEW implementation (no existing browser demo)

**File Structure:**
```
demos/browser-vcs-app/
├── package.json
├── README.md
├── index.html
├── src/
│   ├── main.ts
│   ├── storage-switcher.ts    # Memory vs Browser FS
│   ├── directory-picker.ts    # File System Access API
│   ├── file-tree.ts           # UI component
│   ├── commit-history.ts      # UI component
│   ├── git-operations.ts      # VCS wrapper
│   └── styles.css
├── vite.config.ts
└── tsconfig.json
```

**Dependencies (from plan):**
```json
{
  "@statewalker/vcs-core": "workspace:*",
  "@statewalker/vcs-commands": "workspace:*",
  "@statewalker/webrun-files": "^0.7.0",
  "@statewalker/webrun-files-mem": "^0.7.0",
  "@statewalker/webrun-files-browser": "^0.7.0"
}
```

**Key Implementation:**
```typescript
// src/storage-switcher.ts
import { createFilesApi as createMemoryFiles } from "@statewalker/webrun-files-mem";
import { createFilesApi as createBrowserFiles } from "@statewalker/webrun-files-browser";

export async function createStorage(type: "memory" | "browser"): Promise<FilesApi> {
  if (type === "memory") {
    return createMemoryFiles();
  }

  // Browser File System Access API
  const dirHandle = await window.showDirectoryPicker();
  return createBrowserFiles(dirHandle);
}

// src/git-operations.ts - Reuse patterns from example-readme-scripts/commands-api.ts
```

**Estimated effort:** 16 hours (new implementation)

---

#### 2.2 `demos/git-workflow-complete/`

**Source:** Polish and extend `example-git-lifecycle`

**File Structure:**
```
demos/git-workflow-complete/
├── package.json
├── README.md
├── src/
│   ├── main.ts
│   └── steps/
│       ├── 01-init-repo.ts         # From example-git-lifecycle
│       ├── 02-create-files.ts      # From example-git-lifecycle
│       ├── 03-generate-commits.ts  # From example-git-lifecycle
│       ├── 04-branching.ts         # NEW - branch operations
│       ├── 05-merging.ts           # NEW - merge demonstration
│       ├── 06-diff-viewer.ts       # NEW - diff output
│       ├── 07-gc-packing.ts        # From example-git-lifecycle
│       ├── 08-checkout.ts          # From example-git-lifecycle
│       └── 09-verification.ts      # From example-git-lifecycle
└── tsconfig.json
```

**Changes from source:**
- Add branching demonstration (step 04)
- Add merge with conflicts (step 05)
- Add diff viewer output (step 06)
- Keep GC and verification steps

**Estimated effort:** 8 hours

---

### Phase 3: Server & Integration

#### 3.1 `demos/http-server-scratch/`

**Source:** Refactor from `example-vcs-http-roundtrip`

**Current structure is close to target.** Changes needed:
- Rename directory
- Update README with clearer documentation
- Add standalone server mode (persistent running)
- Add client-only mode

**File Structure:**
```
demos/http-server-scratch/
├── package.json
├── README.md
├── src/
│   ├── main.ts              # Full roundtrip demo
│   ├── server-only.ts       # NEW: Run server independently
│   ├── client-only.ts       # NEW: Clone/push to existing server
│   └── shared/
│       └── index.ts         # From example-vcs-http-roundtrip
└── tsconfig.json
```

**Key code preserved from `example-vcs-http-roundtrip/src/main.ts`:**
```typescript
// VCS HTTP server setup (lines 200-220)
const server = await createVcsHttpServer({
  port: HTTP_PORT,
  getStorage: async (repoPath: string) => {
    if (repoPath === "remote.git") {
      return remoteStorage;
    }
    return null;
  },
});

// Clone using VCS transport (lines 225-307)
const cloneResult = await clone({
  url: REMOTE_URL,
  onProgressMessage: (msg) => console.log(msg.trim()),
});
```

**Estimated effort:** 4 hours (refactoring + new entry points)

---

#### 3.2 `examples/06-internal-storage/`

**Source:** Extract from `example-git-lifecycle` (steps 04-06)

**File Structure:**
```
examples/06-internal-storage/
├── package.json
├── README.md
├── src/
│   ├── main.ts
│   └── steps/
│       ├── 01-loose-objects.ts      # From step-04-verify-loose.ts
│       ├── 02-pack-files.ts         # From step-06-verify-packed.ts
│       ├── 03-garbage-collection.ts # From step-05-run-gc.ts
│       ├── 04-direct-storage.ts     # NEW: bypass index
│       └── 05-delta-internals.ts    # NEW: delta compression
└── tsconfig.json
```

**NEW: Direct storage example** (from test patterns):
```typescript
// Direct object storage bypassing Git index
import { createBinaryStore } from "@statewalker/vcs-core";

const store = await createBinaryStore(files, ".data/objects");

// Store content directly (not as git blob)
const encoder = new TextEncoder();
const id = await store.store([encoder.encode("version 1 content")]);

// Load back
const chunks = [];
for await (const chunk of store.load(id)) {
  chunks.push(chunk);
}
```

**Estimated effort:** 6 hours

---

### Phase 4: Advanced Use Cases

#### 4.1 `demos/versioned-documents/`

**Source:** NEW implementation

**File Structure:**
```
demos/versioned-documents/
├── package.json
├── README.md
├── index.html
├── src/
│   ├── main.ts
│   ├── document-decomposer.ts   # DOCX/ODF unzip
│   ├── version-tracker.ts       # VCS operations
│   ├── history-view.ts          # UI component
│   ├── diff-view.ts             # Compare versions
│   └── styles.css
├── vite.config.ts
└── tsconfig.json
```

**Dependencies:**
```json
{
  "@statewalker/vcs-core": "workspace:*",
  "@statewalker/webrun-files-mem": "^0.7.0",
  "jszip": "^3.10.1"
}
```

**Key Implementation:**
```typescript
// src/document-decomposer.ts
import JSZip from "jszip";

export async function decomposeDocument(file: File): Promise<Map<string, Uint8Array>> {
  const zip = await JSZip.loadAsync(file);
  const components = new Map<string, Uint8Array>();

  for (const [path, zipEntry] of Object.entries(zip.files)) {
    if (!zipEntry.dir) {
      const content = await zipEntry.async("uint8array");
      components.set(path, content);
    }
  }

  return components;
}

// src/version-tracker.ts
export async function saveVersion(
  repo: GitRepository,
  components: Map<string, Uint8Array>,
  message: string
): Promise<string> {
  const entries = [];

  for (const [path, content] of components) {
    const blobId = await repo.blobs.store([content]);
    entries.push({ mode: FileMode.REGULAR_FILE, name: path, id: blobId });
  }

  const treeId = await repo.trees.storeTree(entries);
  // ... create commit
}
```

**Estimated effort:** 12 hours

---

#### 4.2 `demos/offline-first-pwa/`

**Source:** NEW implementation (extends browser-vcs-app)

**File Structure:**
```
demos/offline-first-pwa/
├── package.json
├── README.md
├── index.html
├── src/
│   ├── main.ts
│   ├── service-worker.ts        # NEW: caching
│   ├── sync-manager.ts          # NEW: online sync
│   ├── git-operations.ts        # From browser-vcs-app
│   └── ...
├── manifest.json
├── vite.config.ts
└── tsconfig.json
```

**Estimated effort:** 10 hours (after browser-vcs-app)

---

### Phase 5: P2P and Transport

#### 5.1 `demos/webrtc-p2p-sync/`

**Source:** NEW implementation (requires new `@statewalker/vcs-transport-webrtc`)

**Prerequisites:**
- `@statewalker/vcs-transport-webrtc` package must be created first

**File Structure:**
```
demos/webrtc-p2p-sync/
├── package.json
├── README.md
├── index.html
├── src/
│   ├── main.ts
│   ├── peer-connection.ts       # WebRTC setup
│   ├── qr-signaling.ts          # QR code generation/scanning
│   ├── git-sync.ts              # VCS transport over WebRTC
│   ├── ui-components.ts
│   └── styles.css
├── vite.config.ts
└── tsconfig.json
```

**Dependencies (from plan):**
```json
{
  "@statewalker/vcs-core": "workspace:*",
  "@statewalker/vcs-transport": "workspace:*",
  "@statewalker/vcs-transport-webrtc": "workspace:*",
  "simple-peer": "^9.11.1",
  "pako": "^2.1.0",
  "qrcode": "^1.5.3",
  "jsqr": "^1.4.0"
}
```

**Blocker:** Requires `@statewalker/vcs-transport-webrtc` package implementation

**Estimated effort:** 20 hours (including transport package)

---

#### 5.2 `examples/08-transport-basics/`

**Source:** Extract from `example-git-push`

**File Structure:**
```
examples/08-transport-basics/
├── package.json
├── README.md
├── src/
│   ├── main.ts
│   └── steps/
│       ├── 01-remote-config.ts     # Remote URL setup
│       ├── 02-fetch.ts             # Fetch operation
│       ├── 03-push.ts              # Push operation (from example-git-push)
│       ├── 04-ref-negotiation.ts   # Protocol details
│       └── 05-pack-transfer.ts     # Pack data handling
└── tsconfig.json
```

**Key code from `example-git-push/src/main.ts`:**
```typescript
// Push with VCS transport (lines 307-349)
const result = await push({
  url: REMOTE_URL,
  refspecs: [`refs/heads/${TEST_BRANCH}:refs/heads/${TEST_BRANCH}`],
  force: true,
  getLocalRef: async (refName: string) => {
    const ref = await repository.refs.resolve(refName);
    return ref?.objectId;
  },
  getObjectsToPush: async function* () {
    for (const obj of objectsToPush) {
      yield obj;
    }
  },
  onProgressMessage: (msg) => console.log(msg.trim()),
});
```

**Estimated effort:** 6 hours

---

### Phase 6: Benchmarks

#### 6.1 `benchmarks/delta-compression/`

**Source:** NEW (reference tests in `packages/utils/tests/diff/performance/`)

**File Structure:**
```
benchmarks/delta-compression/
├── package.json
├── README.md
├── src/
│   ├── main.ts
│   ├── benchmark-runner.ts
│   ├── content-generators.ts    # Generate test content
│   ├── metrics-collector.ts     # Timing, memory
│   └── report-generator.ts      # Output results
└── tsconfig.json
```

**Reference test patterns from `binary-delta-performance.test.ts`:**
```typescript
// Benchmark patterns available
import { createDeltaRanges, applyDeltaRanges } from "@statewalker/vcs-utils/diff/delta";

// Measure encoding time
const start = performance.now();
const ranges = createDeltaRanges(sourceBuffer, targetBuffer);
const encodeTime = performance.now() - start;

// Measure decoding time
const decodeStart = performance.now();
const result = applyDeltaRanges(sourceBuffer, ranges);
const decodeTime = performance.now() - decodeStart;
```

**Estimated effort:** 8 hours

---

## Implementation Schedule

### Recommended Order (by dependency and value)

| Order | Example/Demo | Effort | Dependencies | Priority |
|-------|--------------|--------|--------------|----------|
| 1 | `examples/01-quick-start` | 2h | None | P0 - Entry point |
| 2 | `examples/02-porcelain-commands` | 6h | 01-quick-start | P0 - Main API |
| 3 | `examples/03-object-model` | 4h | None | P0 - Foundation |
| 4 | `demos/browser-vcs-app` | 16h | 01, 02 | P1 - Key differentiator |
| 5 | `demos/git-workflow-complete` | 8h | 02 | P1 - Polish |
| 6 | `demos/http-server-scratch` | 4h | None | P2 - Server |
| 7 | `examples/06-internal-storage` | 6h | 03 | P2 - Integrators |
| 8 | `examples/04-branching-merging` | 4h | 02 | P3 - Deep dive |
| 9 | `examples/05-history-operations` | 4h | 02 | P3 - Deep dive |
| 10 | `examples/07-staging-checkout` | 4h | 02 | P3 - Deep dive |
| 11 | `demos/versioned-documents` | 12h | browser-vcs-app | P4 - Novel |
| 12 | `demos/offline-first-pwa` | 10h | browser-vcs-app | P4 - PWA |
| 13 | `examples/08-transport-basics` | 6h | None | P5 - Transport |
| 14 | `demos/webrtc-p2p-sync` | 20h | transport-webrtc pkg | P5 - P2P |
| 15 | `benchmarks/delta-compression` | 8h | None | P6 - Performance |
| 16 | `benchmarks/pack-operations` | 6h | None | P6 - Performance |
| 17 | `benchmarks/real-repo-perf` | 8h | None | P6 - Performance |

**Total estimated effort:** ~128 hours

---

## Directory Structure Transition Plan

### Current Structure → Target Structure

```
apps/
├── example-git-cycle/           → DELETE (content migrated)
├── example-git-lifecycle/       → DELETE (content migrated)
├── example-git-perf/            → benchmarks/real-repo-perf/
├── example-git-push/            → DELETE (content migrated)
├── example-pack-gc/             → benchmarks/pack-operations/
├── example-readme-scripts/      → DELETE (content migrated)
├── example-vcs-http-roundtrip/  → demos/http-server-scratch/
├── examples-git/                → DELETE (06-high-level-api migrated)
├── perf-bench/                  → benchmarks/ (consolidated)
│
├── examples/                    # NEW directory
│   ├── 01-quick-start/
│   ├── 02-porcelain-commands/
│   ├── 03-object-model/
│   ├── 04-branching-merging/
│   ├── 05-history-operations/
│   ├── 06-internal-storage/
│   ├── 07-staging-checkout/
│   └── 08-transport-basics/
│
├── demos/                       # NEW directory
│   ├── browser-vcs-app/
│   ├── git-workflow-complete/
│   ├── http-server-scratch/
│   ├── versioned-documents/
│   ├── webrtc-p2p-sync/
│   └── offline-first-pwa/
│
└── benchmarks/                  # NEW directory
    ├── delta-compression/
    ├── pack-operations/
    └── real-repo-perf/
```

---

## Shared Code Extraction

### `apps/shared/` Utilities

Extract common patterns from existing examples:

```typescript
// apps/shared/src/console-formatting.ts
export function printSection(title: string): void { /* from example-git-cycle */ }
export function printStep(num: number, title: string): void { /* from example-git-push */ }
export function printSuccess(msg: string): void { /* from example-git-push */ }
export function printError(msg: string): void { /* from example-git-push */ }
export function printInfo(msg: string): void { /* from example-git-push */ }
export function shortId(id: string, length = 7): string { /* common pattern */ }

// apps/shared/src/author-helper.ts
export function createAuthor(): PersonIdent { /* from multiple examples */ }

// apps/shared/src/storage-helper.ts
export function createTestStorage(type: "memory" | "node" | "browser"): FilesApi { /* NEW */ }
```

---

## Risk Assessment

### Technical Risks

| Risk | Mitigation |
|------|------------|
| WebRTC transport package doesn't exist | Defer `webrtc-p2p-sync` until package created |
| Browser File System Access API limited support | Graceful fallback to in-memory |
| Large refactoring may break existing examples | Keep old examples until migration complete |

### Effort Risks

| Risk | Mitigation |
|------|------------|
| Browser demos take longer than estimated | Start with minimal UI, iterate |
| New packages required (transport-webrtc) | Track as blocker, prioritize |

---

## Success Criteria

Each example/demo should:

1. **Run without errors** - `pnpm start` works
2. **Be self-contained** - All dependencies declared
3. **Have clear documentation** - README.md with goals, prerequisites, key concepts
4. **Be CI-verified** - Part of build/test pipeline
5. **Follow conventions** - Kebab-case naming, `.js` imports

---

## Next Steps

1. Create `apps/examples/`, `apps/demos/`, `apps/benchmarks/` directories
2. Start with Phase 1 (01-quick-start, 02-porcelain-commands, 03-object-model)
3. Update workspace `pnpm-workspace.yaml` to include new paths
4. Migrate shared utilities to `apps/shared/`
5. Track progress in beads issue tracker
