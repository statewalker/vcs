/**
 * Versioned Documents Demo
 *
 * Main entry point for the document versioning application.
 */

import {
  type DocumentComponents,
  decomposeDocument,
  formatFileSize,
  getFileCategory,
  reconstructDocument,
} from "./document-decomposer.js";
import { createVersionTracker, type VersionInfo, type VersionTracker } from "./version-tracker.js";

// App state
let tracker: VersionTracker | null = null;
let currentDocument: DocumentComponents | null = null;

// DOM elements
const dropZone = document.getElementById("drop-zone") as HTMLElement;
const fileInput = document.getElementById("file-input") as HTMLInputElement;
const btnSelect = document.getElementById("btn-select") as HTMLButtonElement;
const uploadStatus = document.getElementById("upload-status") as HTMLElement;

const documentSection = document.getElementById("document-section") as HTMLElement;
const docName = document.getElementById("doc-name") as HTMLElement;
const docType = document.getElementById("doc-type") as HTMLElement;
const fileTree = document.getElementById("file-tree") as HTMLElement;
const versionMessage = document.getElementById("version-message") as HTMLInputElement;
const btnSaveVersion = document.getElementById("btn-save-version") as HTMLButtonElement;

const historySection = document.getElementById("history-section") as HTMLElement;
const versionList = document.getElementById("version-list") as HTMLElement;

const compareSection = document.getElementById("compare-section") as HTMLElement;
const compareFrom = document.getElementById("compare-from") as HTMLSelectElement;
const compareTo = document.getElementById("compare-to") as HTMLSelectElement;
const btnCompare = document.getElementById("btn-compare") as HTMLButtonElement;
const diffOutput = document.getElementById("diff-output") as HTMLElement;

// Initialize app
async function init() {
  // Initialize version tracker
  tracker = await createVersionTracker();

  // Set up event listeners
  setupDragDrop();
  setupFileInput();
  setupVersionControls();

  showStatus("Ready to accept documents", "info");
}

function setupDragDrop() {
  dropZone.addEventListener("dragover", (e) => {
    e.preventDefault();
    dropZone.classList.add("dragover");
  });

  dropZone.addEventListener("dragleave", () => {
    dropZone.classList.remove("dragover");
  });

  dropZone.addEventListener("drop", async (e) => {
    e.preventDefault();
    dropZone.classList.remove("dragover");

    const files = e.dataTransfer?.files;
    if (files && files.length > 0) {
      await handleFile(files[0]);
    }
  });
}

function setupFileInput() {
  btnSelect.addEventListener("click", () => {
    fileInput.click();
  });

  fileInput.addEventListener("change", async () => {
    const files = fileInput.files;
    if (files && files.length > 0) {
      await handleFile(files[0]);
    }
  });
}

function setupVersionControls() {
  btnSaveVersion.addEventListener("click", async () => {
    await saveCurrentVersion();
  });

  btnCompare.addEventListener("click", async () => {
    await compareVersions();
  });
}

async function handleFile(file: File) {
  try {
    showStatus(`Processing ${file.name}...`, "info");

    // Validate file type
    const ext = file.name.toLowerCase().split(".").pop();
    if (ext !== "docx" && ext !== "odt") {
      showStatus("Please upload a DOCX or ODT file", "error");
      return;
    }

    // Decompose document
    currentDocument = await decomposeDocument(file);

    // Update UI
    docName.textContent = currentDocument.metadata.fileName;
    docType.textContent = currentDocument.metadata.type;

    // Show file tree
    renderFileTree(currentDocument.files);

    // Show document section
    documentSection.style.display = "block";
    historySection.style.display = "block";

    // Save initial version
    versionMessage.value = "Initial upload";
    await saveCurrentVersion();

    showStatus(
      `Loaded ${file.name} (${currentDocument.metadata.fileCount} internal files)`,
      "success",
    );
  } catch (error) {
    showStatus(`Error processing file: ${(error as Error).message}`, "error");
    console.error(error);
  }
}

function renderFileTree(files: Map<string, Uint8Array>) {
  const sortedPaths = Array.from(files.keys()).sort();

  fileTree.innerHTML = sortedPaths
    .map((path) => {
      const size = files.get(path)?.length || 0;
      const category = getFileCategory(path);
      return `<div class="file-tree-item ${category}">${path} (${formatFileSize(size)})</div>`;
    })
    .join("");
}

async function saveCurrentVersion() {
  if (!tracker || !currentDocument) {
    showStatus("No document loaded", "error");
    return;
  }

  const message = versionMessage.value.trim() || "Version update";

  try {
    const versionId = await tracker.saveVersion(currentDocument.files, message);
    showStatus(`Saved version: ${versionId.slice(0, 7)}`, "success");

    // Clear message input
    versionMessage.value = "";

    // Refresh history
    await refreshVersionHistory();
  } catch (error) {
    showStatus(`Error saving version: ${(error as Error).message}`, "error");
    console.error(error);
  }
}

async function refreshVersionHistory() {
  if (!tracker) return;

  const versions = await tracker.listVersions();

  if (versions.length === 0) {
    versionList.innerHTML = '<p class="empty-state">No versions yet</p>';
    compareSection.style.display = "none";
    return;
  }

  // Render version list
  versionList.innerHTML = versions
    .map(
      (v) => `
      <div class="version-item" data-id="${v.id}">
        <div class="version-info">
          <div class="version-message">${escapeHtml(v.message)}</div>
          <div class="version-meta">${formatDate(v.date)}</div>
          <div class="version-id">${v.id.slice(0, 7)}</div>
        </div>
        <div class="version-actions">
          <button class="btn-restore" data-id="${v.id}">Restore</button>
          <button class="btn-download" data-id="${v.id}">Download</button>
        </div>
      </div>
    `,
    )
    .join("");

  // Add event listeners
  versionList.querySelectorAll(".btn-restore").forEach((btn) => {
    btn.addEventListener("click", async () => {
      const id = btn.getAttribute("data-id");
      if (id) await restoreVersion(id);
    });
  });

  versionList.querySelectorAll(".btn-download").forEach((btn) => {
    btn.addEventListener("click", async () => {
      const id = btn.getAttribute("data-id");
      if (id) await downloadVersion(id);
    });
  });

  // Update compare section
  if (versions.length >= 2) {
    compareSection.style.display = "block";
    updateCompareSelects(versions);
  }
}

function updateCompareSelects(versions: VersionInfo[]) {
  const options = versions
    .map((v) => `<option value="${v.id}">${v.message} (${v.id.slice(0, 7)})</option>`)
    .join("");

  compareFrom.innerHTML = options;
  compareTo.innerHTML = options;

  // Default to comparing first two versions
  if (versions.length >= 2) {
    compareFrom.value = versions[1].id;
    compareTo.value = versions[0].id;
  }
}

async function restoreVersion(versionId: string) {
  if (!tracker) return;

  try {
    const components = await tracker.getVersion(versionId);
    currentDocument = {
      files: components,
      metadata: currentDocument?.metadata || {
        type: "docx",
        fileName: "restored-document.docx",
        fileCount: components.size,
      },
    };

    // Update UI
    renderFileTree(components);
    showStatus(`Restored version ${versionId.slice(0, 7)}`, "success");
  } catch (error) {
    showStatus(`Error restoring version: ${(error as Error).message}`, "error");
    console.error(error);
  }
}

async function downloadVersion(versionId: string) {
  if (!tracker || !currentDocument) return;

  try {
    const components = await tracker.getVersion(versionId);
    const blob = await reconstructDocument(components, currentDocument.metadata.fileName);

    // Create download link
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `v${versionId.slice(0, 7)}-${currentDocument.metadata.fileName}`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);

    showStatus(`Downloaded version ${versionId.slice(0, 7)}`, "success");
  } catch (error) {
    showStatus(`Error downloading version: ${(error as Error).message}`, "error");
    console.error(error);
  }
}

async function compareVersions() {
  if (!tracker) return;

  const fromId = compareFrom.value;
  const toId = compareTo.value;

  if (fromId === toId) {
    diffOutput.innerHTML = "<p>Select different versions to compare</p>";
    return;
  }

  try {
    const changes = await tracker.compareVersions(fromId, toId);

    if (changes.length === 0) {
      diffOutput.innerHTML = "<p>No changes between these versions</p>";
      return;
    }

    diffOutput.innerHTML = changes
      .map((change) => {
        const className = `diff-${change.type === "added" ? "added" : change.type === "removed" ? "removed" : ""}`;
        const symbol = change.type === "added" ? "+" : change.type === "removed" ? "-" : "~";
        return `<div class="${className}">${symbol} ${escapeHtml(change.path)}</div>`;
      })
      .join("");
  } catch (error) {
    showStatus(`Error comparing versions: ${(error as Error).message}`, "error");
    console.error(error);
  }
}

function showStatus(message: string, type: "info" | "success" | "error") {
  uploadStatus.textContent = message;
  uploadStatus.className = `status ${type}`;
}

function formatDate(date: Date): string {
  return date.toLocaleString();
}

function escapeHtml(text: string): string {
  const div = document.createElement("div");
  div.textContent = text;
  return div.innerHTML;
}

// Start app
init();
