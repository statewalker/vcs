# 08-transport-basics

This example demonstrates Git HTTP smart protocol transport operations -- listing remote refs, verifying repository access, cloning, and fetching incremental updates from a remote server like GitHub.

## Quick Start

```bash
# From the monorepo root
pnpm install
pnpm --filter @statewalker/vcs-example-08-transport-basics start
```

## What You'll Learn

- List remote refs without downloading objects (`lsRemote`)
- Verify whether a remote repository is accessible (`checkRemote`)
- Retrieve the full ref advertisement including capabilities and symbolic refs (`fetchRefs`)
- Clone a complete repository with progress reporting (`clone`)
- Fetch incremental updates using refspecs (`fetch`)

## Prerequisites

- Node.js 18+
- pnpm
- Network access (the example connects to GitHub)
- Completed [01-quick-start](../01-quick-start/) for foundational concepts

---

## Step-by-Step Guide

**File:** [src/main.ts](src/main.ts)

### Listing Remote Refs

The `lsRemote` function connects to a remote and retrieves all refs without downloading any objects. This is useful for checking which branches and tags exist before deciding what to fetch.

```typescript
import { lsRemote } from "@statewalker/vcs-transport";

const REPO_URL = "https://github.com/octocat/Hello-World.git";

const refs = await lsRemote(REPO_URL);

console.log(`Found ${refs.size} refs:`);
for (const [name, id] of refs) {
  console.log(`  ${name} ${id.slice(0, 8)}`);
}
```

The returned `Map<string, string>` maps ref names (like `refs/heads/master`) to their object ID hex strings.

**Key APIs:**
- `lsRemote(url, options?)` - Returns a map of ref names to object IDs
- `LsRemoteOptions` - Authentication, headers, and timeout settings

---

### Checking Remote Accessibility

Before performing expensive operations, `checkRemote` verifies whether a repository exists and is reachable. It also reports whether the repository is empty and what the default branch is.

```typescript
import { checkRemote } from "@statewalker/vcs-transport";

const publicResult = await checkRemote(REPO_URL);
console.log(`Exists: ${publicResult.exists}`);
console.log(`Empty: ${publicResult.isEmpty}`);
console.log(`Default branch: ${publicResult.defaultBranch || "unknown"}`);

const notFoundResult = await checkRemote(
  "https://github.com/nonexistent-user-12345/nonexistent-repo.git",
);
console.log(`Exists: ${notFoundResult.exists}`);
console.log(`Error: ${notFoundResult.error || "none"}`);
```

**Key APIs:**
- `checkRemote(url)` - Returns existence, emptiness, and default branch info

---

### Fetching the Full Ref Advertisement

Where `lsRemote` returns only ref names and IDs, `fetchRefs` gives you the complete ref advertisement -- including server capabilities, agent string, and symbolic ref mappings (like `HEAD -> refs/heads/master`).

```typescript
import { fetchRefs } from "@statewalker/vcs-transport";
import { bytesToHex } from "@statewalker/vcs-utils/hash/utils";

const advertisement = await fetchRefs(REPO_URL);

console.log(`Capabilities: ${[...advertisement.capabilities].join(", ")}`);
console.log(`Agent: ${advertisement.agent || "unknown"}`);

for (const [name, target] of advertisement.symrefs) {
  console.log(`  ${name} -> ${target}`);
}

for (const [name, id] of advertisement.refs) {
  console.log(`  ${name.padEnd(40)} ${bytesToHex(id).slice(0, 8)}`);
}
```

**Key APIs:**
- `fetchRefs(url)` - Returns capabilities, symbolic refs, agent, and full ref map

---

### Cloning a Repository

Clone fetches all objects and refs from a remote repository. The `onProgress` callback reports counting and compression stages, while `onProgressMessage` passes through raw server messages.

```typescript
import { clone } from "@statewalker/vcs-transport";

const result = await clone({
  url: REPO_URL,
  onProgress: (info) => {
    const percent = info.total
      ? Math.round((info.current / info.total) * 100)
      : undefined;
    const percentStr = percent !== undefined ? ` (${percent}%)` : "";
    console.log(
      `  ${info.stage}: ${info.current}${info.total ? `/${info.total}` : ""}${percentStr}`,
    );
  },
  onProgressMessage: (message) => {
    const trimmed = message.trim();
    if (trimmed) console.log(`  Server: ${trimmed}`);
  },
});

console.log(`Default branch: ${result.defaultBranch}`);
console.log(`Refs fetched: ${result.refs.size}`);
console.log(`Pack size: ${formatBytes(result.packData.length)}`);
console.log(`Bytes received: ${formatBytes(result.bytesReceived)}`);
```

The result contains the raw pack data, all fetched refs, the default branch name, and transfer statistics. You can then feed the pack data into a pack parser to import objects into a local store.

**Key APIs:**
- `clone(options)` - Full repository download with progress reporting
- `CloneOptions` - URL, branch, depth, progress callbacks
- `CloneResult` - Pack data, refs, default branch, byte counts

---

### Fetching Incremental Updates

Once you have an initial clone, `fetch` downloads only new objects. Refspecs control which remote refs map to which local refs. The `localHas` callback lets the server know which objects to skip.

```typescript
import { fetch } from "@statewalker/vcs-transport";

const result = await fetch({
  url: REPO_URL,
  refspecs: [
    "+refs/heads/*:refs/remotes/origin/*",
    "+refs/tags/*:refs/tags/*",
  ],
  onProgress: (info) => {
    const percent = info.total
      ? Math.round((info.current / info.total) * 100)
      : undefined;
    const percentStr = percent !== undefined ? ` (${percent}%)` : "";
    console.log(
      `  ${info.stage}: ${info.current}${info.total ? `/${info.total}` : ""}${percentStr}`,
    );
  },
});

console.log(`Default branch: ${result.defaultBranch || "unknown"}`);
console.log(`Refs updated: ${result.refs.size}`);
console.log(`Pack size: ${formatBytes(result.packData.length)}`);
```

**Key APIs:**
- `fetch(options)` - Incremental update with negotiation
- `FetchOptions` - Refspecs, `localHas`, `localCommits` for negotiation
- `RawFetchResult` - Pack data, refs, default branch, transfer stats

---

## Key Concepts

### Git HTTP Smart Protocol

The transport layer implements the Git HTTP smart protocol for communicating with remote Git servers like GitHub, GitLab, and self-hosted instances. Two services are available: **upload-pack** for fetch and clone operations (downloading from remote), and **receive-pack** for push operations (uploading to remote). The protocol uses pkt-line framing -- each line is prefixed with a 4-character hex length -- and a special flush packet (`0000`) to mark boundaries.

### Ref Advertisement

When connecting to a remote, the server sends a "ref advertisement" containing all refs (branches, tags) and their commit IDs, the server's capabilities (features it supports), and symbolic refs (like HEAD pointing to the default branch). This advertisement is the starting point for every transport operation -- `lsRemote` parses the refs, `fetchRefs` extracts the full advertisement, and `clone`/`fetch` use it to negotiate which objects need transferring.

### Pack Files

Git transfers objects in pack format, a highly compressed binary format that groups related objects together, uses delta compression to reduce size, and includes a SHA-1 checksum for integrity. When cloning or fetching, the server sends a single pack file containing all requested objects. The `packData` field in clone and fetch results contains this raw pack data for import into your local object store.

### Refspecs

Refspecs define how remote refs map to local refs. The format is `[+]<src>:<dst>` where `+` means force update (allow non-fast-forward). Common patterns include `+refs/heads/*:refs/remotes/origin/*` to track remote branches under a remote prefix, `+refs/tags/*:refs/tags/*` to mirror tags locally, and `refs/heads/main:refs/heads/main` for single-branch mapping.

---

## Project Structure

```
apps/examples/08-transport-basics/
├── package.json
├── tsconfig.json
├── README.md
└── src/
    └── main.ts           # All transport operations in one file
```

---

## Output Example

```
=== ls-remote: List Remote Refs ===

Repository: https://github.com/octocat/Hello-World.git
Found 4 refs:

Branches:
  master                         7fd1a60b

Tags:
  v1.0                          ef4acfb3

Other:
  HEAD                          7fd1a60b

=== clone: Download Repository ===

Cloning: https://github.com/octocat/Hello-World.git

  Counting objects: 7/7 (100%)
  Compressing objects: 3/3 (100%)

Clone complete:
  Default branch: master
  Refs fetched: 2
  Pack size: 1.2 KB
  Bytes received: 1.5 KB
```

---

## API Reference Links

### Transport Package (packages/transport)

| Function / Type | Location | Purpose |
|-----------------|----------|---------|
| `lsRemote()` | [operations/ls-remote.ts](../../../packages/transport/src/operations/ls-remote.ts) | List remote refs without downloading objects |
| `clone()` | [operations/clone.ts](../../../packages/transport/src/operations/clone.ts) | Full repository download |
| `fetch()` | [operations/fetch.ts](../../../packages/transport/src/operations/fetch.ts) | Incremental fetch with negotiation |
| `BaseHttpOptions` | [api/options.ts](../../../packages/transport/src/api/options.ts) | Shared HTTP transport options |
| `RawFetchResult` | [api/fetch-result.ts](../../../packages/transport/src/api/fetch-result.ts) | Common fetch/clone result type |
| `RefSpec` | [utils/refspec.ts](../../../packages/transport/src/utils/refspec.ts) | Refspec parsing and matching |
| `AdvertisementParser` | [protocol/advertisement-parser.ts](../../../packages/transport/src/protocol/advertisement-parser.ts) | Ref advertisement parsing |

---

## Next Steps

- [09-repository-access](../09-repository-access/) - Server-side repository access for transport handlers
- [WebRTC P2P Sync Demo](../../demos/webrtc-p2p-sync/) - Peer-to-peer sync without a central server
