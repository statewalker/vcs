# VCS HTTP Roundtrip Example

This example demonstrates a complete Git HTTP workflow using VCS exclusively for both server and client operations. Native git is only used for verification purposes.

## Goal

The primary goal is to prove that the VCS library can handle the full Git HTTP smart protocol without depending on native git binaries. This includes:

- Creating and managing Git repositories entirely with VCS
- Serving repositories via a custom HTTP server that implements the Git smart HTTP protocol
- Cloning repositories using VCS transport (no `git clone`)
- Pushing changes using VCS transport (no `git push`)

## Architecture

The example consists of two main components:

### VCS HTTP Server

A custom HTTP server that implements the Git smart HTTP protocol endpoints:

| Endpoint | Method | Purpose |
|----------|--------|---------|
| `/repo.git/info/refs?service=git-upload-pack` | GET | Ref discovery for fetch/clone |
| `/repo.git/git-upload-pack` | POST | Send pack data to client |
| `/repo.git/info/refs?service=git-receive-pack` | GET | Ref discovery for push |
| `/repo.git/git-receive-pack` | POST | Receive pack data from client |

The server handles:
- Ref advertisement with capabilities
- Pack file generation for clone/fetch
- Pack file parsing and object storage for push
- Sideband multiplexing for progress messages
- Delta object resolution (OFS_DELTA and REF_DELTA)

### Main Workflow

The workflow executes these steps sequentially:

1. **Create remote repository** - Initialize a bare repository with an initial commit using VCS
2. **Start HTTP server** - Launch the VCS-based HTTP server
3. **Clone repository** - Clone using VCS transport module
4. **Verify clone** - Use native git to verify repository integrity
5. **Modify content** - Create new files and trees using VCS
6. **Create branch and commit** - Create a new branch with changes
7. **Push changes** - Push to remote using VCS transport
8. **Verify push** - Use native git to verify the pushed content

## Usage

Run the example:

```bash
pnpm start
```

The example will:
- Create test repositories in `./test-repos/`
- Start an HTTP server on port 8766
- Execute the full roundtrip workflow
- Print detailed progress and verification results
- Clean up and stop the server when done

## Key Files

### Configuration

[src/shared/config.ts](src/shared/config.ts) - Constants and configuration values:
- Repository paths
- HTTP server port
- Branch names
- Author information

### VCS HTTP Server

[src/shared/vcs-http-server.ts](src/shared/vcs-http-server.ts) - The HTTP server implementation:

- `handleInfoRefs()` - Ref discovery endpoint
- `handleUploadPack()` - Send objects to client for clone/fetch
- `handleReceivePack()` - Receive objects from client for push
- `buildPackForWants()` - Build pack file with requested objects
- `processReceivedPack()` - Parse incoming pack and store objects

### Helper Utilities

[src/shared/helpers.ts](src/shared/helpers.ts) - Utility functions:
- Git command execution for verification
- File system operations
- Output formatting

### Main Orchestration

[src/main.ts](src/main.ts) - The main workflow:

- `createRemoteRepository()` - Initialize bare repo with VCS
- `cloneRepository()` - Clone using VCS transport
- `modifyContent()` - Create new blobs and trees
- `createBranchAndCommit()` - Create branch and commit
- `pushChanges()` - Push using VCS transport
- `verifyPushWithNativeGit()` - Verify with native git

## Protocol Details

### Pack File Handling

The server implements pack file generation and parsing:

**For clone/fetch (upload-pack):**
1. Collect all objects reachable from wanted refs
2. Build pack using `PackWriterStream`
3. Send via sideband channel 1

**For push (receive-pack):**
1. Parse pkt-line encoded ref update commands
2. Extract pack data after flush packet
3. Parse pack header and object entries
4. Decompress and resolve delta objects
5. Store objects using `storeTypedObject()`

### Sideband Protocol

The server uses sideband-64k for multiplexing:
- Channel 1: Pack data
- Channel 2: Progress messages
- Channel 3: Error messages

### Object Storage

Objects are stored using `storeTypedObject()` which properly handles the Git object format with type headers. This is important because the standard `storage.objects.store()` method stores everything as blobs.

## Dependencies

- `@webrun-vcs/core` - Git storage, types, and interfaces
- `@webrun-vcs/transport` - Git transport protocol (clone, push)
- `@webrun-vcs/utils` - Compression and hash utilities

## Verification

The example uses native git for verification only:

```bash
# Verify repository integrity
git fsck

# Check branch exists
git branch -a

# Verify commit content
git log -1 --format="%H %s"
git ls-tree --name-only <branch>
```

All verification steps must pass for the example to report success.

## Output Example

```
============================================================
  VCS HTTP Roundtrip Example
============================================================

[Step 1] Creating remote repository with VCS
----------------------------------------
  Created blob: e1b875f
  Created tree: 0964a41
  Created commit: f583e64
  ✓ Remote repository created with initial commit: f583e64

[Step 2] Starting VCS HTTP server
----------------------------------------
  ✓ VCS HTTP server running at http://localhost:8766

[Step 3] Cloning repository using VCS transport
----------------------------------------
  Received 354 bytes
  ✓ Repository cloned

[Step 4] Verifying clone with native git
----------------------------------------
  ✓ Repository integrity check passed (git fsck)

[Step 5] Modifying content with VCS
----------------------------------------
  Created file: ROUNDTRIP.md

[Step 6] Creating branch and committing changes
----------------------------------------
  ✓ Commit created on branch 'vcs-roundtrip-branch'

[Step 7] Pushing changes using VCS transport
----------------------------------------
  ✓ Push successful!

[Step 8] Verifying push with native git
----------------------------------------
  ✓ Branch exists in remote
  ✓ Commit ID matches
  ✓ Repository integrity check passed (git fsck)

============================================================
  SUCCESS!
============================================================
```
