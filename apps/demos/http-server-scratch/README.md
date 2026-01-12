# HTTP Git Server from Scratch

Build a Git HTTP server from scratch using VCS, without depending on native git binaries.

## What This Demonstrates

This demo shows how to implement the Git smart HTTP protocol using VCS storage:

- **Server Implementation**: Full Git HTTP protocol handling (info/refs, upload-pack, receive-pack)
- **Clone Support**: Clients can clone repositories via HTTP
- **Push Support**: Clients can push changes back to the server
- **Native Git Compatible**: Works with standard git clients

## Architecture

```
┌─────────────────────────────────────────────────────────────────┐
│                    HTTP Git Server                               │
│         (Node.js using VCS transport and storage)               │
├─────────────────────────────────────────────────────────────────┤
│  Endpoints:                                                      │
│  GET  /repo.git/info/refs?service=git-upload-pack               │
│  POST /repo.git/git-upload-pack                                 │
│  GET  /repo.git/info/refs?service=git-receive-pack              │
│  POST /repo.git/git-receive-pack                                │
└─────────────────────────────────────────────────────────────────┘
                          ↕
┌─────────────────────────────────────────────────────────────────┐
│                    Git Clients                                   │
│  - Native git (git clone, git push)                              │
│  - VCS transport (clone, push functions)                         │
│  - Any Git-compatible client                                     │
└─────────────────────────────────────────────────────────────────┘
```

## Running the Demos

### Full Roundtrip Demo

Demonstrates the complete workflow: create repo, start server, clone, modify, push.

```bash
pnpm start
```

This will:
1. Create a bare repository using VCS
2. Start the HTTP server
3. Clone using VCS transport
4. Create a new file and commit
5. Push changes back
6. Verify with native git

### Server-Only Mode

Run a standalone Git HTTP server for your repositories:

```bash
# Default settings (port 8080, repos in ./repos)
pnpm server

# Custom port
pnpm server -- --port 9000

# Custom repos directory
pnpm server -- --dir /path/to/repos
```

Then use any Git client:

```bash
# Clone with native git
git clone http://localhost:8080/repo.git

# Push changes
git push http://localhost:8080/repo.git main
```

### Client-Only Mode

Use VCS transport to interact with any Git HTTP server:

```bash
# Clone a repository
pnpm client http://localhost:8080/repo.git

# Clone and push changes
pnpm client http://localhost:8080/repo.git --push

# Custom destination directory
pnpm client http://localhost:8080/repo.git --dir ./my-clone
```

## Key Code Highlights

### Creating the HTTP Server

```typescript
import { createVcsHttpServer } from "./shared/index.js";

const server = await createVcsHttpServer({
  port: 8080,
  getStorage: async (repoPath: string) => {
    // Return GitRepository for the requested path
    if (repoPath === "repo.git") {
      return myRepository;
    }
    return null;
  },
});

console.log("Server running on http://localhost:8080");
```

### Cloning via HTTP

```typescript
import { clone } from "@statewalker/vcs-transport";

const result = await clone({
  url: "http://localhost:8080/repo.git",
  onProgressMessage: (msg) => console.log(msg),
});

console.log(`Received ${result.bytesReceived} bytes`);
console.log(`Default branch: ${result.defaultBranch}`);
```

### Pushing Changes

```typescript
import { push } from "@statewalker/vcs-transport";

const result = await push({
  url: "http://localhost:8080/repo.git",
  refspecs: ["refs/heads/main:refs/heads/main"],
  getLocalRef: async (refName) => {
    const ref = await repository.refs.resolve(refName);
    return ref?.objectId;
  },
  getObjectsToPush: async function* () {
    // Yield objects to send
    for (const obj of objects) {
      yield obj;
    }
  },
});

if (result.ok) {
  console.log("Push successful!");
}
```

## Protocol Details

The server implements the Git smart HTTP protocol:

1. **Ref Discovery** (`GET /repo.git/info/refs?service=git-upload-pack`)
   - Returns available refs and capabilities
   - Used by clients to discover repository state

2. **Fetch/Clone** (`POST /repo.git/git-upload-pack`)
   - Client sends "want" lines for desired objects
   - Server responds with pack data containing requested objects

3. **Push** (`POST /repo.git/git-receive-pack`)
   - Client sends ref updates and pack data
   - Server processes pack and updates refs

## Use Cases

- **Edge Computing**: Run Git servers on edge nodes without installing git
- **Embedded Systems**: Lightweight Git server for IoT devices
- **Custom Hosting**: Build your own Git hosting platform
- **Testing**: Create ephemeral Git servers for integration tests
