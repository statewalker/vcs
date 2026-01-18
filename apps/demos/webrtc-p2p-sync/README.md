# WebRTC P2P Git Sync Demo

A demonstration of peer-to-peer Git repository synchronization using WebRTC data channels with PeerJS for signaling.

## Overview

This demo shows how two peers can synchronize Git repositories directly over WebRTC without a central server. One peer hosts a session, shares a session ID (or QR code), and other peers can join to sync their repositories.

## Running the Demo

```bash
pnpm dev
```

Then open http://localhost:5173 in your browser.

## Features

- **P2P Connection** - Direct WebRTC data channels via PeerJS
- **Session Sharing** - Share via session ID, URL, or QR code
- **Full Git Sync** - Transfer commits, trees, and blobs between peers
- **In-Memory Storage** - Repositories are stored in memory (no persistence)
- **Real-Time Progress** - Track sync progress with object/byte counts

## How It Works

### 1. Session Establishment

1. **Host** creates a session and receives a unique session ID
2. Session ID is shared via URL or QR code
3. **Guest** enters the session ID to connect
4. PeerJS handles WebRTC signaling automatically

### 2. Repository Sync

Once connected, peers can sync their repositories:

1. Exchange repository metadata (HEAD, branch, object count)
2. Send local Git objects (commits, trees, blobs)
3. Receive and store remote objects
4. Update refs and checkout working directory

### 3. Git Operations

The demo uses a full Git implementation:
- Create files and add to staging
- Commit changes with author information
- View commit history
- Checkout branches

## Architecture

See [ARCHITECTURE.md](ARCHITECTURE.md) for detailed documentation of:
- MVC pattern with Models, Views, and Controllers
- Strategic patterns (Context Adapters, User Actions)
- Tactical patterns (Registry, Observable Base)
- API usage and data flow

### Quick Overview

```
Views ──enqueue actions──▶ UserActionsModel ──dispatch──▶ Controllers
  ▲                                                           │
  │                                                           ▼
  └────────────── subscribe to ◀─────────── update ───── Models
```

**Key principles:**
- Views communicate **only via models** (easy to test, swap UI frameworks)
- Controllers listen to typed actions, perform logic, update models
- Context adapters provide dependency injection without framework overhead

## Key Components

### Git Infrastructure

```typescript
import { Git, createGitStore } from "@statewalker/vcs-commands";
import { createGitRepository, createInMemoryFilesApi } from "@statewalker/vcs-core";

const files = createInMemoryFilesApi();
const repository = await createGitRepository(files, ".git", { create: true });
const git = Git.wrap(createGitStore({ repository, staging, worktree, files }));
```

### PeerJS Integration

```typescript
import { Peer } from "peerjs";

// Host creates a peer with generated ID
const peer = new Peer(sessionId);
peer.on("connection", (conn) => {
  conn.on("data", handleMessage);
});

// Guest connects to host
const conn = peer.connect(hostSessionId);
conn.on("open", () => startSync(conn));
```

## Project Structure

```
src/
├── main.ts           # Entry point
├── controllers/      # Business logic
├── models/           # State containers
├── views/            # UI rendering
├── actions/          # Action type definitions
├── apis/             # External API adapters
├── utils/            # Shared utilities
└── lib/              # Helper functions
```

## Network Requirements

- Both peers need WebRTC support (modern browsers)
- Uses PeerJS cloud server for signaling (fallback available)
- For restrictive NATs, TURN server may be needed

## Limitations

- **No persistence** - Repositories are in memory only
- **Single branch** - Syncs only the main branch
- **No conflict resolution** - Remote changes overwrite local on divergence

## See Also

- [ARCHITECTURE.md](ARCHITECTURE.md) - Detailed architecture documentation
- [@statewalker/vcs-commands](../../../packages/commands/) - Git porcelain API
- [@statewalker/vcs-core](../../../packages/core/) - Core Git primitives
- [@statewalker/vcs-transport-webrtc](../../../packages/transport-webrtc/) - WebRTC transport
