/**
 * Tests for CheckoutCommand
 *
 * Based on JGit's CheckoutCommandTest.java patterns.
 * Adapted for staging-only operations (no working tree).
 *
 * Reference: tmp/jgit/org.eclipse.jgit.test/tst/org/eclipse/jgit/api/CheckoutCommandTest.java
 */

import { describe, expect, it } from "vitest";

import { CheckoutStatus } from "../src/commands/checkout-command.js";
import { RefNotFoundError } from "../src/errors/index.js";
import { addFile, createInitializedGit } from "./test-helper.js";

/**
 * Collect async iterable bytes into single Uint8Array.
 */
async function collectBytes(iterable: AsyncIterable<Uint8Array>): Promise<Uint8Array> {
  const chunks: Uint8Array[] = [];
  for await (const chunk of iterable) {
    chunks.push(chunk);
  }
  const totalLength = chunks.reduce((sum, chunk) => sum + chunk.length, 0);
  const result = new Uint8Array(totalLength);
  let offset = 0;
  for (const chunk of chunks) {
    result.set(chunk, offset);
    offset += chunk.length;
  }
  return result;
}

describe("CheckoutCommand", () => {
  describe("branch checkout", () => {
    /**
     * JGit: testSimpleCheckout
     * Simple checkout should work.
     */
    it("testSimpleCheckout - should checkout existing branch", async () => {
      const { git, store } = await createInitializedGit();

      // Create initial commit on main
      await addFile(store, "Test.txt", "Hello world");
      await git.commit().setMessage("Initial commit").call();

      // Create test branch
      await git.branchCreate().setName("test").call();

      // Checkout test branch
      const result = await git.checkout().setName("test").call();

      expect(result.status).toBe(CheckoutStatus.OK);

      // Verify HEAD points to test branch
      const headRaw = await store.refs.get("HEAD");
      expect(headRaw).toBeDefined();
      if (headRaw && "target" in headRaw) {
        expect(headRaw.target).toBe("refs/heads/test");
      }
    });

    /**
     * JGit: testCheckout
     * Checkout should switch branches and update staging.
     */
    it("testCheckout - should switch branch and update staging", async () => {
      const { git, store } = await createInitializedGit();

      // Initial commit on main
      await addFile(store, "Test.txt", "Hello world");
      await git.commit().setMessage("Initial commit").call();

      // Create and checkout test branch
      await git.branchCreate().setName("test").call();
      await git.checkout().setName("test").call();

      // Modify file on test branch
      await addFile(store, "Test.txt", "Some change");
      await git.commit().setMessage("Second commit").call();

      // Checkout main - staging should update
      const result = await git.checkout().setName("main").call();

      expect(result.status).toBe(CheckoutStatus.OK);

      // Verify staging has main's version
      const entry = await store.staging.getEntry("Test.txt");
      const content = await collectBytes(store.blobs.load(entry?.objectId ?? ""));
      const text = new TextDecoder().decode(content);
      expect(text).toBe("Hello world");

      // Verify HEAD points to main
      const headRaw = await store.refs.get("HEAD");
      if (headRaw && "target" in headRaw) {
        expect(headRaw.target).toBe("refs/heads/main");
      }
    });

    /**
     * JGit: testCheckoutToNonExistingBranch
     * Checkout to non-existing branch should throw.
     */
    it("testCheckoutToNonExistingBranch - should throw for non-existing branch", async () => {
      const { git, store } = await createInitializedGit();

      await addFile(store, "Test.txt", "content");
      await git.commit().setMessage("Initial").call();

      await expect(git.checkout().setName("nonexistent").call()).rejects.toThrow(RefNotFoundError);
    });

    /**
     * Checkout to detached HEAD (commit ID).
     */
    it("should checkout to detached HEAD for commit ID", async () => {
      const { git, store } = await createInitializedGit();

      await addFile(store, "Test.txt", "Hello world");
      const commit1 = await git.commit().setMessage("Initial").call();

      await addFile(store, "Test.txt", "Changed");
      await git.commit().setMessage("Second").call();

      // Checkout by commit ID (detached HEAD)
      const result = await git.checkout().setName(commit1.id).call();

      expect(result.status).toBe(CheckoutStatus.OK);

      // HEAD should be detached (direct ref, not symbolic)
      const head = await store.refs.resolve("HEAD");
      expect(head?.objectId).toBe(commit1.id);

      // Staging should have first commit's content
      const entry = await store.staging.getEntry("Test.txt");
      const content = await collectBytes(store.blobs.load(entry?.objectId ?? ""));
      const text = new TextDecoder().decode(content);
      expect(text).toBe("Hello world");
    });
  });

  describe("branch creation", () => {
    /**
     * JGit: testCreateBranchOnCheckout
     * Create branch with -b flag.
     */
    it("testCreateBranchOnCheckout - should create branch on checkout", async () => {
      const { git, store } = await createInitializedGit();

      await addFile(store, "Test.txt", "content");
      await git.commit().setMessage("Initial").call();

      const result = await git.checkout().setCreateBranch(true).setName("test2").call();

      expect(result.status).toBe(CheckoutStatus.OK);

      // Verify branch was created
      const branch = await store.refs.resolve("refs/heads/test2");
      expect(branch).toBeDefined();

      // Verify HEAD points to new branch
      const headRaw = await store.refs.get("HEAD");
      if (headRaw && "target" in headRaw) {
        expect(headRaw.target).toBe("refs/heads/test2");
      }
    });

    /**
     * Create branch at specific start point.
     */
    it("should create branch at specific start point", async () => {
      const { git, store } = await createInitializedGit();

      await addFile(store, "Test.txt", "v1");
      const commit1 = await git.commit().setMessage("First").call();

      await addFile(store, "Test.txt", "v2");
      await git.commit().setMessage("Second").call();

      // Create branch at first commit
      await git
        .checkout()
        .setCreateBranch(true)
        .setName("from-first")
        .setStartPoint(commit1.id)
        .call();

      // Verify branch points to first commit
      const branch = await store.refs.resolve("refs/heads/from-first");
      expect(branch?.objectId).toBe(commit1.id);
    });
  });

  describe("path checkout", () => {
    /**
     * JGit: testCheckoutPath
     * Checkout specific path from index.
     */
    it("testCheckoutPath - should checkout path from index", async () => {
      const { git, store } = await createInitializedGit();

      // Create files
      await addFile(store, "a.txt", "original a");
      await addFile(store, "b.txt", "original b");
      await git.commit().setMessage("Initial").call();

      // Modify in staging
      await addFile(store, "a.txt", "modified a");

      // Path checkout should restore from committed state
      const result = await git.checkout().addPath("a.txt").call();

      expect(result.status).toBe(CheckoutStatus.OK);
      expect(result.updated).toContain("a.txt");
      expect(result.ref).toBeNull(); // No ref for path checkout
    });

    /**
     * Checkout path from specific commit.
     */
    it("should checkout path from specific commit", async () => {
      const { git, store } = await createInitializedGit();

      await addFile(store, "Test.txt", "version 1");
      const commit1 = await git.commit().setMessage("First").call();

      await addFile(store, "Test.txt", "version 2");
      await git.commit().setMessage("Second").call();

      // Checkout file from first commit
      const result = await git.checkout().setStartPoint(commit1.id).addPath("Test.txt").call();

      expect(result.status).toBe(CheckoutStatus.OK);
      expect(result.updated).toContain("Test.txt");

      // Verify staging has version 1
      const entry = await store.staging.getEntry("Test.txt");
      const content = await collectBytes(store.blobs.load(entry?.objectId ?? ""));
      const text = new TextDecoder().decode(content);
      expect(text).toBe("version 1");
    });

    /**
     * JGit: testCheckoutAllPaths
     * Checkout all paths.
     */
    it("testCheckoutAllPaths - should checkout all paths", async () => {
      const { git, store } = await createInitializedGit();

      await addFile(store, "a.txt", "a");
      await addFile(store, "b.txt", "b");
      await git.commit().setMessage("Initial").call();

      // Modify both files
      await addFile(store, "a.txt", "modified a");
      await addFile(store, "b.txt", "modified b");

      // Checkout all paths
      const result = await git.checkout().setAllPaths(true).call();

      expect(result.status).toBe(CheckoutStatus.OK);
    });

    /**
     * Path checkout from non-existing path should report conflict.
     */
    it("should report conflict for non-existing path", async () => {
      const { git, store } = await createInitializedGit();

      await addFile(store, "existing.txt", "content");
      await git.commit().setMessage("Initial").call();

      const result = await git.checkout().addPath("nonexistent.txt").call();

      expect(result.status).toBe(CheckoutStatus.CONFLICTS);
      expect(result.conflicts).toContain("nonexistent.txt");
    });
  });

  describe("orphan branch", () => {
    /**
     * JGit: testOrphanBranch
     * Create orphan branch.
     */
    it("testOrphanBranch - should create orphan branch", async () => {
      const { git, store } = await createInitializedGit();

      await addFile(store, "Test.txt", "content");
      await git.commit().setMessage("Initial").call();

      const result = await git.checkout().setOrphan(true).setName("orphan").call();

      expect(result.status).toBe(CheckoutStatus.OK);

      // HEAD should point to orphan branch symbolically
      const headRaw = await store.refs.get("HEAD");
      expect(headRaw).toBeDefined();
      if (headRaw && "target" in headRaw) {
        expect(headRaw.target).toBe("refs/heads/orphan");
      }
    });
  });

  describe("error cases", () => {
    /**
     * Checkout without name should throw.
     */
    it("should throw when name not set for branch checkout", async () => {
      const { git, store } = await createInitializedGit();

      await addFile(store, "Test.txt", "content");
      await git.commit().setMessage("Initial").call();

      await expect(git.checkout().call()).rejects.toThrow("Branch name is required for checkout");
    });

    /**
     * Command can only be called once.
     */
    it("should throw if called twice", async () => {
      const { git, store } = await createInitializedGit();

      await addFile(store, "Test.txt", "content");
      await git.commit().setMessage("Initial").call();
      await git.branchCreate().setName("test").call();

      const cmd = git.checkout().setName("test");
      await cmd.call();

      await expect(cmd.call()).rejects.toThrow(/already been called/);
    });
  });

  describe("staging updates", () => {
    /**
     * Branch checkout should update staging to match target tree.
     */
    it("should update staging on branch checkout", async () => {
      const { git, store } = await createInitializedGit();
      const { DeleteStagingEntry } = await import("@webrun-vcs/worktree");

      // Create initial state on main
      await addFile(store, "a.txt", "main-a");
      await addFile(store, "b.txt", "main-b");
      await git.commit().setMessage("Main commit").call();

      // Create test branch with different files
      await git.branchCreate().setName("test").call();
      await git.checkout().setName("test").call();

      await addFile(store, "a.txt", "test-a");
      await addFile(store, "c.txt", "test-c");
      // Remove b.txt from test branch
      const editor = store.staging.editor();
      editor.add(new DeleteStagingEntry("b.txt"));
      await editor.finish();
      await git.commit().setMessage("Test commit").call();

      // Switch back to main
      const result = await git.checkout().setName("main").call();

      expect(result.status).toBe(CheckoutStatus.OK);

      // Verify staging has main's files
      const entryA = await store.staging.getEntry("a.txt");
      const entryB = await store.staging.getEntry("b.txt");
      const entryC = await store.staging.getEntry("c.txt");

      expect(entryA).toBeDefined();
      expect(entryB).toBeDefined();
      expect(entryC).toBeUndefined(); // c.txt only in test branch

      // Verify content
      const contentA = await collectBytes(store.blobs.load(entryA?.objectId ?? ""));
      expect(new TextDecoder().decode(contentA)).toBe("main-a");
    });
  });
});
