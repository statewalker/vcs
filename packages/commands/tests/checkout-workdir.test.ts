/**
 * Tests for CheckoutCommand working directory updates
 *
 * Tests the checkout command's ability to write files to the working
 * directory when a FilesApi and workTreeRoot are configured.
 *
 * Reference: Issue webrun-vcs-djl5
 */

import {
  createFileTreeIterator,
  createInMemoryFilesApi,
  type FilesApi,
} from "@statewalker/vcs-core";
import {
  createMemoryObjectStores,
  MemoryRefStore,
  MemoryStagingStore,
} from "@statewalker/vcs-store-mem";
import { describe, expect, it } from "vitest";

import { CheckoutStatus } from "../src/commands/checkout-command.js";
import { Git, type GitStore, type GitStoreWithFiles } from "../src/index.js";
import { addFile, testAuthor } from "./test-helper.js";

/**
 * Read file content from FilesApi as string.
 */
async function readFileContent(files: FilesApi, path: string): Promise<string> {
  const chunks: Uint8Array[] = [];
  for await (const chunk of files.read(path)) {
    chunks.push(chunk);
  }
  const totalLength = chunks.reduce((sum, chunk) => sum + chunk.length, 0);
  const result = new Uint8Array(totalLength);
  let offset = 0;
  for (const chunk of chunks) {
    result.set(chunk, offset);
    offset += chunk.length;
  }
  return new TextDecoder().decode(result);
}

/**
 * Check if a file exists in FilesApi.
 */
async function fileExists(files: FilesApi, path: string): Promise<boolean> {
  try {
    const stats = await files.stats(path);
    return stats !== undefined;
  } catch {
    return false;
  }
}

/**
 * Create a GitStore with files and workTreeRoot for working directory tests.
 */
function createStoreWithFiles(files: FilesApi, workTreeRoot: string): GitStoreWithFiles {
  const stores = createMemoryObjectStores();
  const staging = new MemoryStagingStore();
  const worktree = createFileTreeIterator({
    files,
    rootPath: workTreeRoot,
    gitDir: ".git",
  });

  return {
    blobs: stores.blobs,
    trees: stores.trees,
    commits: stores.commits,
    refs: new MemoryRefStore(),
    staging,
    tags: stores.tags,
    worktree,
    files,
    workTreeRoot,
  };
}

/**
 * Create a bare GitStore (no files or workTreeRoot).
 */
function createBareStore(): GitStore {
  const stores = createMemoryObjectStores();
  return {
    blobs: stores.blobs,
    trees: stores.trees,
    commits: stores.commits,
    refs: new MemoryRefStore(),
    staging: new MemoryStagingStore(),
    tags: stores.tags,
  };
}

/**
 * Initialize a store with an empty initial commit and set up HEAD.
 */
async function initializeStore(store: GitStore): Promise<string> {
  // Create and store empty tree
  const emptyTreeId = await store.trees.storeTree([]);

  // Create initial commit
  const initialCommit = {
    tree: emptyTreeId,
    parents: [],
    author: testAuthor(),
    committer: testAuthor(),
    message: "Initial commit",
  };

  const initialCommitId = await store.commits.storeCommit(initialCommit);

  // Set up refs
  await store.refs.set("refs/heads/main", initialCommitId);
  await store.refs.setSymbolic("HEAD", "refs/heads/main");

  // Initialize staging with empty tree
  await store.staging.readTree(store.trees, emptyTreeId);

  return initialCommitId;
}

describe("CheckoutCommand working directory updates", () => {
  describe("checkout writes files to working directory", () => {
    it("should write files to working directory on checkout", async () => {
      // Create in-memory filesystem
      const files = createInMemoryFilesApi();
      const store = createStoreWithFiles(files, "");
      const git = Git.wrap(store);

      // Initialize repository
      await initializeStore(store);

      // Create initial commit with files
      await addFile(store, "file1.txt", "content1");
      await addFile(store, "file2.txt", "content2");
      await git.commit().setMessage("Add files").call();

      // Create a new branch
      await git.branchCreate().setName("feature").call();

      // Switch to feature branch and modify
      await git.checkout().setName("feature").call();
      await addFile(store, "file1.txt", "modified content");
      await git.commit().setMessage("Modify file1").call();

      // Switch back to main (force to bypass conflict detection since staging changed)
      const result = await git.checkout().setName("main").setForced(true).call();

      expect(result.status).toBe(CheckoutStatus.OK);

      // Verify files exist in working directory
      expect(await fileExists(files, "file1.txt")).toBe(true);
      expect(await fileExists(files, "file2.txt")).toBe(true);

      // Verify file content is main's version
      const content1 = await readFileContent(files, "file1.txt");
      expect(content1).toBe("content1");
    });
  });

  describe("checkout updates modified files", () => {
    it("should update file content when checking out different commit", async () => {
      // Create in-memory filesystem
      const files = createInMemoryFilesApi();
      const store = createStoreWithFiles(files, "");
      const git = Git.wrap(store);

      // Initialize repository
      await initializeStore(store);

      // Create commit with file content "v1"
      await addFile(store, "version.txt", "v1");
      const commit1 = await git.commit().setMessage("Version 1").call();

      // Create commit with file content "v2"
      await addFile(store, "version.txt", "v2");
      await git.commit().setMessage("Version 2").call();

      // Checkout the first commit (detached HEAD) - force to bypass conflict detection
      const result = await git.checkout().setName(commit1.id).setForced(true).call();

      expect(result.status).toBe(CheckoutStatus.OK);

      // Verify file content is "v1"
      const content = await readFileContent(files, "version.txt");
      expect(content).toBe("v1");
    });

    it("should update file when switching between branches", async () => {
      // Create in-memory filesystem
      const files = createInMemoryFilesApi();
      const store = createStoreWithFiles(files, "");
      const git = Git.wrap(store);

      // Initialize repository
      await initializeStore(store);

      // Create initial commit on main with file
      await addFile(store, "data.txt", "main-data");
      await git.commit().setMessage("Main commit").call();

      // Create and checkout feature branch
      await git.checkout().setCreateBranch(true).setName("feature").call();

      // Modify file on feature branch
      await addFile(store, "data.txt", "feature-data");
      await git.commit().setMessage("Feature commit").call();

      // Checkout main branch (force to bypass conflict detection)
      const result = await git.checkout().setName("main").setForced(true).call();

      expect(result.status).toBe(CheckoutStatus.OK);

      // Verify file content is now main's version
      const content = await readFileContent(files, "data.txt");
      expect(content).toBe("main-data");
    });
  });

  describe("checkout creates nested directories", () => {
    it("should create nested directory structure when checking out", async () => {
      // Create in-memory filesystem
      const files = createInMemoryFilesApi();
      const store = createStoreWithFiles(files, "");
      const git = Git.wrap(store);

      // Initialize repository
      await initializeStore(store);

      // Create commit with nested path "a/b/c/file.txt"
      await addFile(store, "a/b/c/file.txt", "nested content");
      await git.commit().setMessage("Add nested file").call();

      // Create and checkout a new branch (to force checkout back)
      await git.checkout().setCreateBranch(true).setName("empty").call();

      // Clear the file by removing it from staging (simulate empty branch)
      const builder = store.staging.builder();
      await builder.finish();
      await git.commit().setMessage("Empty commit").setAllowEmpty(true).call();

      // Checkout main to restore the nested file (force to bypass conflict detection)
      const result = await git.checkout().setName("main").setForced(true).call();

      expect(result.status).toBe(CheckoutStatus.OK);

      // Verify nested path exists in working directory
      expect(await fileExists(files, "a/b/c/file.txt")).toBe(true);

      // Verify content
      const content = await readFileContent(files, "a/b/c/file.txt");
      expect(content).toBe("nested content");
    });

    it("should handle deeply nested paths", async () => {
      // Create in-memory filesystem
      const files = createInMemoryFilesApi();
      const store = createStoreWithFiles(files, "");
      const git = Git.wrap(store);

      // Initialize repository
      await initializeStore(store);

      // Create commit with deep nested paths
      await addFile(store, "src/components/ui/button/index.ts", "export const Button = () => {};");
      await addFile(store, "src/utils/helpers/format.ts", "export function format() {}");
      await git.commit().setMessage("Add source files").call();

      // Create feature branch and switch back
      await git.checkout().setCreateBranch(true).setName("feature").call();
      await git.checkout().setName("main").call();

      // Verify all nested files exist
      expect(await fileExists(files, "src/components/ui/button/index.ts")).toBe(true);
      expect(await fileExists(files, "src/utils/helpers/format.ts")).toBe(true);

      // Verify contents
      const buttonContent = await readFileContent(files, "src/components/ui/button/index.ts");
      expect(buttonContent).toBe("export const Button = () => {};");
    });
  });

  describe("checkout skips workdir for bare repos", () => {
    it("should update HEAD and staging for bare repos without file errors", async () => {
      // Create a bare store (no files/workTreeRoot)
      const store = createBareStore();
      const git = Git.wrap(store);

      // Initialize repository
      await initializeStore(store);

      // Create initial commit with file
      await addFile(store, "test.txt", "content");
      await git.commit().setMessage("Initial content").call();

      // Create feature branch
      await git.branchCreate().setName("feature").call();

      // Checkout feature branch
      await git.checkout().setName("feature").call();

      // Modify file on feature branch
      await addFile(store, "test.txt", "feature content");
      await git.commit().setMessage("Feature change").call();

      // Checkout main branch - should not throw even without files/workTreeRoot
      const result = await git.checkout().setName("main").call();

      expect(result.status).toBe(CheckoutStatus.OK);

      // Verify HEAD updated to main
      const headRaw = await store.refs.get("HEAD");
      expect(headRaw).toBeDefined();
      if (headRaw && "target" in headRaw) {
        expect(headRaw.target).toBe("refs/heads/main");
      }

      // Verify staging updated to main's content
      const entry = await store.staging.getEntry("test.txt");
      expect(entry).toBeDefined();

      // Load blob content to verify staging has correct version
      const chunks: Uint8Array[] = [];
      for await (const chunk of store.blobs.load(entry?.objectId ?? "")) {
        chunks.push(chunk);
      }
      const totalLength = chunks.reduce((sum, chunk) => sum + chunk.length, 0);
      const content = new Uint8Array(totalLength);
      let offset = 0;
      for (const chunk of chunks) {
        content.set(chunk, offset);
        offset += chunk.length;
      }
      const text = new TextDecoder().decode(content);
      expect(text).toBe("content");
    });

    it("should not attempt file writes when files is undefined", async () => {
      // Create a bare store
      const store = createBareStore();
      const git = Git.wrap(store);

      // Verify store doesn't have files property
      expect((store as GitStoreWithFiles).files).toBeUndefined();
      expect((store as GitStoreWithFiles).workTreeRoot).toBeUndefined();

      // Initialize repository
      await initializeStore(store);

      // Create commits on two branches
      await addFile(store, "file.txt", "main content");
      await git.commit().setMessage("Main commit").call();

      await git.checkout().setCreateBranch(true).setName("other").call();
      await addFile(store, "file.txt", "other content");
      await git.commit().setMessage("Other commit").call();

      // Checkout should complete without throwing
      const result = await git.checkout().setName("main").call();

      // Checkout should succeed
      expect(result.status).toBe(CheckoutStatus.OK);
    });

    it("should handle detached HEAD checkout in bare repo", async () => {
      // Create a bare store
      const store = createBareStore();
      const git = Git.wrap(store);

      // Initialize repository
      await initializeStore(store);

      // Create two commits
      await addFile(store, "version.txt", "v1");
      const commit1 = await git.commit().setMessage("Version 1").call();

      await addFile(store, "version.txt", "v2");
      await git.commit().setMessage("Version 2").call();

      // Checkout first commit (detached HEAD) - should not throw
      const result = await git.checkout().setName(commit1.id).call();

      expect(result.status).toBe(CheckoutStatus.OK);

      // Verify HEAD is detached at commit1
      const head = await store.refs.resolve("HEAD");
      expect(head?.objectId).toBe(commit1.id);

      // Verify staging has v1 content
      const entry = await store.staging.getEntry("version.txt");
      expect(entry).toBeDefined();

      const chunks: Uint8Array[] = [];
      for await (const chunk of store.blobs.load(entry?.objectId ?? "")) {
        chunks.push(chunk);
      }
      // Combine chunks into single array for decoding
      const totalLength = chunks.reduce((sum, chunk) => sum + chunk.length, 0);
      const combined = new Uint8Array(totalLength);
      let offset = 0;
      for (const chunk of chunks) {
        combined.set(chunk, offset);
        offset += chunk.length;
      }
      const text = new TextDecoder().decode(combined);
      expect(text).toBe("v1");
    });
  });

  describe("checkout with workTreeRoot prefix", () => {
    it("should write files under workTreeRoot when specified", async () => {
      // Create in-memory filesystem
      const files = createInMemoryFilesApi();

      // Use a non-empty workTreeRoot
      const store = createStoreWithFiles(files, "/project");
      const git = Git.wrap(store);

      // Initialize repository
      await initializeStore(store);

      // Create commit with file
      await addFile(store, "readme.txt", "Hello World");
      await git.commit().setMessage("Add readme").call();

      // Create branch and switch back
      await git.checkout().setCreateBranch(true).setName("feature").call();
      await git.checkout().setName("main").call();

      // Verify file exists under workTreeRoot
      expect(await fileExists(files, "/project/readme.txt")).toBe(true);

      // Verify content
      const content = await readFileContent(files, "/project/readme.txt");
      expect(content).toBe("Hello World");
    });
  });
});
