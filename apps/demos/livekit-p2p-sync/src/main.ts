/**
 * LiveKit P2P Git Sync Demo - Main Entry Point
 *
 * Demonstrates peer-to-peer repository synchronization using LiveKit rooms
 * for data transport. Unlike PeerJS (direct P2P), LiveKit uses a server
 * (SFU) that mediates connections, enabling multi-party sync.
 *
 * Architecture:
 * LiveKit Room → per-participant MessagePort → Duplex → Git protocol FSM
 *
 * Prerequisites:
 *   livekit-server --dev    # Start local LiveKit server on ws://localhost:7880
 */

import { Git } from "@statewalker/vcs-commands";
import type { History, SerializationApi } from "@statewalker/vcs-core";
import {
  createMemoryGitStaging,
  createMemoryHistory,
  DefaultSerializationApi,
  FileMode,
  MemoryCheckout,
  MemoryWorkingCopy,
  MemoryWorktree,
} from "@statewalker/vcs-core";
import {
  createLiveKitPort,
  type ParticipantInfo,
  RoomManager,
} from "@statewalker/vcs-port-livekit";
import { generateDevToken } from "./services/dev-token.js";
import { createGitPeerSession, setupGitPeerServer } from "./services/index.js";

// --- State ---

let roomManager: RoomManager | null = null;
let history: History | null = null;
let serialization: SerializationApi | null = null;
let git: Git | null = null;

/** Active Git servers per participant identity */
const gitServers = new Map<string, () => void>();
/** Active MessagePorts per participant identity */
const participantPorts = new Map<string, MessagePort>();

// --- Logging ---

function log(msg: string, level: "info" | "success" | "error" = "info"): void {
  const el = document.getElementById("log-output");
  if (!el) return;
  const line = document.createElement("div");
  line.className = `log-${level}`;
  const time = new Date().toLocaleTimeString();
  line.textContent = `[${time}] ${msg}`;
  el.appendChild(line);
  el.scrollTop = el.scrollHeight;
}

// --- Git Infrastructure ---

async function initializeGit(): Promise<void> {
  history = createMemoryHistory();
  await history.initialize();
  await history.refs.setSymbolic("HEAD", "refs/heads/main");

  const staging = createMemoryGitStaging();
  const checkout = new MemoryCheckout({
    staging,
    initialHead: { type: "symbolic", target: "refs/heads/main" },
  });
  const worktree = new MemoryWorktree({
    blobs: history.blobs,
    trees: history.trees,
  });
  const workingCopy = new MemoryWorkingCopy({ history, checkout, worktree });

  git = Git.fromWorkingCopy(workingCopy);
  serialization = new DefaultSerializationApi({ history });
}

// --- LiveKit Connection ---

async function connectToRoom(): Promise<void> {
  const urlInput = document.getElementById("lk-url") as HTMLInputElement;
  const roomInput = document.getElementById("lk-room") as HTMLInputElement;
  const identityInput = document.getElementById("lk-identity") as HTMLInputElement;
  const tokenInput = document.getElementById("lk-token") as HTMLInputElement;

  const url = urlInput.value.trim() || "ws://localhost:7880";
  const roomName = roomInput.value.trim() || "git-sync";
  const identity = identityInput.value.trim() || `user-${Math.random().toString(36).slice(2, 6)}`;

  // Use provided token or generate dev token
  let token = tokenInput.value.trim();
  if (!token) {
    log(`Generating dev token for identity="${identity}" room="${roomName}"`);
    token = await generateDevToken(identity, roomName);
  }

  updateConnectionStatus("connecting");
  log(`Connecting to ${url} as "${identity}" in room "${roomName}"...`);

  roomManager = new RoomManager();

  roomManager.on("participantConnected", (info: ParticipantInfo) => {
    log(`Participant joined: ${info.identity}`, "success");
    setupParticipantPort(info.identity);
    updatePeerList();
  });

  roomManager.on("participantDisconnected", (info: ParticipantInfo) => {
    log(`Participant left: ${info.identity}`);
    cleanupParticipant(info.identity);
    updatePeerList();
  });

  roomManager.on("connectionStateChanged", (state: string) => {
    log(`Connection state: ${state}`);
    if (state === "disconnected") {
      updateConnectionStatus("disconnected");
    }
  });

  try {
    await roomManager.connect({ url, token });
    identityInput.value = identity;
    updateConnectionStatus("connected");
    log(`Connected as "${roomManager.getLocalIdentity()}"`, "success");

    // Set up ports for existing participants
    for (const p of roomManager.getParticipants()) {
      setupParticipantPort(p.identity);
    }
    updatePeerList();
    updateButtons();
  } catch (error) {
    const msg = error instanceof Error ? error.message : String(error);
    log(`Connection failed: ${msg}`, "error");
    updateConnectionStatus("disconnected");
    roomManager = null;
  }
}

async function disconnectFromRoom(): Promise<void> {
  // Clean up all participant connections
  for (const identity of [...participantPorts.keys()]) {
    cleanupParticipant(identity);
  }

  if (roomManager) {
    await roomManager.disconnect();
    roomManager = null;
  }

  updateConnectionStatus("disconnected");
  updatePeerList();
  updateButtons();
  log("Disconnected");
}

function setupParticipantPort(identity: string): void {
  if (!roomManager || !history || !serialization) return;
  if (participantPorts.has(identity)) return;

  const room = roomManager.getRoom();
  const port = createLiveKitPort(room, identity);
  participantPorts.set(identity, port);

  // Start Git server for this participant
  const stopServer = setupGitPeerServer({
    port,
    history,
    serialization,
    onPushReceived: () => {
      log(`Received push from ${identity}`, "success");
      refreshUI().catch((e) =>
        log(`UI refresh error: ${e instanceof Error ? e.message : String(e)}`, "error"),
      );
    },
    log: (msg) => log(`[server:${identity}] ${msg}`),
  });
  gitServers.set(identity, stopServer);
}

function cleanupParticipant(identity: string): void {
  const stopServer = gitServers.get(identity);
  if (stopServer) {
    stopServer();
    gitServers.delete(identity);
  }

  const port = participantPorts.get(identity);
  if (port) {
    port.close();
    participantPorts.delete(identity);
  }
}

// --- Git Operations ---

async function handleInit(): Promise<void> {
  if (!git || !history) {
    log("Git not initialized", "error");
    return;
  }

  try {
    const encoder = new TextEncoder();

    // Create initial file directly via history APIs
    const blob = await history.blobs.store([
      encoder.encode("# LiveKit P2P Sync Demo\n\nInitial repository.\n"),
    ]);
    const tree = await history.trees.store([
      { mode: FileMode.REGULAR_FILE, name: "README.md", id: blob },
    ]);

    const now = Math.floor(Date.now() / 1000);
    const author = {
      name: roomManager?.getLocalIdentity() ?? "User",
      email: "demo@example.com",
      timestamp: now,
      tzOffset: "+0000",
    };

    const commitId = await history.commits.store({
      tree,
      parents: [],
      author,
      committer: author,
      message: "Initial commit",
    });
    await history.refs.set("refs/heads/main", commitId);

    log(`Initialized repository: ${commitId.slice(0, 7)}`, "success");
    await refreshUI();
  } catch (error) {
    log(`Init failed: ${error instanceof Error ? error.message : String(error)}`, "error");
  }
}

async function handleAddFile(): Promise<void> {
  if (!history) return;

  const fileName = `file-${Date.now() % 10000}.txt`;
  const content = `Created by ${roomManager?.getLocalIdentity() ?? "user"} at ${new Date().toISOString()}\n`;
  const encoder = new TextEncoder();

  try {
    // Get current tree
    const mainRef = await history.refs.resolve("refs/heads/main");
    if (!mainRef?.objectId) {
      log("No commits yet — init first", "error");
      return;
    }

    const parentCommit = await history.commits.load(mainRef.objectId);
    if (!parentCommit) return;

    // Load existing tree entries
    const existingEntries = [];
    const treeEntries = await history.trees.load(parentCommit.tree);
    if (treeEntries) {
      for await (const entry of treeEntries) {
        existingEntries.push(entry);
      }
    }

    // Add new file
    const blob = await history.blobs.store([encoder.encode(content)]);
    existingEntries.push({ mode: FileMode.REGULAR_FILE, name: fileName, id: blob });

    const tree = await history.trees.store(existingEntries);

    const now = Math.floor(Date.now() / 1000);
    const author = {
      name: roomManager?.getLocalIdentity() ?? "User",
      email: "demo@example.com",
      timestamp: now,
      tzOffset: "+0000",
    };

    const commitId = await history.commits.store({
      tree,
      parents: [mainRef.objectId],
      author,
      committer: author,
      message: `Add ${fileName}`,
    });
    await history.refs.set("refs/heads/main", commitId);

    log(`Added ${fileName}: ${commitId.slice(0, 7)}`, "success");
    await refreshUI();
  } catch (error) {
    log(`Add file failed: ${error instanceof Error ? error.message : String(error)}`, "error");
  }
}

async function handleSync(identity: string): Promise<void> {
  if (!history || !serialization) return;

  const port = participantPorts.get(identity);
  if (!port) {
    log(`No connection to ${identity}`, "error");
    return;
  }

  log(`Starting sync with ${identity}...`);

  const session = createGitPeerSession({
    port,
    history,
    serialization,
    log: (msg) => log(`[sync:${identity}] ${msg}`),
  });

  // Remember local main before fetch
  const localMainBefore = await history.refs.resolve("refs/heads/main");

  // Fetch from peer → refs/remotes/peer/*
  const fetchResult = await session.fetch();
  if (fetchResult.ok && fetchResult.objectsReceived > 0) {
    log(`Fetched ${fetchResult.objectsReceived} objects from ${identity}`, "success");
  } else if (fetchResult.ok) {
    log(`Already up to date with ${identity}`);
  } else {
    log(`Fetch failed: ${fetchResult.error}`, "error");
  }

  // Merge fetched refs into local main (fast-forward or create merge commit)
  if (fetchResult.ok) {
    const remotePeerMain = fetchResult.refs.get("refs/remotes/peer/main");
    if (remotePeerMain) {
      if (!localMainBefore?.objectId) {
        // No local commits — fast-forward to remote
        await history.refs.set("refs/heads/main", remotePeerMain);
        log(`Fast-forwarded main to ${remotePeerMain.slice(0, 7)}`, "success");
      } else if (localMainBefore.objectId !== remotePeerMain) {
        // Check if remote is ancestor of local (already up to date)
        const isRemoteAncestor = await isAncestorOf(
          history,
          remotePeerMain,
          localMainBefore.objectId,
        );
        if (isRemoteAncestor) {
          log("Remote is already included in local history");
        } else {
          // Check if local is ancestor of remote (can fast-forward)
          const isLocalAncestor = await isAncestorOf(
            history,
            localMainBefore.objectId,
            remotePeerMain,
          );
          if (isLocalAncestor) {
            await history.refs.set("refs/heads/main", remotePeerMain);
            log(`Fast-forwarded main to ${remotePeerMain.slice(0, 7)}`, "success");
          } else {
            // Diverged — create a merge commit combining both trees
            const mergeCommitId = await createMergeCommit(
              history,
              localMainBefore.objectId,
              remotePeerMain,
              identity,
            );
            if (mergeCommitId) {
              await history.refs.set("refs/heads/main", mergeCommitId);
              log(`Merged remote into main: ${mergeCommitId.slice(0, 7)}`, "success");
            }
          }
        }
      }
    }
  }

  // Push to peer
  const pushResult = await session.push();
  if (pushResult.ok) {
    log(`Pushed to ${identity}`, "success");
  } else {
    log(`Push failed: ${pushResult.error}`, "error");
  }

  await refreshUI();
}

/**
 * Check if `ancestor` is an ancestor of `descendant` by walking parents.
 */
async function isAncestorOf(
  h: History,
  ancestor: string,
  descendant: string,
): Promise<boolean> {
  const visited = new Set<string>();
  const queue = [descendant];

  while (queue.length > 0) {
    const oid = queue.shift();
    if (!oid) continue;
    if (oid === ancestor) return true;
    if (visited.has(oid)) continue;
    visited.add(oid);

    const commit = await h.commits.load(oid);
    if (commit) {
      for (const parent of commit.parents) {
        queue.push(parent);
      }
    }
  }
  return false;
}

/**
 * Create a simple merge commit that takes the remote tree
 * (picks the "newer" side for simplicity in the demo).
 */
async function createMergeCommit(
  h: History,
  localOid: string,
  remoteOid: string,
  peerIdentity: string,
): Promise<string | null> {
  try {
    // Use the remote tree as the merge result (simple "theirs" strategy for the demo)
    const remoteCommit = await h.commits.load(remoteOid);
    if (!remoteCommit) return null;

    const now = Math.floor(Date.now() / 1000);
    const author = {
      name: roomManager?.getLocalIdentity() ?? "User",
      email: "demo@example.com",
      timestamp: now,
      tzOffset: "+0000",
    };

    return await h.commits.store({
      tree: remoteCommit.tree,
      parents: [localOid, remoteOid],
      author,
      committer: author,
      message: `Merge from ${peerIdentity}`,
    });
  } catch (error) {
    log(`Merge failed: ${error instanceof Error ? error.message : String(error)}`, "error");
    return null;
  }
}

// --- UI Updates ---

function updateConnectionStatus(state: "disconnected" | "connecting" | "connected"): void {
  const el = document.getElementById("connection-status");
  if (!el) return;
  el.className = `status status-${state}`;
  el.textContent = state.charAt(0).toUpperCase() + state.slice(1);
}

function updateButtons(): void {
  const connected = roomManager?.isConnected() ?? false;
  const hasCommits = history !== null;

  (document.getElementById("btn-connect") as HTMLButtonElement).disabled = connected;
  (document.getElementById("btn-disconnect") as HTMLButtonElement).disabled = !connected;
  (document.getElementById("btn-add-file") as HTMLButtonElement).disabled = !hasCommits;
}

function updatePeerList(): void {
  const list = document.getElementById("peer-list");
  if (!list) return;

  const participants = roomManager?.getParticipants() ?? [];

  if (participants.length === 0) {
    list.innerHTML = '<li class="empty">No participants yet</li>';
    return;
  }

  list.innerHTML = "";
  for (const p of participants) {
    const li = document.createElement("li");
    li.innerHTML = `
      <span><span class="peer-dot"></span>${p.identity}</span>
      <button class="secondary" data-sync="${p.identity}">Sync</button>
    `;
    list.appendChild(li);
  }

  // Bind sync buttons
  for (const btn of list.querySelectorAll<HTMLButtonElement>("[data-sync]")) {
    btn.addEventListener("click", () => {
      const identity = btn.dataset.sync;
      if (identity) handleSync(identity);
    });
  }
}

async function updateFileList(): Promise<void> {
  const list = document.getElementById("file-list");
  if (!list || !history) {
    if (list) list.innerHTML = '<li class="empty">Repository not initialized</li>';
    return;
  }

  const mainRef = await history.refs.resolve("refs/heads/main");
  if (!mainRef?.objectId) {
    list.innerHTML = '<li class="empty">No commits yet</li>';
    return;
  }

  const commit = await history.commits.load(mainRef.objectId);
  if (!commit) return;

  list.innerHTML = "";
  const entries = await history.trees.load(commit.tree);
  if (entries) {
    for await (const entry of entries) {
      const li = document.createElement("li");
      li.textContent = entry.name;
      list.appendChild(li);
    }
  }
}

async function updateCommitList(): Promise<void> {
  const list = document.getElementById("commit-list");
  if (!list || !history) return;

  const mainRef = await history.refs.resolve("refs/heads/main");
  if (!mainRef?.objectId) {
    list.innerHTML = '<li class="empty">No commits</li>';
    return;
  }

  list.innerHTML = "";
  let oid: string | undefined = mainRef.objectId;
  let count = 0;

  while (oid && count < 20) {
    const commit = await history.commits.load(oid);
    if (!commit) break;

    const li = document.createElement("li");
    const time = new Date(commit.author.timestamp * 1000).toLocaleTimeString();
    li.innerHTML = `
      <span class="commit-hash">${oid.slice(0, 7)}</span>
      <span class="commit-msg">${commit.message}</span>
      <span class="commit-time">${commit.author.name} at ${time}</span>
    `;
    list.appendChild(li);

    oid = commit.parents[0];
    count++;
  }
}

async function refreshUI(): Promise<void> {
  updateButtons();
  try {
    await updateFileList();
  } catch (error) {
    log(`File list update error: ${error instanceof Error ? error.message : String(error)}`, "error");
  }
  try {
    await updateCommitList();
  } catch (error) {
    log(`Commit list update error: ${error instanceof Error ? error.message : String(error)}`, "error");
  }
}

// --- Bootstrap ---

async function initializeApp(): Promise<void> {
  await initializeGit();

  // Wire up buttons
  document.getElementById("btn-connect")?.addEventListener("click", connectToRoom);
  document.getElementById("btn-disconnect")?.addEventListener("click", disconnectFromRoom);
  document.getElementById("btn-init")?.addEventListener("click", handleInit);
  document.getElementById("btn-add-file")?.addEventListener("click", handleAddFile);

  // Generate a random identity
  const identityInput = document.getElementById("lk-identity") as HTMLInputElement;
  if (identityInput && !identityInput.value) {
    identityInput.value = `user-${Math.random().toString(36).slice(2, 6)}`;
  }

  updateButtons();
  log("Application started. Run `livekit-server --dev` then click Connect.");
  log("Open this page in two browser tabs to test sync.");
}

if (document.readyState === "loading") {
  document.addEventListener("DOMContentLoaded", () => initializeApp());
} else {
  initializeApp();
}
