/**
 * Version Tracker
 *
 * Manages document versions using VCS storage.
 */

import { createGitStore, Git, type GitStore } from "@statewalker/vcs-commands";
import { createGitRepository, FileMode, type GitRepository } from "@statewalker/vcs-core";
import { MemoryStagingStore } from "@statewalker/vcs-store-mem";

/**
 * Version information
 */
export interface VersionInfo {
  id: string;
  message: string;
  date: Date;
  author: string;
}

/**
 * Version tracker for document management
 */
export class VersionTracker {
  private repository: GitRepository | null = null;
  private store: GitStore | null = null;
  private git: Git | null = null;
  private initialized = false;

  /**
   * Initialize the version tracker with a new repository.
   */
  async initialize(): Promise<void> {
    this.repository = await createGitRepository();
    const staging = new MemoryStagingStore();
    this.store = createGitStore({ repository: this.repository, staging });
    this.git = Git.wrap(this.store);
    this.initialized = true;
  }

  /**
   * Check if tracker is initialized.
   */
  isInitialized(): boolean {
    return this.initialized;
  }

  /**
   * Save a new version of the document.
   *
   * @param components Map of file paths to content
   * @param message Version message
   * @returns Version ID (commit hash)
   */
  async saveVersion(components: Map<string, Uint8Array>, message: string): Promise<string> {
    if (!this.store || !this.git) {
      throw new Error("Version tracker not initialized");
    }

    // Build staging from components
    const editor = this.store.staging.editor();

    for (const [path, content] of components) {
      // Store blob
      const blobId = await this.store.blobs.store([content]);

      // Add to staging (flatten paths by replacing / with _)
      const safePath = path.replace(/\//g, "__");
      editor.add({
        path: safePath,
        apply: () => ({
          path: safePath,
          mode: FileMode.REGULAR_FILE,
          objectId: blobId,
          stage: 0,
          size: content.length,
          mtime: Date.now(),
        }),
      });
    }

    await editor.finish();

    // Create commit
    const commit = await this.git.commit().setMessage(message).call();
    const commitId = await this.store.commits.storeCommit(commit);

    return commitId;
  }

  /**
   * Get a specific version's components.
   *
   * @param versionId Commit ID
   * @returns Map of file paths to content
   */
  async getVersion(versionId: string): Promise<Map<string, Uint8Array>> {
    if (!this.store) {
      throw new Error("Version tracker not initialized");
    }

    const commit = await this.store.commits.loadCommit(versionId);
    const components = new Map<string, Uint8Array>();

    for await (const entry of this.store.trees.loadTree(commit.tree)) {
      if (entry.mode !== FileMode.TREE) {
        // Collect blob content
        const chunks: Uint8Array[] = [];
        for await (const chunk of this.store.blobs.load(entry.id)) {
          chunks.push(chunk);
        }

        // Combine chunks
        const totalLength = chunks.reduce((sum, c) => sum + c.length, 0);
        const content = new Uint8Array(totalLength);
        let offset = 0;
        for (const chunk of chunks) {
          content.set(chunk, offset);
          offset += chunk.length;
        }

        // Restore original path
        const originalPath = entry.name.replace(/__/g, "/");
        components.set(originalPath, content);
      }
    }

    return components;
  }

  /**
   * List all versions.
   *
   * @returns Array of version info
   */
  async listVersions(): Promise<VersionInfo[]> {
    if (!this.store) {
      throw new Error("Version tracker not initialized");
    }

    const versions: VersionInfo[] = [];

    // Get HEAD
    const head = await this.store.refs.resolve("HEAD");
    if (!head?.objectId) {
      return versions;
    }

    // Walk ancestry
    for await (const id of this.store.commits.walkAncestry(head.objectId)) {
      const commit = await this.store.commits.loadCommit(id);
      versions.push({
        id,
        message: commit.message.trim(),
        date: new Date(commit.author.timestamp * 1000),
        author: commit.author.name,
      });
    }

    return versions;
  }

  /**
   * Get the latest version ID.
   */
  async getLatestVersionId(): Promise<string | undefined> {
    if (!this.store) {
      return undefined;
    }

    const head = await this.store.refs.resolve("HEAD");
    return head?.objectId;
  }

  /**
   * Compare two versions.
   *
   * @param fromId Source version ID
   * @param toId Target version ID
   * @returns List of changed files
   */
  async compareVersions(
    fromId: string,
    toId: string,
  ): Promise<Array<{ path: string; type: "added" | "removed" | "modified" }>> {
    if (!this.git) {
      throw new Error("Version tracker not initialized");
    }

    const diff = await this.git.diff().setOldTree(fromId).setNewTree(toId).call();

    return diff.map((entry) => ({
      path: (entry.newPath || entry.oldPath || "").replace(/__/g, "/"),
      type:
        entry.changeType === "ADD"
          ? "added"
          : entry.changeType === "DELETE"
            ? "removed"
            : "modified",
    }));
  }

  /**
   * Get version count.
   */
  async getVersionCount(): Promise<number> {
    const versions = await this.listVersions();
    return versions.length;
  }
}

/**
 * Create a new version tracker instance.
 */
export async function createVersionTracker(): Promise<VersionTracker> {
  const tracker = new VersionTracker();
  await tracker.initialize();
  return tracker;
}
