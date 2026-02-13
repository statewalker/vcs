# VCS WebRTC Sync Demo

Sync Git repositories directly between browser tabs using WebRTC. No server required - changes flow peer-to-peer through encrypted data channels.

Open this app in two browser windows, create some files, and watch commits travel between them. The entire Git history lives in your browser's storage.

## Getting Started

You'll need a modern browser with File System Access API support. Chrome and Edge work best. Firefox users can still experiment with the in-memory storage option.

Start the development server:

```bash
pnpm install
pnpm dev
```

Navigate to the URL shown in the terminal (typically `http://localhost:5173`).

## Storage Options

When the app loads, you'll choose where to store your repository.

Click **Open Folder** to select a directory from your local filesystem. The app creates a `.git` folder there and tracks real files. Changes you make in your text editor appear automatically after a few seconds - the app polls for changes every 3 seconds.

For quick experiments, click **Memory Storage**. The app creates a virtual filesystem that vanishes when you close the tab. This works in all browsers and is great for testing the P2P sync flow.

## Working with Files

Once you've initialized a repository, the **Working Directory** panel shows your files with status indicators. Untracked files appear in yellow. Modified files show in orange. Staged files turn green.

Click the **+** button next to any file to stage it for commit. Click **-** to unstage. The **Staging Area** shows what will be included in your next commit.

Type a commit message and click **Commit**. Your commit appears immediately in the **Commit History** panel below.

## Creating Sample Content

New repositories start empty. Click **Create Sample Files** to populate your repo with some markdown documents - a main index page and a few docs in a nested folder. This gives you something to experiment with during sync testing.

## Viewing History

The **Commit History** panel shows your recent commits with shortened IDs and messages. Each commit has a **Restore** button that resets your working directory to that point in history.

The restore button stays disabled when you have uncommitted changes. Commit or discard your work first to time-travel safely.

## Connecting Two Peers

P2P synchronization requires a signaling step where two peers exchange connection information. This happens through manual copy-paste.

**In the first browser window (initiator):**

1. Click **Share** - this generates an offer signal
2. Copy the signal text to your clipboard
3. Send it to the other peer (paste into the second browser window)

**In the second browser window (responder):**

1. Click **Connect**
2. Paste the offer signal you received
3. Click **Accept Offer** - this generates an answer signal
4. Copy the answer and send it back to the first window

**Back in the first window:**

1. Paste the answer signal
2. Click **Accept Answer**

The connection indicator turns green when the WebRTC data channel is established.

## Syncing Changes

Once connected, the **Push** and **Fetch** buttons appear.

**Push** sends your local commits to the connected peer. The other browser receives the commits and updates its remote tracking reference. They can then integrate those changes into their working directory.

**Fetch** requests commits from the peer. Your browser receives their objects and stores them locally. A remote tracking ref (`refs/remotes/peer/main`) points to their latest commit.

The current implementation transfers commits one-way per operation. For bidirectional sync, both peers should push and fetch.

## Conflict Detection

When both peers modify the same file independently, the app detects conflicting changes. The **Activity Log** reports which files differ between local and remote versions.

The demo provides basic conflict detection but not automatic merging. You'll need to manually coordinate which version to keep. A full implementation would offer three-way merge or explicit conflict resolution UI.

## Architecture

The application follows an MVC pattern where data flows through distinct layers:

```
User ←→ Views ←→ Models ←→ Controllers ←→ External World
```

**Models** hold observable state. Each model extends `BaseClass` with an `onUpdate(listener)` method that views use to subscribe to changes. When a model calls `notify()`, all subscribed views re-render.

**Controllers** interact with external systems - the filesystem, Git storage, and WebRTC connections. They read and update models but never render UI directly.

**Views** render HTML based on model state and dispatch user actions to controllers. Each view subscribes to the models it needs and returns a cleanup function for proper teardown.

### Key Models

The `RepositoryModel` tracks whether storage is selected, whether a Git repository exists, and the current branch and HEAD commit.

The `FileListModel` maintains the working directory tree with status for each file - untracked, modified, staged, or unchanged.

The `ConnectionModel` manages WebRTC state: new, connecting, connected, disconnected, or failed. Views use this to show connection indicators and enable sync buttons.

The `SharingFormModel` handles the signaling workflow with slots for local and remote signals during offer/answer exchange.

### Key Controllers

The `StorageController` interfaces with the File System Access API or creates an in-memory filesystem.

The `RepositoryController` performs Git operations using the `vcs-commands` package - staging files, creating commits, walking history.

The `WebRtcController` manages `PeerManager` from `vcs-transport-webrtc` to establish data channels.

The `SyncController` serializes Git objects and sends them over the WebRTC connection.

## Dependencies

This demo integrates several packages from the VCS ecosystem:

The `@statewalker/vcs-core` package provides low-level Git primitives - blob storage, tree structures, commit objects.

The `@statewalker/vcs-commands` package offers a fluent API for Git operations like `git.add()` and `git.commit()`.

The `@statewalker/vcs-transport-webrtc` package handles WebRTC peer connections with `PeerManager` and signaling helpers.

The `@statewalker/webrun-files` packages provide filesystem abstractions for both browser and in-memory storage.

## Limitations

**Browser support**: The File System Access API works in Chrome and Edge. Firefox and Safari users can only use memory storage.

**NAT traversal**: Without a TURN server, connections between peers behind restrictive NATs may fail. The demo works reliably when both browsers are on the same network or have permissive NAT settings.

**No automatic merge**: Conflicting changes require manual resolution. The app detects conflicts but doesn't perform three-way merges.

**Manual signaling**: Connection setup requires copy-pasting signals between browser windows. A real application would use a signaling server or QR codes for easier exchange.

## Development

The source lives in `src/` with separate directories for models, controllers, views, and utilities.

Run the development server with `pnpm dev`. The app hot-reloads on file changes.

Build for production with `pnpm build`. Output goes to `dist/` as static files you can serve from any web server.
