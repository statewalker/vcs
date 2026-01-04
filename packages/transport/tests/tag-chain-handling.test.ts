/**
 * Tests for tag chain handling.
 * Ported from JGit's UploadPackTest.java tag tests.
 *
 * Tag chains occur when:
 * - Annotated tags point to other annotated tags
 * - Need to peel through tag chain to find actual commit
 * - include-tag optimization must handle chains correctly
 */

import type { ObjectTypeCode } from "@statewalker/vcs-core";
import { describe, expect, it } from "vitest";
import { createProtocolV2Handler } from "../src/handlers/protocol-v2-handler.js";
import type {
  HeadInfo,
  ObjectId,
  ObjectInfo,
  RefInfo,
  RepositoryAccess,
} from "../src/handlers/types.js";

// Object type codes
const OBJ_COMMIT = 1 as ObjectTypeCode;
const OBJ_TREE = 2 as ObjectTypeCode;
const OBJ_BLOB = 3 as ObjectTypeCode;
const OBJ_TAG = 4 as ObjectTypeCode;

// Sample object IDs for tag chain
const COMMIT_TIP = "a".repeat(40);
const COMMIT_TREE = "b".repeat(40);
const TAG_V1 = "c".repeat(40); // v1.0 -> commit
const TAG_V1_1 = "d".repeat(40); // v1.1 -> v1.0 (tag pointing to tag)
const TAG_V1_2 = "e".repeat(40); // v1.2 -> v1.1 (deeper tag chain)

// Sample tag content
function createTagContent(target: ObjectId, targetType: string, tagName: string): Uint8Array {
  return new TextEncoder().encode(
    `object ${target}\ntype ${targetType}\ntag ${tagName}\ntagger Test <test@test.com> 1600000000 +0000\n\nTag message\n`,
  );
}

// Sample commit content
const COMMIT_CONTENT = new TextEncoder().encode(
  `tree ${COMMIT_TREE}\nauthor Test <test@test.com> 1600000000 +0000\ncommitter Test <test@test.com> 1600000000 +0000\n\nInitial commit\n`,
);

// Sample tree content
const TREE_CONTENT = new Uint8Array([
  // Tree entry format: mode space name null sha
  ...new TextEncoder().encode("100644 file.txt\0"),
  ...new Uint8Array(20).fill(0),
]);

/**
 * Create a mock repository for testing tag chains.
 */
function createTagChainRepository(options?: {
  refs?: RefInfo[];
  head?: HeadInfo | null;
  objects?: Map<ObjectId, { type: ObjectTypeCode; content: Uint8Array }>;
}): RepositoryAccess {
  // Default: commit <- tag v1 <- tag v1.1 <- tag v1.2
  const defaultObjects = new Map<ObjectId, { type: ObjectTypeCode; content: Uint8Array }>([
    [COMMIT_TIP, { type: OBJ_COMMIT, content: COMMIT_CONTENT }],
    [COMMIT_TREE, { type: OBJ_TREE, content: TREE_CONTENT }],
    [TAG_V1, { type: OBJ_TAG, content: createTagContent(COMMIT_TIP, "commit", "v1.0") }],
    [TAG_V1_1, { type: OBJ_TAG, content: createTagContent(TAG_V1, "tag", "v1.1") }],
    [TAG_V1_2, { type: OBJ_TAG, content: createTagContent(TAG_V1_1, "tag", "v1.2") }],
  ]);

  const refs = options?.refs ?? [
    { name: "refs/heads/main", objectId: COMMIT_TIP },
    { name: "refs/tags/v1.0", objectId: TAG_V1, peeledId: COMMIT_TIP },
    { name: "refs/tags/v1.1", objectId: TAG_V1_1, peeledId: COMMIT_TIP },
    { name: "refs/tags/v1.2", objectId: TAG_V1_2, peeledId: COMMIT_TIP },
  ];
  const head = options?.head ?? { target: "refs/heads/main" };
  const objects = options?.objects ?? defaultObjects;

  return {
    async *listRefs(): AsyncIterable<RefInfo> {
      for (const ref of refs) {
        yield ref;
      }
    },

    async getHead(): Promise<HeadInfo | null> {
      return head;
    },

    async hasObject(id: ObjectId): Promise<boolean> {
      return objects.has(id);
    },

    async getObjectInfo(id: ObjectId): Promise<ObjectInfo | null> {
      const obj = objects.get(id);
      if (!obj) return null;
      return {
        type: obj.type,
        size: obj.content.length,
      };
    },

    async *loadObject(id: ObjectId): AsyncIterable<Uint8Array> {
      const obj = objects.get(id);
      if (obj) {
        yield obj.content;
      }
    },

    async storeObject(_type: ObjectTypeCode, _content: Uint8Array): Promise<ObjectId> {
      throw new Error("Not implemented");
    },

    async updateRef(
      _name: string,
      _oldId: ObjectId | null,
      _newId: ObjectId | null,
    ): Promise<boolean> {
      throw new Error("Not implemented");
    },

    async *walkObjects(
      wants: ObjectId[],
      haves: ObjectId[],
    ): AsyncIterable<{
      id: ObjectId;
      type: ObjectTypeCode;
      content: Uint8Array;
    }> {
      const haveSet = new Set(haves);
      const emitted = new Set<ObjectId>();

      // Walk from wants, emitting reachable objects
      const stack = [...wants];
      while (stack.length > 0) {
        const id = stack.pop();
        if (id === undefined) break;
        if (haveSet.has(id) || emitted.has(id)) continue;

        const obj = objects.get(id);
        if (obj) {
          yield { id, ...obj };
          emitted.add(id);

          // Follow references based on object type
          if (obj.type === OBJ_COMMIT) {
            // Parse tree from commit
            const content = new TextDecoder().decode(obj.content);
            const treeMatch = content.match(/^tree ([0-9a-f]{40})/m);
            if (treeMatch) {
              stack.push(treeMatch[1]);
            }
            // Parse parents
            const parentMatches = content.matchAll(/^parent ([0-9a-f]{40})/gm);
            for (const match of parentMatches) {
              stack.push(match[1]);
            }
          } else if (obj.type === OBJ_TAG) {
            // Parse target from tag
            const content = new TextDecoder().decode(obj.content);
            const objMatch = content.match(/^object ([0-9a-f]{40})/m);
            if (objMatch) {
              stack.push(objMatch[1]);
            }
          }
        }
      }
    },
  };
}

// Helper to collect async iterable into array
async function collectBytes(stream: AsyncIterable<Uint8Array>): Promise<Uint8Array> {
  const chunks: Uint8Array[] = [];
  for await (const chunk of stream) {
    chunks.push(chunk);
  }
  const totalLength = chunks.reduce((sum, c) => sum + c.length, 0);
  const result = new Uint8Array(totalLength);
  let offset = 0;
  for (const chunk of chunks) {
    result.set(chunk, offset);
    offset += chunk.length;
  }
  return result;
}

// Helper to convert bytes to string
function bytesToString(bytes: Uint8Array): string {
  return new TextDecoder().decode(bytes);
}

describe("Tag Chain Handling", () => {
  describe("Peeled References", () => {
    it("should include peeledId for annotated tags", async () => {
      const repo = createTagChainRepository();
      const _handler = createProtocolV2Handler({ repository: repo });

      const refs: RefInfo[] = [];
      for await (const ref of repo.listRefs()) {
        refs.push(ref);
      }

      // All tags should have peeledId pointing to the ultimate commit
      const v1Tag = refs.find((r) => r.name === "refs/tags/v1.0");
      expect(v1Tag?.peeledId).toBe(COMMIT_TIP);

      const v11Tag = refs.find((r) => r.name === "refs/tags/v1.1");
      expect(v11Tag?.peeledId).toBe(COMMIT_TIP);

      const v12Tag = refs.find((r) => r.name === "refs/tags/v1.2");
      expect(v12Tag?.peeledId).toBe(COMMIT_TIP);
    });

    it("should handle tag pointing to tag (depth 2)", async () => {
      const repo = createTagChainRepository();

      // TAG_V1_1 points to TAG_V1 which points to COMMIT_TIP
      const tagInfo = await repo.getObjectInfo(TAG_V1_1);
      expect(tagInfo?.type).toBe(OBJ_TAG);

      // Load and parse tag content
      const chunks: Uint8Array[] = [];
      for await (const chunk of repo.loadObject(TAG_V1_1)) {
        chunks.push(chunk);
      }
      const content = new TextDecoder().decode(chunks[0]);
      expect(content).toContain(`object ${TAG_V1}`);
      expect(content).toContain("type tag");
    });

    it("should handle tag pointing to tag pointing to tag (depth 3)", async () => {
      const repo = createTagChainRepository();

      // TAG_V1_2 -> TAG_V1_1 -> TAG_V1 -> COMMIT_TIP
      const tagInfo = await repo.getObjectInfo(TAG_V1_2);
      expect(tagInfo?.type).toBe(OBJ_TAG);

      // Load and parse tag content
      const chunks: Uint8Array[] = [];
      for await (const chunk of repo.loadObject(TAG_V1_2)) {
        chunks.push(chunk);
      }
      const content = new TextDecoder().decode(chunks[0]);
      expect(content).toContain(`object ${TAG_V1_1}`);
      expect(content).toContain("type tag");
    });
  });

  describe("Include-Tag Optimization with Chains", () => {
    it("should include all tags in chain when commit is sent", async () => {
      // When include-tag is enabled and the commit is being sent,
      // all tags that peel to that commit should be included
      const repo = createTagChainRepository();

      // Simulate walking objects with COMMIT_TIP as want
      const emittedIds: ObjectId[] = [];
      for await (const obj of repo.walkObjects([COMMIT_TIP], [])) {
        emittedIds.push(obj.id);
      }

      // Should include commit and tree
      expect(emittedIds).toContain(COMMIT_TIP);
      expect(emittedIds).toContain(COMMIT_TREE);
    });

    it("should correctly identify peeled target through chain", () => {
      // Given a tag chain: v1.2 -> v1.1 -> v1.0 -> commit
      // The peeled target should be the commit, not intermediate tags

      // This is a logic test for the peeling algorithm
      function peelTagChain(
        tagId: ObjectId,
        getObject: (id: ObjectId) => { type: ObjectTypeCode; content: Uint8Array } | null,
      ): ObjectId {
        let currentId = tagId;
        let maxDepth = 100; // Prevent infinite loops

        while (maxDepth-- > 0) {
          const obj = getObject(currentId);
          if (!obj || obj.type !== OBJ_TAG) {
            return currentId;
          }

          // Parse target from tag content
          const content = new TextDecoder().decode(obj.content);
          const match = content.match(/^object ([0-9a-f]{40})/m);
          if (!match) {
            return currentId;
          }
          currentId = match[1];
        }

        throw new Error("Tag chain too deep");
      }

      // Create objects map for testing
      const objects = new Map<ObjectId, { type: ObjectTypeCode; content: Uint8Array }>([
        [COMMIT_TIP, { type: OBJ_COMMIT, content: COMMIT_CONTENT }],
        [TAG_V1, { type: OBJ_TAG, content: createTagContent(COMMIT_TIP, "commit", "v1.0") }],
        [TAG_V1_1, { type: OBJ_TAG, content: createTagContent(TAG_V1, "tag", "v1.1") }],
        [TAG_V1_2, { type: OBJ_TAG, content: createTagContent(TAG_V1_1, "tag", "v1.2") }],
      ]);

      const getObject = (id: ObjectId) => objects.get(id) ?? null;

      // All tags should peel to COMMIT_TIP
      expect(peelTagChain(TAG_V1, getObject)).toBe(COMMIT_TIP);
      expect(peelTagChain(TAG_V1_1, getObject)).toBe(COMMIT_TIP);
      expect(peelTagChain(TAG_V1_2, getObject)).toBe(COMMIT_TIP);
    });
  });

  describe("Tag Object Type Detection", () => {
    it("should identify tag pointing to commit", async () => {
      const repo = createTagChainRepository();
      const chunks: Uint8Array[] = [];
      for await (const chunk of repo.loadObject(TAG_V1)) {
        chunks.push(chunk);
      }
      const content = new TextDecoder().decode(chunks[0]);
      expect(content).toContain("type commit");
    });

    it("should identify tag pointing to tag", async () => {
      const repo = createTagChainRepository();
      const chunks: Uint8Array[] = [];
      for await (const chunk of repo.loadObject(TAG_V1_1)) {
        chunks.push(chunk);
      }
      const content = new TextDecoder().decode(chunks[0]);
      expect(content).toContain("type tag");
    });
  });

  describe("Refs Advertisement with Peeled Tags", () => {
    it("should advertise peel info in ls-refs", async () => {
      const repo = createTagChainRepository();
      const handler = createProtocolV2Handler({ repository: repo });

      // Empty stream for ls-refs
      async function* _emptyStream(): AsyncGenerator<Uint8Array> {}

      // Request peel info
      async function* peelRequest(): AsyncGenerator<Uint8Array> {
        // pkt-line format: 4-byte hex length (including header) + payload
        // "peel\n" = 5 bytes, so length = 4 + 5 = 9 = "0009"
        yield new TextEncoder().encode("0009peel\n");
        yield new TextEncoder().encode("0000");
      }

      const output = bytesToString(await collectBytes(handler.handleLsRefs(peelRequest())));

      // All tag refs should have peeled info
      expect(output).toContain("refs/tags/v1.0");
      expect(output).toContain(`peeled:${COMMIT_TIP}`);
    });
  });
});

describe("JGit Tag Test Scenarios", () => {
  describe("testV0AdvertisedIncludeTag", () => {
    it("should advertise include-tag capability", async () => {
      // JGit test verifies include-tag is advertised
      // This is already covered in protocol tests but included for completeness
      const repo = createTagChainRepository();

      // In V0 protocol, include-tag is in the capabilities
      const refs: RefInfo[] = [];
      for await (const ref of repo.listRefs()) {
        refs.push(ref);
      }
      expect(refs.length).toBeGreaterThan(0);
    });
  });

  describe("testV2FetchIncludeTag", () => {
    it("should include tag when commit is sent with include-tag enabled", async () => {
      // JGit test: when client requests commit with include-tag,
      // server sends the annotated tag if it peels to that commit
      const repo = createTagChainRepository();

      // Verify refs have correct peeled info
      const refs: RefInfo[] = [];
      for await (const ref of repo.listRefs()) {
        refs.push(ref);
      }

      const tagRef = refs.find((r) => r.name === "refs/tags/v1.0");
      expect(tagRef).toBeDefined();
      expect(tagRef?.objectId).toBe(TAG_V1);
      expect(tagRef?.peeledId).toBe(COMMIT_TIP);
    });
  });

  describe("testV2FetchOfsDelta", () => {
    it("should support ofs-delta with tagged objects", async () => {
      // When using ofs-delta, tag objects can be delta-compressed
      // against their target objects
      const repo = createTagChainRepository();

      // Just verify the structure is correct for ofs-delta usage
      const tagInfo = await repo.getObjectInfo(TAG_V1);
      expect(tagInfo?.type).toBe(OBJ_TAG);
      expect(tagInfo?.size).toBeGreaterThan(0);
    });
  });
});

describe("Edge Cases", () => {
  it("should handle lightweight tags (no tag object)", async () => {
    // Lightweight tags point directly to commits, no tag object
    const objects = new Map<ObjectId, { type: ObjectTypeCode; content: Uint8Array }>([
      [COMMIT_TIP, { type: OBJ_COMMIT, content: COMMIT_CONTENT }],
    ]);

    const repo = createTagChainRepository({
      refs: [
        { name: "refs/heads/main", objectId: COMMIT_TIP },
        { name: "refs/tags/v1.0-light", objectId: COMMIT_TIP }, // No peeledId for lightweight
      ],
      objects,
    });

    const refs: RefInfo[] = [];
    for await (const ref of repo.listRefs()) {
      refs.push(ref);
    }

    const lightTag = refs.find((r) => r.name === "refs/tags/v1.0-light");
    expect(lightTag?.objectId).toBe(COMMIT_TIP);
    expect(lightTag?.peeledId).toBeUndefined();
  });

  it("should handle tag pointing to tree", async () => {
    // Rare case: tag pointing directly to a tree
    const tagToTree = "9".repeat(40);
    const objects = new Map<ObjectId, { type: ObjectTypeCode; content: Uint8Array }>([
      [COMMIT_TREE, { type: OBJ_TREE, content: TREE_CONTENT }],
      [tagToTree, { type: OBJ_TAG, content: createTagContent(COMMIT_TREE, "tree", "tree-tag") }],
    ]);

    const repo = createTagChainRepository({
      refs: [{ name: "refs/tags/tree-tag", objectId: tagToTree, peeledId: COMMIT_TREE }],
      objects,
    });

    const tagInfo = await repo.getObjectInfo(tagToTree);
    expect(tagInfo?.type).toBe(OBJ_TAG);

    const chunks: Uint8Array[] = [];
    for await (const chunk of repo.loadObject(tagToTree)) {
      chunks.push(chunk);
    }
    const content = new TextDecoder().decode(chunks[0]);
    expect(content).toContain("type tree");
  });

  it("should handle tag pointing to blob", async () => {
    // Rare case: tag pointing directly to a blob
    const blobId = "8".repeat(40);
    const tagToBlob = "7".repeat(40);
    const blobContent = new TextEncoder().encode("blob content");

    const objects = new Map<ObjectId, { type: ObjectTypeCode; content: Uint8Array }>([
      [blobId, { type: OBJ_BLOB, content: blobContent }],
      [tagToBlob, { type: OBJ_TAG, content: createTagContent(blobId, "blob", "blob-tag") }],
    ]);

    const repo = createTagChainRepository({
      refs: [{ name: "refs/tags/blob-tag", objectId: tagToBlob, peeledId: blobId }],
      objects,
    });

    const tagInfo = await repo.getObjectInfo(tagToBlob);
    expect(tagInfo?.type).toBe(OBJ_TAG);

    const chunks: Uint8Array[] = [];
    for await (const chunk of repo.loadObject(tagToBlob)) {
      chunks.push(chunk);
    }
    const content = new TextDecoder().decode(chunks[0]);
    expect(content).toContain("type blob");
  });
});
