# @statewalker/vcs-transport

Git transport protocol implementation using finite state machines. Supports fetch, push, clone, and P2P sync over HTTP, WebSocket, WebRTC, and MessagePort.

## Overview

This package implements the Git wire protocol (v1 and v2) with an FSM-based architecture. Each protocol operation (fetch, push) is modeled as a state machine with explicit transitions and handlers, making the protocol flow easy to follow and test.

Three levels of abstraction are provided:

1. **Operations** — High-level functions for common tasks (`fetch`, `push`, `clone`, `lsRemote`, `p2pSync`)
2. **Duplex operations** — Transport-agnostic operations over any bidirectional stream (`fetchOverDuplex`, `pushOverDuplex`, `serveOverDuplex`)
3. **FSM primitives** — Raw state machines for custom protocol implementations

## Installation

```bash
pnpm add @statewalker/vcs-transport
```

## Quick Start

### Fetch from a Remote (HTTP)

```typescript
import { fetch } from "@statewalker/vcs-transport";
import { createVcsRepositoryFacade } from "@statewalker/vcs-transport-adapters";

const facade = createVcsRepositoryFacade({ history });

const result = await fetch({
  url: "https://github.com/user/repo.git",
  repository: facade,
  refSpecs: ["+refs/heads/*:refs/remotes/origin/*"],
});

console.log("Fetched refs:", result.refs);
```

### Push to a Remote (HTTP)

```typescript
import { push } from "@statewalker/vcs-transport";
import { createVcsRepositoryFacade } from "@statewalker/vcs-transport-adapters";

const facade = createVcsRepositoryFacade({ history });

const result = await push({
  url: "https://github.com/user/repo.git",
  repository: facade,
  refSpecs: ["refs/heads/main:refs/heads/main"],
  credentials: { username: "user", password: "token" },
});

console.log("Push result:", result);
```

### Clone a Repository

```typescript
import { clone } from "@statewalker/vcs-transport";
import { createVcsRepositoryFacade } from "@statewalker/vcs-transport-adapters";

const facade = createVcsRepositoryFacade({ history });

const result = await clone({
  url: "https://github.com/user/repo.git",
  repository: facade,
});
```

### P2P Sync over WebRTC/MessagePort

```typescript
import { fetchOverDuplex, serveOverDuplex } from "@statewalker/vcs-transport";
import { createMessagePortDuplex } from "@statewalker/vcs-transport";

// Create a Duplex from MessagePort
const duplex = createMessagePortDuplex(messagePort);

// Client side: fetch objects
const result = await fetchOverDuplex({
  duplex,
  repository: clientFacade,
  refStore: clientRefs,
});

// Server side: serve requests
await serveOverDuplex({
  duplex,
  repository: serverFacade,
  serviceType: "upload-pack",
});
```

### Bidirectional P2P Sync

```typescript
import { p2pSync } from "@statewalker/vcs-transport";

const result = await p2pSync({
  duplex,
  localRepository: localFacade,
  localRefStore: localRefs,
  remoteRepository: remoteFacade,
  direction: "both",
});
```

## Public API

### Operations (High-Level)

| Function | Transport | Description |
|----------|-----------|-------------|
| `fetch()` | HTTP | Fetch objects from a remote repository |
| `push()` | HTTP | Push objects to a remote repository |
| `clone()` | HTTP | Clone a remote repository |
| `lsRemote()` | HTTP | List remote references |
| `fetchOverDuplex()` | Duplex | Fetch over any bidirectional stream |
| `pushOverDuplex()` | Duplex | Push over any bidirectional stream |
| `serveOverDuplex()` | Duplex | Serve fetch/push requests over duplex |
| `p2pSync()` | Duplex | Bidirectional peer-to-peer sync |

### Core Interfaces

| Interface | Description |
|-----------|-------------|
| `Duplex` | Bidirectional async byte stream (reader + writer + close) |
| `RepositoryFacade` | Transport-layer repository operations (pack I/O, ancestry, reachability) |
| `RepositoryAccess` | Server-side repository operations (object/ref CRUD) |
| `TransportApi` | Low-level Git wire protocol I/O (pkt-line, sideband, pack) |
| `RefStore` | Reference read/write operations for transport |

### Adapters

| Function | Description |
|----------|-------------|
| `createMessagePortDuplex()` | Create Duplex from MessagePort |
| `createGitSocketClient()` | Create Git client from socket I/O handles |
| `handleGitSocketConnection()` | Handle Git server connection over socket |

### FSM Components

| Export | Description |
|--------|-------------|
| `Fsm` | Finite state machine engine |
| `clientFetchTransitions/Handlers` | Client-side fetch protocol |
| `serverFetchTransitions/Handlers` | Server-side fetch protocol |
| `clientPushTransitions/Handlers` | Client-side push protocol |
| `serverPushTransitions/Handlers` | Server-side push protocol |
| `clientV2Transitions/Handlers` | Protocol V2 client |
| `serverV2Transitions/Handlers` | Protocol V2 server |
| `errorRecoveryTransitions/Handlers` | Error recovery FSM |

### Factories

| Function | Description |
|----------|-------------|
| `createRepositoryFacade()` | Create RepositoryFacade from HistoryWithOperations |
| `createTransportApi()` | Create TransportApi from Duplex |

### Protocol Utilities

| Category | Exports |
|----------|---------|
| Pkt-line | `encodePacket`, `parsePacket`, `encodeFlush`, `encodeDelim` |
| Sideband | `demuxSideband`, `muxSideband`, `encodeSidebandPacket` |
| Capabilities | `parseCapabilities`, `negotiateCapabilities` |
| Acknowledgments | `parseAckNak`, `formatAck`, `formatNak` |
| Advertisement | `parseAdvertisement`, `parseBufferedAdvertisement` |
| Report Status | `parseReportStatus`, `parseReportStatusLines` |
| Errors | `TransportError`, `PackProtocolError`, `ServerError`, `AuthenticationError` |
| RefSpec | `parseRefSpec`, `formatRefSpec`, `matchSource`, `matchDestination` |
| URL | `parseGitUrl`, `formatGitUrl`, `toHttpUrl`, `resolveUrl` |

### Sub-Exports

| Export Path | Description |
|-------------|-------------|
| `@statewalker/vcs-transport/protocol` | Wire format: pkt-line, sideband, capabilities, constants |
| `@statewalker/vcs-transport/operations` | High-level operations: fetch, push, clone, lsRemote, p2pSync |

## Dependencies

**Runtime:**
- `@statewalker/vcs-core` — Store interfaces and types
- `@statewalker/vcs-utils` — Hashing, compression, pack utilities

**Adapters (separate package):**
- `@statewalker/vcs-transport-adapters` — Bridge VCS stores to RepositoryFacade/RepositoryAccess

## License

MIT
