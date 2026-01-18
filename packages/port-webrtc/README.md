# @statewalker/vcs-port-webrtc

WebRTC MessagePortLike adapter for peer-to-peer Git synchronization without servers.

## Goals

This package enables **completely serverless** peer-to-peer Git repository synchronization by:

1. **Eliminating server dependencies** - Peers connect directly using WebRTC data channels
2. **QR code signaling** - Connection data is compact enough for QR codes (~200-500 bytes)
3. **Git protocol integration** - Adapts WebRTC channels to the standard `TransportConnection` interface
4. **Browser-first design** - Works in modern browsers with no additional dependencies

### Use Cases

- **Offline collaboration** - Sync repositories between devices without internet
- **Privacy-preserving sync** - Data never touches third-party servers
- **Local network sharing** - Share code with nearby collaborators
- **Air-gapped environments** - Transfer repositories via QR codes in restricted networks

## Installation

```bash
npm install @statewalker/vcs-port-webrtc
# or
pnpm add @statewalker/vcs-port-webrtc
```

## Quick Start

### Basic Connection

```typescript
import {
  PeerManager,
  createDataChannelPort,
  waitForConnection
} from "@statewalker/vcs-port-webrtc";
import { createPortTransportConnection } from "@statewalker/vcs-transport";

// === PEER A (Initiator) ===
const peerA = new PeerManager("initiator");

// Listen for signaling messages to send to Peer B
peerA.on("signal", (msg) => {
  // Send msg to Peer B via your signaling channel
  // (WebSocket, QR code, manual copy/paste, etc.)
  sendToPeerB(msg);
});

// Start the connection process
await peerA.connect();

// === PEER B (Responder) ===
const peerB = new PeerManager("responder");

// Listen for signaling messages to send to Peer A
peerB.on("signal", (msg) => {
  sendToPeerA(msg);
});

// Handle incoming signals from Peer A
receiveFromPeerA((msg) => {
  peerB.handleSignal(msg);
});

// === Both peers: wait for connection ===
const channel = await waitForConnection(peerA); // or peerB

// Create port and transport for Git protocol
const port = createDataChannelPort(channel);
const transport = createPortTransportConnection(port);

// Now use transport.send() and transport.receive() for Git operations
```

### QR Code Signaling (Serverless)

For completely serverless connections using QR codes:

```typescript
import {
  PeerManager,
  QrSignaling
} from "@statewalker/vcs-port-webrtc";

// === PEER A: Create offer QR code ===
const signaling = new QrSignaling();
const peerA = new PeerManager("initiator");

await peerA.connect();
await peerA.waitForIceGathering();

// Create compact payload for QR code
const offerPayload = signaling.createPayload(
  "initiator",
  peerA.getLocalDescription()!,
  peerA.getCollectedCandidates()
);

// Display offerPayload as QR code (typically 200-500 chars)
displayQrCode(offerPayload);

// === PEER B: Scan offer, create answer ===
const scannedPayload = await scanQrCode();
const { description, candidates } = signaling.parsePayload(scannedPayload);

const peerB = new PeerManager("responder");

// Apply the offer
await peerB.handleSignal({ type: "offer", sdp: description.sdp });
for (const candidate of candidates) {
  await peerB.handleSignal({ type: "candidate", candidate });
}

await peerB.waitForIceGathering();

// Create answer QR code
const answerPayload = signaling.createPayload(
  "responder",
  peerB.getLocalDescription()!,
  peerB.getCollectedCandidates()
);

displayQrCode(answerPayload);

// === PEER A: Scan answer to complete connection ===
const answerScanned = await scanQrCode();
const answer = signaling.parsePayload(answerScanned);

await peerA.handleSignal({ type: "answer", sdp: answer.description.sdp });
for (const candidate of answer.candidates) {
  await peerA.handleSignal({ type: "candidate", candidate });
}

// Connection established!
```

## Architecture

### Components

```
┌─────────────────────────────────────────────────────────────────┐
│                     Application Layer                            │
│  (Git commands, repository sync, UI)                            │
└─────────────────────────────────────────────────────────────────┘
                              │
                              ▼
┌─────────────────────────────────────────────────────────────────┐
│                    DataChannelPort                               │
│  Adapts RTCDataChannel to MessagePortLike interface             │
│  - Binary message handling                                       │
│  - Connection state tracking                                     │
│  - Backpressure via bufferedAmount                              │
└─────────────────────────────────────────────────────────────────┘
                              │
                              ▼
┌─────────────────────────────────────────────────────────────────┐
│                    PeerManager                                   │
│  Manages WebRTC connection lifecycle                            │
│  - Offer/answer negotiation                                     │
│  - ICE candidate gathering                                      │
│  - Connection state tracking                                    │
│  - Data channel creation                                        │
└─────────────────────────────────────────────────────────────────┘
                              │
                              ▼
┌─────────────────────────────────────────────────────────────────┐
│                    QrSignaling                                   │
│  Compresses signaling for serverless exchange                   │
│  - SDP compression (removes redundant data)                     │
│  - ICE candidate compaction                                     │
│  - Base64 URL-safe encoding                                     │
└─────────────────────────────────────────────────────────────────┘
```

### How It Works

#### 1. Connection Establishment

WebRTC requires an initial "signaling" exchange to establish a connection:

1. **Initiator** creates an SDP offer describing their media capabilities
2. **Responder** receives the offer and creates an SDP answer
3. Both peers exchange ICE candidates for NAT traversal
4. Once candidates match, a direct peer-to-peer connection is established

#### 2. Signaling Compression

Traditional WebRTC signaling data is large (2-5KB). This package compresses it:

| Data | Original Size | Compressed |
|------|--------------|------------|
| SDP Offer | ~2KB | ~150 bytes |
| ICE Candidates (5) | ~500 bytes | ~100 bytes |
| **Total** | **~2.5KB** | **~250 bytes** |

Compression techniques:
- Remove redundant SDP lines (most are defaults)
- Compact ICE candidate format
- URL-safe Base64 encoding

#### 3. Data Channel Adaptation

The `DataChannelPort` adapter bridges WebRTC and the transport layer:

```
RTCDataChannel                    MessagePortLike
     │                                    │
     │  Binary messages                   │  postMessage/onmessage
     │  ArrayBuffer                       │  ArrayBuffer
     │                                    │
     └──────────── DataChannelPort ───────┘
           - Binary message handling
           - Connection state (isOpen)
           - Backpressure (bufferedAmount)
```

Use with `createPortTransportConnection` from `@statewalker/vcs-transport`:

```typescript
const port = createDataChannelPort(channel);
const transport = createPortTransportConnection(port);
```

## API Reference

### PeerManager

Manages the WebRTC peer connection lifecycle.

```typescript
const peer = new PeerManager(role: "initiator" | "responder", options?: WebRtcConnectionOptions);

// Events
peer.on("signal", (msg: SignalingMessage) => void);  // Forward to remote peer
peer.on("stateChange", (state: ConnectionState) => void);
peer.on("open", () => void);   // Data channel ready
peer.on("close", () => void);
peer.on("error", (err: Error) => void);

// Methods
await peer.connect();                    // Start as initiator
await peer.handleSignal(msg);            // Process incoming signal
await peer.waitForIceGathering();        // Wait for all ICE candidates
peer.getLocalDescription();              // Get SDP for signaling
peer.getCollectedCandidates();           // Get ICE candidates
peer.getDataChannel();                   // Get the RTCDataChannel
await peer.getStats();                   // Get connection statistics
peer.close();                            // Close connection
```

### DataChannelPort

Adapts RTCDataChannel to MessagePortLike interface.

```typescript
import { createDataChannelPort, createDataChannelPortAsync } from "@statewalker/vcs-port-webrtc";

// Synchronous (channel must be open)
const port = createDataChannelPort(channel: RTCDataChannel);

// Async (waits for channel to open)
const port = await createDataChannelPortAsync(channel: RTCDataChannel);

// MessagePortLike interface
port.postMessage(data: ArrayBuffer | Uint8Array);
port.onmessage = (event: MessageEvent<ArrayBuffer>) => void;
port.onclose = () => void;
port.onerror = (error: Error) => void;
port.close();
port.start();

// Additional properties
port.isOpen;          // boolean
port.bufferedAmount;  // number
port.readyState;      // RTCDataChannelState
```

### QrSignaling

Helper for QR code-based serverless signaling.

```typescript
import { QrSignaling } from "@statewalker/vcs-port-webrtc";

const signaling = new QrSignaling(sessionId?: string);

// Create compact payload
const payload = signaling.createPayload(
  role: "initiator" | "responder",
  description: SessionDescription,
  candidates: IceCandidate[]
);

// Parse payload from peer
const { sessionId, role, description, candidates } = signaling.parsePayload(payload);

// Utilities
signaling.getSessionId();              // Get session ID
signaling.verifySession(parsedId);     // Verify session match
```

### Standalone Functions

```typescript
import {
  generateSessionId,
  createCompressedSignal,
  parseCompressedSignal,
  encodeSignal,
  decodeSignal,
  estimateQrVersion,
  waitForConnection,
} from "@statewalker/vcs-port-webrtc";

// Generate random session ID
const sessionId = generateSessionId();

// Low-level signal compression
const signal = createCompressedSignal(sessionId, role, description, candidates);
const { description, candidates } = parseCompressedSignal(signal);

// Encoding for transmission
const encoded = encodeSignal(signal);  // URL-safe string
const decoded = decodeSignal(encoded);

// Estimate QR code version needed
const qrVersion = estimateQrVersion(signal);  // 1-40

// Wait for connection with timeout
const channel = await waitForConnection(peer, timeout?: number);
```

### Types

```typescript
type PeerRole = "initiator" | "responder";

type ConnectionState =
  | "new"
  | "connecting"
  | "connected"
  | "disconnected"
  | "failed"
  | "closed";

interface SignalingMessage =
  | { type: "offer"; sdp: string }
  | { type: "answer"; sdp: string }
  | { type: "candidate"; candidate: IceCandidate }
  | { type: "ready" };

interface WebRtcConnectionOptions {
  iceServers?: RTCIceServer[];
  connectionTimeout?: number;      // Default: 30000ms
  iceGatheringTimeout?: number;    // Default: 5000ms
  channelLabel?: string;           // Default: "git-sync"
  ordered?: boolean;               // Default: true
  maxRetransmits?: number;
}

interface WebRtcStats {
  bytesSent: number;
  bytesReceived: number;
  roundTripTimeMs?: number;
  connectionDurationMs: number;
  candidatesGathered: number;
}
```

## Network Requirements

### STUN/TURN Servers

By default, the package uses Google's public STUN servers:

```typescript
const DEFAULT_ICE_SERVERS = [
  { urls: "stun:stun.l.google.com:19302" },
  { urls: "stun:stun1.l.google.com:19302" },
];
```

For connections behind restrictive NATs/firewalls, you may need a TURN server:

```typescript
const peer = new PeerManager("initiator", {
  iceServers: [
    { urls: "stun:stun.l.google.com:19302" },
    {
      urls: "turn:your-turn-server.com:3478",
      username: "user",
      credential: "password",
    },
  ],
});
```

### Connectivity Scenarios

| Scenario | STUN Sufficient | TURN Required |
|----------|-----------------|---------------|
| Same LAN | ✅ | No |
| Different networks (no NAT) | ✅ | No |
| Behind NAT (most home/office) | ✅ | No |
| Symmetric NAT | ❌ | Yes |
| Corporate firewalls | ❌ | Yes |

## Browser Compatibility

This package uses standard WebRTC APIs available in:

- Chrome 56+
- Firefox 44+
- Safari 11+
- Edge 79+

No polyfills or additional dependencies required.

## Limitations

- **Signaling still required** - Peers must exchange initial signals somehow (QR codes, copy/paste, WebSocket, etc.)
- **TURN for restricted networks** - Some networks block peer-to-peer; TURN relay may be needed
- **Browser only** - Uses browser WebRTC APIs; Node.js would require a WebRTC implementation

## See Also

- [WebRTC P2P Sync Demo](../../apps/demos/webrtc-p2p-sync/) - Interactive browser demo
- [@statewalker/vcs-port-peerjs](../port-peerjs/) - PeerJS adapter
- [@statewalker/vcs-port-websocket](../port-websocket/) - WebSocket adapter
- [@statewalker/vcs-transport](../transport/) - Transport layer interfaces

## License

MIT
