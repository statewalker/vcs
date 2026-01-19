/**
 * Integration tests for VcsRepositoryAccess
 *
 * Tests end-to-end workflows using real in-memory stores.
 */

import type { ObjectId } from "@statewalker/vcs-core";
import { MemoryRefStore, ObjectType } from "@statewalker/vcs-core";
import { createMemoryObjectStores } from "@statewalker/vcs-store-mem";
import { collect } from "@statewalker/vcs-utils/streams";
import { describe, expect, it } from "vitest";
import {
  createVcsRepositoryAccess,
  type VcsRepositoryAccessParams,
} from "../src/vcs-repository-access.js";
import { parseGitWireFormat } from "../src/wire-format-utils.js";

const SAMPLE_IDENT = {
  name: "Test User",
  email: "test@example.com",
  timestamp: 1700000000,
  tzOffset: "+0000",
};

/**
 * Create a full set of VCS stores backed by memory
 */
function createMemoryStores(): VcsRepositoryAccessParams {
  const objectStores = createMemoryObjectStores();
  const refs = new MemoryRefStore();

  return {
    blobs: objectStores.blobs,
    trees: objectStores.trees,
    commits: objectStores.commits,
    tags: objectStores.tags,
    refs,
  };
}

describe("VcsRepositoryAccess Integration Tests", () => {
  describe("Push and clone workflow", () => {
    it("can clone content from source to target", async () => {
      // Set up source repository
      const sourceStores = createMemoryStores();

      // Create content in source
      const blobContent = new TextEncoder().encode("Hello from source!");
      const blobId = await sourceStores.blobs.store([blobContent]);

      const treeId = await sourceStores.trees.storeTree([
        { mode: 0o100644, name: "readme.txt", id: blobId },
      ]);

      const commitId = await sourceStores.commits.storeCommit({
        tree: treeId,
        parents: [],
        author: SAMPLE_IDENT,
        committer: SAMPLE_IDENT,
        message: "Initial commit",
      });

      // Set up refs in source
      await sourceStores.refs.set("refs/heads/main", commitId);
      await sourceStores.refs.setSymbolic("HEAD", "refs/heads/main");

      // Create VcsRepositoryAccess for source
      const sourceAccess = createVcsRepositoryAccess(sourceStores);

      // Set up target repository
      const targetStores = createMemoryStores();
      const targetAccess = createVcsRepositoryAccess(targetStores);

      // Simulate fetch: listRefs(), walkObjects(), storeObject()
      // 1. List refs
      const refs: Array<{ name: string; objectId: string }> = [];
      for await (const ref of sourceAccess.listRefs()) {
        refs.push(ref);
      }

      expect(refs.length).toBeGreaterThan(0);
      const mainRef = refs.find((r) => r.name === "refs/heads/main");
      expect(mainRef?.objectId).toBe(commitId);

      // 2. Walk objects from wants and store in target
      const wants = [commitId];
      const haves: ObjectId[] = [];

      for await (const obj of sourceAccess.walkObjects(wants, haves)) {
        await targetAccess.storeObject(obj.type, obj.content);
      }

      // 3. Verify target has all content
      expect(await targetAccess.hasObject(commitId)).toBe(true);
      expect(await targetAccess.hasObject(treeId)).toBe(true);
      expect(await targetAccess.hasObject(blobId)).toBe(true);

      // Verify blob content matches
      const targetBlobContent = await collect(targetStores.blobs.load(blobId));
      expect(targetBlobContent).toEqual(blobContent);
    });
  });

  describe("Incremental fetch (only new objects)", () => {
    it("fetches only new objects when client has base commit", async () => {
      const sourceStores = createMemoryStores();

      // Create initial commit
      const blob1Content = new TextEncoder().encode("version 1");
      const blob1Id = await sourceStores.blobs.store([blob1Content]);
      const tree1Id = await sourceStores.trees.storeTree([
        { mode: 0o100644, name: "file.txt", id: blob1Id },
      ]);
      const commit1Id = await sourceStores.commits.storeCommit({
        tree: tree1Id,
        parents: [],
        author: SAMPLE_IDENT,
        committer: SAMPLE_IDENT,
        message: "First commit",
      });

      // Create second commit
      const blob2Content = new TextEncoder().encode("version 2");
      const blob2Id = await sourceStores.blobs.store([blob2Content]);
      const tree2Id = await sourceStores.trees.storeTree([
        { mode: 0o100644, name: "file.txt", id: blob2Id },
      ]);
      const commit2Id = await sourceStores.commits.storeCommit({
        tree: tree2Id,
        parents: [commit1Id],
        author: SAMPLE_IDENT,
        committer: SAMPLE_IDENT,
        message: "Second commit",
      });

      await sourceStores.refs.set("refs/heads/main", commit2Id);

      const sourceAccess = createVcsRepositoryAccess(sourceStores);

      // Simulate client having the first commit
      const haves = [commit1Id];
      const wants = [commit2Id];

      // Walk should NOT include objects from first commit
      const objects: Array<{ id: string; type: number }> = [];
      for await (const obj of sourceAccess.walkObjects(wants, haves)) {
        objects.push({ id: obj.id, type: obj.type });
      }

      // Should have commit2, tree2, blob2 but NOT commit1, tree1, blob1
      expect(objects.find((o) => o.id === commit2Id)).toBeDefined();
      expect(objects.find((o) => o.id === tree2Id)).toBeDefined();
      expect(objects.find((o) => o.id === blob2Id)).toBeDefined();

      expect(objects.find((o) => o.id === commit1Id)).toBeUndefined();
      expect(objects.find((o) => o.id === tree1Id)).toBeUndefined();
      expect(objects.find((o) => o.id === blob1Id)).toBeUndefined();
    });
  });

  describe("History preservation through clone", () => {
    it("preserves linear history with parent relationships", async () => {
      const sourceStores = createMemoryStores();

      // Create commit1
      const tree1Id = await sourceStores.trees.storeTree([]);
      const commit1Id = await sourceStores.commits.storeCommit({
        tree: tree1Id,
        parents: [],
        author: SAMPLE_IDENT,
        committer: SAMPLE_IDENT,
        message: "Commit 1",
      });

      // Create commit2
      const commit2Id = await sourceStores.commits.storeCommit({
        tree: tree1Id,
        parents: [commit1Id],
        author: SAMPLE_IDENT,
        committer: SAMPLE_IDENT,
        message: "Commit 2",
      });

      // Create commit3
      const commit3Id = await sourceStores.commits.storeCommit({
        tree: tree1Id,
        parents: [commit2Id],
        author: SAMPLE_IDENT,
        committer: SAMPLE_IDENT,
        message: "Commit 3",
      });

      // Clone via walkObjects
      const sourceAccess = createVcsRepositoryAccess(sourceStores);
      const targetStores = createMemoryStores();
      const targetAccess = createVcsRepositoryAccess(targetStores);

      for await (const obj of sourceAccess.walkObjects([commit3Id], [])) {
        await targetAccess.storeObject(obj.type, obj.content);
      }

      // Verify all commits exist in target
      expect(await targetAccess.hasObject(commit1Id)).toBe(true);
      expect(await targetAccess.hasObject(commit2Id)).toBe(true);
      expect(await targetAccess.hasObject(commit3Id)).toBe(true);

      // Verify parent relationships are preserved
      const commit3 = await targetStores.commits.loadCommit(commit3Id);
      expect(commit3.parents).toEqual([commit2Id]);

      const commit2 = await targetStores.commits.loadCommit(commit2Id);
      expect(commit2.parents).toEqual([commit1Id]);

      const commit1 = await targetStores.commits.loadCommit(commit1Id);
      expect(commit1.parents).toEqual([]);
    });
  });

  describe("Annotated tags handling", () => {
    it("clones tag objects and their referenced commits", async () => {
      const sourceStores = createMemoryStores();

      // Create commit
      const treeId = await sourceStores.trees.storeTree([]);
      const commitId = await sourceStores.commits.storeCommit({
        tree: treeId,
        parents: [],
        author: SAMPLE_IDENT,
        committer: SAMPLE_IDENT,
        message: "Release commit",
      });

      // Create annotated tag
      const tagId = await sourceStores.tags.storeTag({
        object: commitId,
        objectType: ObjectType.COMMIT,
        tag: "v1.0.0",
        tagger: SAMPLE_IDENT,
        message: "Version 1.0.0 release",
      });

      // Set tag ref
      await sourceStores.refs.set("refs/tags/v1.0.0", tagId);

      // Clone via walkObjects from tag
      const sourceAccess = createVcsRepositoryAccess(sourceStores);
      const targetStores = createMemoryStores();
      const targetAccess = createVcsRepositoryAccess(targetStores);

      for await (const obj of sourceAccess.walkObjects([tagId], [])) {
        await targetAccess.storeObject(obj.type, obj.content);
      }

      // Verify tag object exists
      expect(await targetAccess.hasObject(tagId)).toBe(true);

      // Verify tagged commit exists
      expect(await targetAccess.hasObject(commitId)).toBe(true);

      // Verify tag content
      const tag = await targetStores.tags.loadTag(tagId);
      expect(tag.tag).toBe("v1.0.0");
      expect(tag.message).toBe("Version 1.0.0 release");
      expect(tag.object).toBe(commitId);
    });

    it("includes peeledId for annotated tag refs", async () => {
      const sourceStores = createMemoryStores();

      // Create commit
      const treeId = await sourceStores.trees.storeTree([]);
      const commitId = await sourceStores.commits.storeCommit({
        tree: treeId,
        parents: [],
        author: SAMPLE_IDENT,
        committer: SAMPLE_IDENT,
        message: "Tagged commit",
      });

      // Create annotated tag
      const tagId = await sourceStores.tags.storeTag({
        object: commitId,
        objectType: ObjectType.COMMIT,
        tag: "v2.0.0",
        tagger: SAMPLE_IDENT,
        message: "Version 2.0.0",
      });

      // Set tag ref
      await sourceStores.refs.set("refs/tags/v2.0.0", tagId);

      const sourceAccess = createVcsRepositoryAccess(sourceStores);

      // List refs should include peeledId
      const refs: Array<{ name: string; objectId: string; peeledId?: string }> = [];
      for await (const ref of sourceAccess.listRefs()) {
        refs.push(ref);
      }

      const tagRef = refs.find((r) => r.name === "refs/tags/v2.0.0");
      expect(tagRef).toBeDefined();
      expect(tagRef?.objectId).toBe(tagId);
      expect(tagRef?.peeledId).toBe(commitId);
    });
  });

  describe("Wire format round-trip", () => {
    it("loadObject produces parseable wire format", async () => {
      const stores = createMemoryStores();

      // Store blob
      const blobContent = new TextEncoder().encode("Test content");
      const blobId = await stores.blobs.store([blobContent]);

      const access = createVcsRepositoryAccess(stores);

      // Load in wire format
      const wireData = await collect(access.loadObject(blobId));

      // Parse wire format
      const { type, body } = parseGitWireFormat(wireData);

      expect(type).toBe(ObjectType.BLOB);
      expect(body).toEqual(blobContent);
    });

    it("storeObject correctly stores parsed content", async () => {
      const sourceStores = createMemoryStores();
      const targetStores = createMemoryStores();

      // Create content in source
      const originalContent = new TextEncoder().encode("Original data");
      const blobId = await sourceStores.blobs.store([originalContent]);

      const sourceAccess = createVcsRepositoryAccess(sourceStores);
      const targetAccess = createVcsRepositoryAccess(targetStores);

      // Load from source
      const wireData = await collect(sourceAccess.loadObject(blobId));
      const { type, body } = parseGitWireFormat(wireData);

      // Store in target
      const storedId = await targetAccess.storeObject(type, body);

      // Should get same ID (content-addressable)
      expect(storedId).toBe(blobId);

      // Content should match
      const storedContent = await collect(targetStores.blobs.load(storedId));
      expect(storedContent).toEqual(originalContent);
    });
  });

  describe("Ref operations", () => {
    it("supports full ref lifecycle", async () => {
      const stores = createMemoryStores();
      const access = createVcsRepositoryAccess(stores);

      // Create commit
      const treeId = await stores.trees.storeTree([]);
      const commit1Id = await stores.commits.storeCommit({
        tree: treeId,
        parents: [],
        author: SAMPLE_IDENT,
        committer: SAMPLE_IDENT,
        message: "First",
      });

      // Create ref (oldId = null)
      const created = await access.updateRef("refs/heads/test", null, commit1Id);
      expect(created).toBe(true);

      // Verify via listRefs
      const refs1: Array<{ name: string; objectId: string }> = [];
      for await (const ref of access.listRefs()) {
        refs1.push(ref);
      }
      expect(refs1.find((r) => r.name === "refs/heads/test")?.objectId).toBe(commit1Id);

      // Update ref with compare-and-swap
      const commit2Id = await stores.commits.storeCommit({
        tree: treeId,
        parents: [commit1Id],
        author: SAMPLE_IDENT,
        committer: SAMPLE_IDENT,
        message: "Second",
      });

      const updated = await access.updateRef("refs/heads/test", commit1Id, commit2Id);
      expect(updated).toBe(true);

      // Verify update
      const refs2: Array<{ name: string; objectId: string }> = [];
      for await (const ref of access.listRefs()) {
        refs2.push(ref);
      }
      expect(refs2.find((r) => r.name === "refs/heads/test")?.objectId).toBe(commit2Id);

      // Delete ref
      const deleted = await access.updateRef("refs/heads/test", null, null);
      expect(deleted).toBe(true);

      // Verify deletion
      expect(await stores.refs.has("refs/heads/test")).toBe(false);
    });
  });
});

/**
 * Helper to get the store name for an object type
 */
function _getStoreForType(type: number): "commits" | "trees" | "blobs" | "tags" {
  switch (type) {
    case ObjectType.COMMIT:
      return "commits";
    case ObjectType.TREE:
      return "trees";
    case ObjectType.BLOB:
      return "blobs";
    case ObjectType.TAG:
      return "tags";
    default:
      throw new Error(`Unknown type: ${type}`);
  }
}
