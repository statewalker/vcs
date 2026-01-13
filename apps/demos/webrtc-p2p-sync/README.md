# WebRTC P2P Git Sync Demo

A demonstration of peer-to-peer Git repository synchronization using WebRTC data channels with manual signaling (QR code compatible).

## Overview

This demo shows how two peers can establish a direct WebRTC connection without a signaling server by manually exchanging connection data. In a real application, this exchange could happen via QR codes.

## Running the Demo

```bash
pnpm dev
```

Then open http://localhost:5173 in your browser.

## How It Works

### 1. Connection Establishment

The WebRTC connection uses a manual signaling process:

1. **Peer A (Initiator)** creates an offer containing:
   - SDP (Session Description Protocol) data
   - ICE candidates for NAT traversal

2. The offer is encoded into a compact JSON format suitable for QR codes

3. **Peer B (Responder)** receives the offer and creates an answer

4. The answer is sent back to Peer A to complete the connection

### 2. Data Channel

Once connected, a reliable data channel is established for bidirectional communication. This channel can carry Git protocol messages for repository synchronization.

### 3. Repository Sync

The demo includes a simplified sync that shows repository metadata being transferred. A full implementation would:

1. Use the Git pack protocol over the data channel
2. Transfer only objects the peer doesn't have
3. Update refs on the receiving side

## Key Components

### PeerManager

Manages the WebRTC peer connection lifecycle:

```typescript
const peer = new PeerManager("initiator");
peer.on("signal", (msg) => sendToPeer(msg));
peer.on("open", () => console.log("Connected!"));
await peer.connect();
```

### QrSignaling

Compresses signaling data for QR code exchange:

```typescript
const signaling = new QrSignaling();
const payload = signaling.createPayload(
  "initiator",
  peer.getLocalDescription(),
  peer.getCollectedCandidates()
);
// payload is ~200-500 bytes, suitable for QR code
```

### WebRtcStream

Adapts the data channel to the TransportConnection interface:

```typescript
const transport = createWebRtcStream(channel);
// Now use transport.send() and transport.receive() for Git protocol
```

## Network Requirements

- Both peers need to be able to reach each other via STUN/TURN
- The demo uses public Google STUN servers by default
- For connections behind restrictive NATs, a TURN server may be needed

## Limitations

This demo is simplified to illustrate the concepts:

- Sync shows metadata only (not full Git pack transfer)
- Both peers run in the same browser tab (for ease of demonstration)
- No persistence - repositories are in memory only

## See Also

- [@statewalker/vcs-transport-webrtc](../../../packages/transport-webrtc/) - The WebRTC transport package
- [Example 08: Transport Basics](../../examples/08-transport-basics/) - HTTP-based transport operations
