# Example 09: Repository Access for Transport

Serving repositories over transport using RepositoryAccess, RepositoryFacade, and RefStore.

## What You'll Learn

- **RepositoryAccess**: Low-level byte-level interface for protocol handlers
- **RepositoryFacade**: Pack-level import/export for transport FSM
- **RefStore**: Transport-compatible ref storage adapter
- **serveOverDuplex**: Serve Git requests over any duplex stream
- **fetchOverDuplex**: Fetch from a served repository

## Running the Example

```bash
pnpm start
```

## Key Concepts

### RepositoryAccess vs RepositoryFacade

Two interfaces bridge History to the transport layer at different abstraction levels:

**RepositoryAccess** (low-level, byte-oriented):
```typescript
import { createVcsRepositoryAccess } from "@statewalker/vcs-transport-adapters";

const access = createVcsRepositoryAccess({ history });

await access.hasObject(id);           // Check existence
await access.getObjectInfo(id);       // Get type + size
access.loadObject(id);                // Load raw Git wire format
await access.storeObject(type, data); // Store from wire format
access.listRefs();                    // Enumerate refs
await access.getHead();               // Get HEAD info
access.walkObjects(wants, haves);     // Object graph traversal
```

**RepositoryFacade** (high-level, pack-oriented):
```typescript
import { createVcsRepositoryFacade } from "@statewalker/vcs-transport-adapters";

const facade = createVcsRepositoryFacade({ history, serialization });

facade.exportPack(wants, exclude);     // Create pack stream
await facade.importPack(packStream);   // Import pack stream
await facade.has(oid);                 // Check existence
facade.walkAncestors(startOid);        // Commit graph walk
```

### RefStore Adapter

The transport layer uses a simpler ref interface than core:

```typescript
function createRefStoreAdapter(refs: Refs): RefStore {
  return {
    get: (name) => refs.resolve(name).then(r => r?.objectId),
    update: (name, oid) => refs.set(name, oid),
    listAll: async () => {
      const result: [string, string][] = [];
      for await (const entry of refs.list()) {
        if ("objectId" in entry && entry.objectId)
          result.push([entry.name, entry.objectId]);
      }
      return result;
    },
  };
}
```

### Serving Over Duplex

Any bidirectional stream (MessagePort, WebSocket, WebRTC) can serve Git requests:

```typescript
import { serveOverDuplex, fetchOverDuplex } from "@statewalker/vcs-transport";

// Server side
await serveOverDuplex({
  duplex: serverDuplex,
  repository: facade,
  refStore,
  service: "git-upload-pack",
});

// Client side
const result = await fetchOverDuplex({
  duplex: clientDuplex,
  repository: clientFacade,
  refStore: clientRefStore,
});
```

## See Also

- [Example 08: Transport Basics](../08-transport-basics/) - HTTP transport operations
- [Example 10: Custom Storage](../10-custom-storage/) - Building storage backends
- [WebRTC P2P Sync Demo](../../demos/webrtc-p2p-sync/) - Real-world P2P example
