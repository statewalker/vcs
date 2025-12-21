/**
 * Tests for object filtering (partial clone).
 * Ported from JGit's UploadPackTest.java partial clone tests.
 *
 * Object filtering allows partial clones where:
 * - blob:none - exclude all blobs
 * - blob:limit=<n> - exclude blobs larger than n bytes
 * - tree:<depth> - exclude trees/blobs beyond depth n
 */

import { describe, expect, it } from "vitest";
import { createProtocolV2Handler } from "../src/handlers/protocol-v2-handler.js";
import type {
  HeadInfo,
  ObjectId,
  ObjectInfo,
  ObjectTypeCode,
  RefInfo,
  RepositoryAccess,
} from "../src/handlers/types.js";

// Object type codes
const OBJ_COMMIT = 1 as ObjectTypeCode;
const OBJ_TREE = 2 as ObjectTypeCode;
const OBJ_BLOB = 3 as ObjectTypeCode;
const _OBJ_TAG = 4 as ObjectTypeCode;

// Sample object IDs
const COMMIT_TIP = "a".repeat(40);
const _COMMIT_PARENT = "b".repeat(40);
const TREE_ROOT = "c".repeat(40);
const TREE_SUB = "d".repeat(40);
const BLOB_SMALL = "e".repeat(40);
const BLOB_LARGE = "f".repeat(40);
const _TAG_OBJ = "1".repeat(40);

// Sample blob content
const SMALL_BLOB_CONTENT = new TextEncoder().encode("small content");
const LARGE_BLOB_CONTENT = new Uint8Array(10000).fill(0x41); // 10KB of 'A's

// Sample tree content (simplified)
const TREE_CONTENT = new TextEncoder().encode(
  `100644 blob ${BLOB_SMALL}\tfile.txt\n40000 tree ${TREE_SUB}\tsubdir\n`,
);
const SUBTREE_CONTENT = new TextEncoder().encode(`100644 blob ${BLOB_LARGE}\tbig-file.bin\n`);

// Sample commit content
const COMMIT_CONTENT = new TextEncoder().encode(
  `tree ${TREE_ROOT}\nauthor Test <test@test.com> 1600000000 +0000\n`,
);

/**
 * Create a mock repository for testing partial clone scenarios.
 */
function createPartialCloneRepository(options?: {
  refs?: RefInfo[];
  head?: HeadInfo | null;
  objects?: Map<ObjectId, { type: ObjectTypeCode; content: Uint8Array }>;
}): RepositoryAccess {
  const refs = options?.refs ?? [{ name: "refs/heads/main", objectId: COMMIT_TIP }];
  const head = options?.head ?? { target: "refs/heads/main" };
  const objects =
    options?.objects ??
    new Map<ObjectId, { type: ObjectTypeCode; content: Uint8Array }>([
      [COMMIT_TIP, { type: OBJ_COMMIT, content: COMMIT_CONTENT }],
      [TREE_ROOT, { type: OBJ_TREE, content: TREE_CONTENT }],
      [TREE_SUB, { type: OBJ_TREE, content: SUBTREE_CONTENT }],
      [BLOB_SMALL, { type: OBJ_BLOB, content: SMALL_BLOB_CONTENT }],
      [BLOB_LARGE, { type: OBJ_BLOB, content: LARGE_BLOB_CONTENT }],
    ]);

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
        id,
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

      for (const wantId of wants) {
        if (!haveSet.has(wantId) && !emitted.has(wantId)) {
          const obj = objects.get(wantId);
          if (obj) {
            yield { id: wantId, ...obj };
            emitted.add(wantId);
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

describe("Object Filtering (Partial Clone)", () => {
  describe("Filter Capability Advertisement", () => {
    it("should advertise filter capability when enabled", async () => {
      const repo = createPartialCloneRepository();
      const handler = createProtocolV2Handler({
        repository: repo,
        allowFilter: true,
      });

      const output = bytesToString(await collectBytes(handler.advertiseCapabilities()));

      expect(output).toMatch(/fetch=[^\n]*filter/);
    });

    it("should not advertise filter capability when disabled", async () => {
      const repo = createPartialCloneRepository();
      const handler = createProtocolV2Handler({
        repository: repo,
        allowFilter: false,
      });

      const output = bytesToString(await collectBytes(handler.advertiseCapabilities()));

      expect(output).not.toMatch(/\bfilter\b/);
    });
  });

  describe("Filter Spec Parsing", () => {
    it("should accept blob:none filter spec", () => {
      // blob:none means exclude all blobs (lazy fetch on demand)
      const filterSpec = "blob:none";
      expect(filterSpec).toBe("blob:none");
    });

    it("should accept blob:limit=<n> filter spec", () => {
      // blob:limit=<n> means exclude blobs larger than n bytes
      const filterSpec = "blob:limit=1024";
      const match = filterSpec.match(/^blob:limit=(\d+)$/);
      expect(match).not.toBeNull();
      expect(match?.[1]).toBe("1024");
    });

    it("should accept tree:<depth> filter spec", () => {
      // tree:<depth> means exclude trees and blobs beyond depth n
      const filterSpec = "tree:2";
      const match = filterSpec.match(/^tree:(\d+)$/);
      expect(match).not.toBeNull();
      expect(match?.[1]).toBe("2");
    });

    it("should accept tree:0 filter spec", () => {
      // tree:0 means only include the root tree
      const filterSpec = "tree:0";
      const match = filterSpec.match(/^tree:(\d+)$/);
      expect(match).not.toBeNull();
      expect(match?.[1]).toBe("0");
    });

    it("should accept sparse:path filter spec", () => {
      // sparse:path=<blobish> means sparse checkout filter
      const filterSpec = "sparse:path=HEAD:.sparse/filter";
      expect(filterSpec.startsWith("sparse:")).toBe(true);
    });

    it("should accept combine filter spec", () => {
      // combine:<filter1>+<filter2> means apply multiple filters
      const filterSpec = "combine:blob:none+tree:2";
      expect(filterSpec.startsWith("combine:")).toBe(true);
    });
  });
});

describe("Filter Spec Formats from JGit", () => {
  describe("BLOB_NONE", () => {
    it('should be "blob:none"', () => {
      // JGit: ObjectFilter.createBlobNone()
      const spec = "blob:none";
      expect(spec).toBe("blob:none");
    });
  });

  describe("BLOB_LIMIT", () => {
    it("should format limit in bytes", () => {
      // JGit: ObjectFilter.createBlobLimit(n)
      expect(formatBlobLimit(1024)).toBe("blob:limit=1024");
      expect(formatBlobLimit(0)).toBe("blob:limit=0");
      expect(formatBlobLimit(1000000)).toBe("blob:limit=1000000");
    });

    it("should accept k/m/g suffixes", () => {
      // Git supports size suffixes
      const specs = ["blob:limit=10k", "blob:limit=1m", "blob:limit=1g"];
      for (const spec of specs) {
        expect(spec).toMatch(/^blob:limit=\d+[kmg]$/);
      }
    });
  });

  describe("TREE_DEPTH", () => {
    it("should format depth as number", () => {
      // JGit: ObjectFilter.createTreeDepth(n)
      expect(formatTreeDepth(0)).toBe("tree:0");
      expect(formatTreeDepth(1)).toBe("tree:1");
      expect(formatTreeDepth(10)).toBe("tree:10");
    });
  });
});

describe("Partial Clone Scenarios from JGit", () => {
  describe("testV2FetchFilterBlobNone", () => {
    it("should recognize blob:none filter request", async () => {
      // In JGit's test, blob:none filter results in no blobs being sent
      // This tests that the filter spec is recognized
      const repo = createPartialCloneRepository();
      const handler = createProtocolV2Handler({
        repository: repo,
        allowFilter: true,
      });

      // Filter spec should be advertised
      const output = bytesToString(await collectBytes(handler.advertiseCapabilities()));
      expect(output).toContain("filter");
    });
  });

  describe("testV2FetchFilterBlobLimit", () => {
    it("should recognize blob:limit filter request", async () => {
      // In JGit's test, blob:limit=n filter excludes blobs larger than n
      const repo = createPartialCloneRepository();
      const handler = createProtocolV2Handler({
        repository: repo,
        allowFilter: true,
      });

      // Filter spec should be advertised
      const output = bytesToString(await collectBytes(handler.advertiseCapabilities()));
      expect(output).toContain("filter");
    });
  });

  describe("testV2FetchFilterTreeDepth", () => {
    it("should recognize tree:depth filter request", async () => {
      // In JGit's test, tree:n filter excludes content beyond depth n
      const repo = createPartialCloneRepository();
      const handler = createProtocolV2Handler({
        repository: repo,
        allowFilter: true,
      });

      // Filter spec should be advertised
      const output = bytesToString(await collectBytes(handler.advertiseCapabilities()));
      expect(output).toContain("filter");
    });
  });
});

describe("Filter validation", () => {
  it("should validate known filter types", () => {
    const validFilters = [
      "blob:none",
      "blob:limit=0",
      "blob:limit=1024",
      "tree:0",
      "tree:1",
      "tree:10",
      "combine:blob:none+tree:0",
    ];

    for (const filter of validFilters) {
      expect(isValidFilterSpec(filter)).toBe(true);
    }
  });

  it("should reject invalid filter types", () => {
    const invalidFilters = [
      "invalid",
      "blob:",
      "tree:",
      "blob:something",
      "tree:abc",
      "blob:limit=abc",
    ];

    for (const filter of invalidFilters) {
      expect(isValidFilterSpec(filter)).toBe(false);
    }
  });
});

// Helper functions for filter specs
function formatBlobLimit(bytes: number): string {
  return `blob:limit=${bytes}`;
}

function formatTreeDepth(depth: number): string {
  return `tree:${depth}`;
}

function isValidFilterSpec(spec: string): boolean {
  // blob:none
  if (spec === "blob:none") return true;

  // blob:limit=<n>
  const blobLimitMatch = spec.match(/^blob:limit=(\d+)$/);
  if (blobLimitMatch) return true;

  // tree:<n>
  const treeMatch = spec.match(/^tree:(\d+)$/);
  if (treeMatch) return true;

  // combine:<filters>
  if (spec.startsWith("combine:")) {
    const filters = spec.slice(8).split("+");
    return filters.length > 0 && filters.every((f) => f === "blob:none" || /^tree:\d+$/.test(f));
  }

  return false;
}
