# Example 08: Transport Basics

This example demonstrates Git transport operations using the Git HTTP smart protocol.

## What You'll Learn

- **ls-remote**: List refs in a remote repository without downloading objects
- **checkRemote**: Verify if a repository is accessible
- **fetchRefs**: Get full ref advertisement including capabilities
- **clone**: Download a complete repository
- **fetch**: Update refs from a remote (incremental updates)

## Running the Example

```bash
pnpm start
```

## Key Concepts

### Git HTTP Smart Protocol

The transport layer implements the Git HTTP smart protocol for communicating
with remote Git servers like GitHub, GitLab, and self-hosted instances.

Two services are available:
- **upload-pack**: For fetch/clone operations (downloading from remote)
- **receive-pack**: For push operations (uploading to remote)

### Ref Advertisement

When connecting to a remote, the server sends a "ref advertisement" containing:
- All refs (branches, tags) and their commit IDs
- Server capabilities (features the server supports)
- Symbolic refs (like HEAD pointing to the default branch)

### Pack Files

Git transfers objects in pack format - a highly compressed binary format that:
- Groups related objects together
- Uses delta compression to reduce size
- Includes a SHA-1 checksum for integrity

### Refspecs

Refspecs define how remote refs map to local refs:
- `+refs/heads/*:refs/remotes/origin/*` - Track remote branches
- `+refs/tags/*:refs/tags/*` - Track remote tags
- `refs/heads/main:refs/heads/main` - Single branch mapping

The `+` prefix means force update (allow non-fast-forward).

## Example Output

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

## Code Highlights

### Listing Remote Refs

```typescript
import { lsRemote } from "@statewalker/vcs-transport";

const refs = await lsRemote("https://github.com/owner/repo.git");
for (const [name, id] of refs) {
  console.log(`${name}: ${id}`);
}
```

### Cloning a Repository

```typescript
import { clone } from "@statewalker/vcs-transport";

const result = await clone({
  url: "https://github.com/owner/repo.git",
  onProgress: (info) => {
    console.log(`${info.stage}: ${info.current}/${info.total}`);
  },
});

// result.packData contains the pack file
// result.refs contains the fetched refs
// result.defaultBranch is the default branch name
```

### Fetching Updates

```typescript
import { fetch } from "@statewalker/vcs-transport";

const result = await fetch({
  url: "https://github.com/owner/repo.git",
  refspecs: ["+refs/heads/*:refs/remotes/origin/*"],
  localHas: async (objectId) => {
    // Return true if we already have this object
    return myStore.hasObject(objectId);
  },
});
```

## Network Requirements

This example requires network access to GitHub. It uses a small public
repository (octocat/Hello-World) for demonstration.

## See Also

- [Example 01: Quick Start](../01-quick-start/) - Basic repository operations
- [WebRTC P2P Sync Demo](../../demos/webrtc-p2p-sync/) - Peer-to-peer sync without servers
