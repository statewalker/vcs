/**
 * Storage View
 *
 * Renders the storage selection UI (Open Folder / Memory Storage buttons).
 */

import type { AppContext } from "../controllers/index.js";
import {
  createSampleFiles,
  initOrOpenRepository,
  isFileSystemAccessSupported,
  openFolder,
  useMemoryStorage,
} from "../controllers/index.js";
import { getRepositoryModel } from "../models/index.js";
import { newRegistry } from "../utils/index.js";

/**
 * Create the storage view.
 * Returns cleanup function.
 */
export function createStorageView(ctx: AppContext, container: HTMLElement): () => void {
  const [register, cleanup] = newRegistry();
  const repoModel = getRepositoryModel(ctx);

  // Create UI elements
  container.innerHTML = `
    <div class="storage-controls">
      <div class="controls">
        <button id="btn-open-folder" class="primary">Open Folder</button>
        <button id="btn-memory" class="secondary">Memory Storage</button>
      </div>
      <div class="storage-status">
        <span id="storage-status-text">No storage selected</span>
      </div>
      <div class="repo-controls" style="display: none;">
        <button id="btn-init-repo">Initialize Repository</button>
        <button id="btn-create-samples" style="display: none;">Create Sample Files</button>
      </div>
    </div>
  `;

  const openFolderBtn = container.querySelector("#btn-open-folder") as HTMLButtonElement;
  const memoryBtn = container.querySelector("#btn-memory") as HTMLButtonElement;
  const statusText = container.querySelector("#storage-status-text") as HTMLElement;
  const repoControls = container.querySelector(".repo-controls") as HTMLElement;
  const initRepoBtn = container.querySelector("#btn-init-repo") as HTMLButtonElement;
  const createSamplesBtn = container.querySelector("#btn-create-samples") as HTMLButtonElement;

  // Disable folder button if API not supported
  if (!isFileSystemAccessSupported()) {
    openFolderBtn.disabled = true;
    openFolderBtn.title = "File System Access API not supported";
  }

  // Event handlers
  openFolderBtn.addEventListener("click", async () => {
    openFolderBtn.disabled = true;
    try {
      const backend = await openFolder(ctx);
      if (backend) {
        // Automatically initialize/open repository after folder selection
        await initOrOpenRepository(ctx);
      }
    } finally {
      openFolderBtn.disabled = !isFileSystemAccessSupported();
    }
  });

  memoryBtn.addEventListener("click", async () => {
    await useMemoryStorage(ctx);
    // Automatically initialize repository for memory storage
    await initOrOpenRepository(ctx);
  });

  initRepoBtn.addEventListener("click", async () => {
    initRepoBtn.disabled = true;
    try {
      const success = await initOrOpenRepository(ctx);
      if (success && repoModel.status === "ready") {
        createSamplesBtn.style.display = "inline-block";
      }
    } finally {
      initRepoBtn.disabled = false;
    }
  });

  createSamplesBtn.addEventListener("click", async () => {
    createSamplesBtn.disabled = true;
    try {
      await createSampleFiles(ctx);
    } finally {
      createSamplesBtn.disabled = false;
    }
  });

  // Render function
  function render(): void {
    const status = repoModel.status;
    const folder = repoModel.folderName;
    const branch = repoModel.branchName;

    // Update status text
    switch (status) {
      case "no-storage":
        statusText.textContent = "No storage selected";
        repoControls.style.display = "none";
        break;
      case "no-repository":
        statusText.textContent = `Storage: ${folder} (no repository)`;
        repoControls.style.display = "block";
        initRepoBtn.textContent = "Initialize Repository";
        initRepoBtn.disabled = false;
        createSamplesBtn.style.display = "none";
        break;
      case "ready":
        statusText.textContent = `${folder} - ${branch} @ ${repoModel.headCommit?.slice(0, 7) || "no commits"}`;
        repoControls.style.display = "block";
        initRepoBtn.textContent = "Repository Ready";
        initRepoBtn.disabled = true;
        createSamplesBtn.style.display = "inline-block";
        break;
      case "error":
        statusText.textContent = `Error: ${repoModel.errorMessage}`;
        repoControls.style.display = "none";
        break;
    }
  }

  // Subscribe to model updates
  register(repoModel.onUpdate(render));

  // Initial render
  render();

  return cleanup;
}
