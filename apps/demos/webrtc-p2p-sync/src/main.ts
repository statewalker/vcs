/**
 * WebRTC P2P Git Sync Demo
 *
 * Demonstrates peer-to-peer repository synchronization using WebRTC
 * data channels with manual QR code-style signaling.
 */

import { MemoryRefStore } from "@statewalker/vcs-core";
import { createMemoryObjectStores, type MemoryObjectStores } from "@statewalker/vcs-store-mem";
import {
  createWebRtcStream,
  PeerManager,
  QrSignaling,
  type SignalingMessage,
} from "@statewalker/vcs-transport-webrtc";

/**
 * Simple in-memory Git store combining object stores and refs.
 */
interface GitStore extends MemoryObjectStores {
  refs: MemoryRefStore;
}

// UI Elements
const statusA = document.getElementById("status-a")!;
const statusB = document.getElementById("status-b")!;
const filesA = document.getElementById("files-a")!;
const filesB = document.getElementById("files-b")!;
const logA = document.getElementById("log-a")!;
const logB = document.getElementById("log-b")!;
const signalOutA = document.getElementById("signal-out-a") as HTMLTextAreaElement;
const signalOutB = document.getElementById("signal-out-b") as HTMLTextAreaElement;
const signalInA = document.getElementById("signal-in-a") as HTMLTextAreaElement;
const signalInB = document.getElementById("signal-in-b") as HTMLTextAreaElement;

const initABtn = document.getElementById("init-a") as HTMLButtonElement;
const initBBtn = document.getElementById("init-b") as HTMLButtonElement;
const addFileABtn = document.getElementById("add-file-a") as HTMLButtonElement;
const createOfferBtn = document.getElementById("create-offer") as HTMLButtonElement;
const acceptOfferBtn = document.getElementById("accept-offer") as HTMLButtonElement;
const acceptAnswerBtn = document.getElementById("accept-answer") as HTMLButtonElement;
const syncABtn = document.getElementById("sync-a") as HTMLButtonElement;
const syncBBtn = document.getElementById("sync-b") as HTMLButtonElement;

// State
let storeA: GitStore | null = null;
let storeB: GitStore | null = null;
let peerA: PeerManager | null = null;
let peerB: PeerManager | null = null;
let signalingA: QrSignaling | null = null;
let signalingB: QrSignaling | null = null;
let channelA: RTCDataChannel | null = null;
let channelB: RTCDataChannel | null = null;
let fileCounter = 1;

// Logging
function logTo(element: HTMLElement, message: string): void {
  const timestamp = new Date().toLocaleTimeString();
  element.textContent += `[${timestamp}] ${message}\n`;
  element.scrollTop = element.scrollHeight;
}

function logPeerA(message: string): void {
  logTo(logA, message);
}

function logPeerB(message: string): void {
  logTo(logB, message);
}

// Status updates
function setStatus(
  element: HTMLElement,
  status: "connected" | "disconnected" | "connecting",
): void {
  element.className = `status ${status}`;
  element.textContent = status.charAt(0).toUpperCase() + status.slice(1);
}

// Helper to create a GitStore
function createGitStore(): GitStore {
  const stores = createMemoryObjectStores();
  return {
    ...stores,
    refs: new MemoryRefStore(),
  };
}

// Repository functions
async function initRepo(
  store: GitStore,
  _label: string,
  logFn: (msg: string) => void,
): Promise<void> {
  // Create initial commit
  const encoder = new TextEncoder();

  // Store a blob
  const content = encoder.encode("# My Repository\n\nInitialized via WebRTC P2P sync demo.\n");
  const blobId = await store.blobs.store([content]);

  // Create tree
  const treeId = await store.trees.storeTree([{ name: "README.md", mode: 0o100644, id: blobId }]);

  // Create commit
  const now = Math.floor(Date.now() / 1000);
  const commitId = await store.commits.storeCommit({
    tree: treeId,
    parents: [],
    message: "Initial commit",
    author: {
      name: "Demo User",
      email: "demo@example.com",
      timestamp: now,
      tzOffset: "+0000",
    },
    committer: {
      name: "Demo User",
      email: "demo@example.com",
      timestamp: now,
      tzOffset: "+0000",
    },
  });

  // Set HEAD (symbolic ref pointing to main branch)
  await store.refs.setSymbolic("HEAD", "refs/heads/main");
  await store.refs.set("refs/heads/main", commitId);

  logFn(`Repository initialized with commit ${commitId.slice(0, 8)}`);
}

async function addFile(
  store: GitStore,
  name: string,
  content: string,
  logFn: (msg: string) => void,
): Promise<void> {
  const encoder = new TextEncoder();

  // Get current HEAD
  const headRef = await store.refs.get("refs/heads/main");
  if (!headRef || !("objectId" in headRef)) {
    logFn("Error: No HEAD commit");
    return;
  }
  const head = headRef.objectId;

  // Load current tree
  const commit = await store.commits.loadCommit(head);
  const currentEntries: Array<{ name: string; mode: number; id: string }> = [];
  for await (const entry of store.trees.loadTree(commit.tree)) {
    currentEntries.push({ name: entry.name, mode: entry.mode, id: entry.id });
  }

  // Add new file
  const blobId = await store.blobs.store([encoder.encode(content)]);
  currentEntries.push({ name, mode: 0o100644, id: blobId });

  // Create new tree
  const treeId = await store.trees.storeTree(currentEntries);

  // Create commit
  const now = Math.floor(Date.now() / 1000);
  const commitId = await store.commits.storeCommit({
    tree: treeId,
    parents: [head],
    message: `Add ${name}`,
    author: {
      name: "Demo User",
      email: "demo@example.com",
      timestamp: now,
      tzOffset: "+0000",
    },
    committer: {
      name: "Demo User",
      email: "demo@example.com",
      timestamp: now,
      tzOffset: "+0000",
    },
  });

  // Update ref
  await store.refs.set("refs/heads/main", commitId);

  logFn(`Added ${name} in commit ${commitId.slice(0, 8)}`);
}

async function listFiles(store: GitStore): Promise<string[]> {
  const headRef = await store.refs.get("refs/heads/main");
  if (!headRef || !("objectId" in headRef)) return [];

  const commit = await store.commits.loadCommit(headRef.objectId);
  const files: string[] = [];

  for await (const entry of store.trees.loadTree(commit.tree)) {
    files.push(entry.name);
  }

  return files;
}

async function updateFileList(store: GitStore | null, element: HTMLElement): Promise<void> {
  if (!store) {
    element.innerHTML = "No repository";
    return;
  }

  const files = await listFiles(store);
  if (files.length === 0) {
    element.innerHTML = "Empty repository";
    return;
  }

  element.innerHTML = files.map((f) => `<div class="file-item">${f}</div>`).join("");
}

// Peer A: Initialize
initABtn.onclick = async () => {
  storeA = createGitStore();
  await initRepo(storeA, "A", logPeerA);
  await updateFileList(storeA, filesA);
  initABtn.disabled = true;
  addFileABtn.disabled = false;
  logPeerA("Repository ready");
};

// Peer A: Add file
addFileABtn.onclick = async () => {
  if (!storeA) return;

  const filename = `file-${fileCounter++}.txt`;
  const content = `File content created at ${new Date().toISOString()}\n`;
  await addFile(storeA, filename, content, logPeerA);
  await updateFileList(storeA, filesA);
};
addFileABtn.disabled = true;

// Peer B: Initialize
initBBtn.onclick = async () => {
  storeB = createGitStore();
  await initRepo(storeB, "B", logPeerB);
  await updateFileList(storeB, filesB);
  initBBtn.disabled = true;
  logPeerB("Repository ready");
};

// Peer A: Create offer
createOfferBtn.onclick = async () => {
  logPeerA("Creating offer...");
  setStatus(statusA, "connecting");

  // Create signaling helper
  signalingA = new QrSignaling();

  // Create peer manager
  peerA = new PeerManager("initiator");

  // Collect signals
  const signals: SignalingMessage[] = [];
  peerA.on("signal", (msg) => {
    signals.push(msg);
  });

  peerA.on("stateChange", (state) => {
    logPeerA(`Connection state: ${state}`);
    if (state === "connected") {
      setStatus(statusA, "connected");
      syncABtn.disabled = false;
    } else if (state === "failed" || state === "closed") {
      setStatus(statusA, "disconnected");
    }
  });

  peerA.on("open", () => {
    logPeerA("Data channel opened!");
    channelA = peerA?.getDataChannel();
  });

  peerA.on("error", (err) => {
    logPeerA(`Error: ${err.message}`);
  });

  // Start connection
  await peerA.connect();

  // Wait for ICE gathering
  logPeerA("Gathering ICE candidates...");
  await peerA.waitForIceGathering();

  // Create compact signal
  const description = peerA.getLocalDescription()!;
  const candidates = peerA.getCollectedCandidates();
  const payload = signalingA.createPayload("initiator", description, candidates);

  signalOutA.value = payload;
  logPeerA(`Offer created (${payload.length} chars)`);
  logPeerA("Copy the signal above and paste it into Peer B");

  createOfferBtn.disabled = true;
  acceptAnswerBtn.disabled = false;
};

// Enable accept-offer when signal is pasted
signalInB.oninput = () => {
  acceptOfferBtn.disabled = signalInB.value.trim().length === 0;
};

// Peer B: Accept offer
acceptOfferBtn.onclick = async () => {
  const payload = signalInB.value.trim();
  if (!payload) return;

  logPeerB("Accepting offer...");
  setStatus(statusB, "connecting");

  // Create signaling helper with same session ID
  signalingB = new QrSignaling();

  // Parse the offer
  const { description, candidates } = signalingB.parsePayload(payload);

  // Create peer manager as responder
  peerB = new PeerManager("responder");

  // Collect signals
  const signals: SignalingMessage[] = [];
  peerB.on("signal", (msg) => {
    signals.push(msg);
  });

  peerB.on("stateChange", (state) => {
    logPeerB(`Connection state: ${state}`);
    if (state === "connected") {
      setStatus(statusB, "connected");
      syncBBtn.disabled = false;
    } else if (state === "failed" || state === "closed") {
      setStatus(statusB, "disconnected");
    }
  });

  peerB.on("open", () => {
    logPeerB("Data channel opened!");
    channelB = peerB?.getDataChannel();
  });

  peerB.on("error", (err) => {
    logPeerB(`Error: ${err.message}`);
  });

  // Handle the offer
  await peerB.handleSignal({ type: "offer", sdp: description.sdp });

  // Add ICE candidates
  for (const candidate of candidates) {
    await peerB.handleSignal({ type: "candidate", candidate });
  }

  // Wait for ICE gathering
  logPeerB("Gathering ICE candidates...");
  await peerB.waitForIceGathering();

  // Create answer
  const answerDescription = peerB.getLocalDescription()!;
  const answerCandidates = peerB.getCollectedCandidates();
  const answerPayload = signalingB.createPayload("responder", answerDescription, answerCandidates);

  signalOutB.value = answerPayload;
  logPeerB(`Answer created (${answerPayload.length} chars)`);
  logPeerB("Copy the signal above and paste it into Peer A");

  acceptOfferBtn.disabled = true;
};

// Enable accept-answer when signal is pasted
signalInA.oninput = () => {
  acceptAnswerBtn.disabled = signalInA.value.trim().length === 0 || !peerA;
};

// Peer A: Accept answer
acceptAnswerBtn.onclick = async () => {
  const payload = signalInA.value.trim();
  if (!payload || !peerA || !signalingA) return;

  logPeerA("Accepting answer...");

  // Parse the answer
  const { description, candidates } = signalingA.parsePayload(payload);

  // Handle the answer
  await peerA.handleSignal({ type: "answer", sdp: description.sdp });

  // Add ICE candidates
  for (const candidate of candidates) {
    await peerA.handleSignal({ type: "candidate", candidate });
  }

  logPeerA("Answer accepted, waiting for connection...");
  acceptAnswerBtn.disabled = true;
};

// Sync functionality (simplified - just demonstrates connection)
syncABtn.onclick = async () => {
  if (!channelA || !storeA) return;

  logPeerA("Starting sync...");

  // Create transport from channel
  const _transport = createWebRtcStream(channelA);

  // For this demo, we'll send a simple message
  // In a real implementation, this would use the Git protocol
  const head = await storeA.refs.get("refs/heads/main");
  const files = await listFiles(storeA);

  const message = JSON.stringify({
    type: "repo-info",
    head,
    files,
  });

  channelA.send(message);
  logPeerA(`Sent repository info: ${files.length} files, HEAD=${head?.slice(0, 8)}`);

  // Note: Full implementation would use Git pack protocol
  logPeerA("Note: Full Git sync would use pack protocol over this channel");
};

syncBBtn.onclick = async () => {
  if (!channelB) return;

  logPeerB("Waiting for sync data...");

  // Listen for messages
  channelB.onmessage = (event) => {
    try {
      const data = JSON.parse(event.data);
      if (data.type === "repo-info") {
        logPeerB(`Received: ${data.files.length} files, HEAD=${data.head?.slice(0, 8)}`);
        logPeerB("Sync data received successfully!");
      }
    } catch {
      logPeerB(`Received: ${event.data}`);
    }
  };

  logPeerB("Listening for sync data from Peer A...");
};

// Initial state
logPeerA("Ready. Initialize a repository and create an offer.");
logPeerB("Ready. Wait for offer from Peer A.");
