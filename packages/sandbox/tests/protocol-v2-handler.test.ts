/**
 * Tests for Protocol V2 handler.
 * Ported from JGit's UploadPackTest.java Protocol V2 tests.
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
const OBJ_TAG = 4 as ObjectTypeCode;

// Sample object IDs
const COMMIT_TIP = "a".repeat(40);
const COMMIT_PARENT = "b".repeat(40);
const TAG_OBJ = "c".repeat(40);

// Sample content
const COMMIT_CONTENT = new TextEncoder().encode(`tree ${"0".repeat(40)}\nauthor Test\n`);
const TAG_CONTENT = new TextEncoder().encode(`object ${COMMIT_TIP}\ntype commit\ntag v1.0\n`);

/**
 * Create a mock repository for testing.
 */
function createMockRepository(options?: {
  refs?: RefInfo[];
  head?: HeadInfo | null;
  objects?: Map<ObjectId, { type: ObjectTypeCode; content: Uint8Array }>;
}): RepositoryAccess {
  const refs = options?.refs ?? [{ name: "refs/heads/master", objectId: COMMIT_TIP }];
  const head = options?.head ?? { target: "refs/heads/master" };
  const objects =
    options?.objects ??
    new Map([
      [COMMIT_TIP, { type: OBJ_COMMIT, content: COMMIT_CONTENT }],
      [TAG_OBJ, { type: OBJ_TAG, content: TAG_CONTENT }],
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
      for (const wantId of wants) {
        if (!haveSet.has(wantId)) {
          const obj = objects.get(wantId);
          if (obj) {
            yield { id: wantId, ...obj };
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

// Helper to create pkt-line format
function pktLine(data: string): Uint8Array {
  const dataBytes = new TextEncoder().encode(data);
  const len = (dataBytes.length + 4).toString(16).padStart(4, "0");
  const lenBytes = new TextEncoder().encode(len);
  const result = new Uint8Array(lenBytes.length + dataBytes.length);
  result.set(lenBytes, 0);
  result.set(dataBytes, lenBytes.length);
  return result;
}

// Helper to create async iterable from string packets
async function* stringsToStream(...packets: string[]): AsyncGenerator<Uint8Array> {
  for (const packet of packets) {
    if (packet === "0000") {
      yield new TextEncoder().encode("0000");
    } else if (packet === "0001") {
      yield new TextEncoder().encode("0001");
    } else {
      yield pktLine(packet);
    }
  }
}

// Helper to create empty stream
async function* emptyStream(): AsyncGenerator<Uint8Array> {
  // yield nothing
}

describe("Protocol V2 Handler", () => {
  describe("advertiseCapabilities", () => {
    it("should advertise version 2", async () => {
      const repo = createMockRepository();
      const handler = createProtocolV2Handler({ repository: repo });

      const output = bytesToString(await collectBytes(handler.advertiseCapabilities()));

      expect(output).toContain("version 2");
    });

    it("should advertise ls-refs command", async () => {
      const repo = createMockRepository();
      const handler = createProtocolV2Handler({ repository: repo });

      const output = bytesToString(await collectBytes(handler.advertiseCapabilities()));

      expect(output).toContain("ls-refs");
    });

    it("should advertise fetch command with shallow capability", async () => {
      const repo = createMockRepository();
      const handler = createProtocolV2Handler({ repository: repo });

      const output = bytesToString(await collectBytes(handler.advertiseCapabilities()));

      expect(output).toContain("fetch=shallow");
    });

    it("should advertise server-option capability", async () => {
      const repo = createMockRepository();
      const handler = createProtocolV2Handler({ repository: repo });

      const output = bytesToString(await collectBytes(handler.advertiseCapabilities()));

      expect(output).toContain("server-option");
    });

    it("should advertise agent", async () => {
      const repo = createMockRepository();
      const handler = createProtocolV2Handler({ repository: repo });

      const output = bytesToString(await collectBytes(handler.advertiseCapabilities()));

      expect(output).toContain("agent=");
    });

    it("should advertise filter when allowed", async () => {
      const repo = createMockRepository();
      const handler = createProtocolV2Handler({
        repository: repo,
        allowFilter: true,
      });

      const output = bytesToString(await collectBytes(handler.advertiseCapabilities()));

      // fetch capability should include filter
      expect(output).toMatch(/fetch=[^\n]*filter/);
    });

    it("should not advertise filter when not allowed", async () => {
      const repo = createMockRepository();
      const handler = createProtocolV2Handler({
        repository: repo,
        allowFilter: false,
      });

      const output = bytesToString(await collectBytes(handler.advertiseCapabilities()));

      // fetch capability should not include filter (but includes shallow)
      expect(output).toContain("fetch=shallow");
      expect(output).not.toMatch(/filter/);
    });
  });

  describe("handleLsRefs", () => {
    it("should list all refs by default", async () => {
      const repo = createMockRepository({
        refs: [
          { name: "refs/heads/master", objectId: COMMIT_TIP },
          { name: "refs/heads/develop", objectId: COMMIT_PARENT },
          { name: "refs/tags/v1.0", objectId: TAG_OBJ },
        ],
        head: { target: "refs/heads/master" },
      });
      const handler = createProtocolV2Handler({ repository: repo });

      const output = bytesToString(await collectBytes(handler.handleLsRefs(emptyStream())));

      expect(output).toContain("refs/heads/master");
      expect(output).toContain("refs/heads/develop");
      expect(output).toContain("refs/tags/v1.0");
    });

    it("should include symref when requested", async () => {
      const repo = createMockRepository({
        refs: [
          { name: "HEAD", objectId: COMMIT_TIP },
          { name: "refs/heads/master", objectId: COMMIT_TIP },
        ],
        head: { target: "refs/heads/master" },
      });
      const handler = createProtocolV2Handler({ repository: repo });

      const output = bytesToString(
        await collectBytes(handler.handleLsRefs(stringsToStream("symrefs\n", "0000"))),
      );

      expect(output).toContain("symref-target:refs/heads/master");
    });

    it("should include peel info when requested", async () => {
      const repo = createMockRepository({
        refs: [
          { name: "refs/heads/master", objectId: COMMIT_TIP },
          {
            name: "refs/tags/v1.0",
            objectId: TAG_OBJ,
            peeledId: COMMIT_TIP,
          },
        ],
      });
      const handler = createProtocolV2Handler({ repository: repo });

      const output = bytesToString(
        await collectBytes(handler.handleLsRefs(stringsToStream("peel\n", "0000"))),
      );

      expect(output).toContain(`peeled:${COMMIT_TIP}`);
    });

    it("should filter refs by prefix", async () => {
      const repo = createMockRepository({
        refs: [
          { name: "refs/heads/master", objectId: COMMIT_TIP },
          { name: "refs/heads/develop", objectId: COMMIT_PARENT },
          { name: "refs/tags/v1.0", objectId: TAG_OBJ },
        ],
      });
      const handler = createProtocolV2Handler({ repository: repo });

      const output = bytesToString(
        await collectBytes(
          handler.handleLsRefs(stringsToStream("ref-prefix refs/heads/mas\n", "0000")),
        ),
      );

      expect(output).toContain("refs/heads/master");
      expect(output).not.toContain("refs/heads/develop");
      expect(output).not.toContain("refs/tags/v1.0");
    });

    it("should handle multiple ref prefixes", async () => {
      const repo = createMockRepository({
        refs: [
          { name: "refs/heads/master", objectId: COMMIT_TIP },
          { name: "refs/heads/other", objectId: COMMIT_PARENT },
          { name: "refs/heads/yetAnother", objectId: COMMIT_TIP },
        ],
      });
      const handler = createProtocolV2Handler({ repository: repo });

      const output = bytesToString(
        await collectBytes(
          handler.handleLsRefs(
            stringsToStream(
              "ref-prefix refs/heads/maste\n",
              "ref-prefix refs/heads/other\n",
              "0000",
            ),
          ),
        ),
      );

      expect(output).toContain("refs/heads/master");
      expect(output).toContain("refs/heads/other");
      expect(output).not.toContain("refs/heads/yetAnother");
    });
  });

  // Note: handleFetch tests require proper pkt-line formatted input streams
  // which need integration with the pkt-line codec. These scenarios are
  // covered by the git-http-server.test.ts integration tests.
  describe("handleFetch", () => {
    it("should return flush for empty request", async () => {
      const repo = createMockRepository({
        refs: [{ name: "refs/heads/master", objectId: COMMIT_TIP }],
      });
      const handler = createProtocolV2Handler({ repository: repo });

      // Empty stream should result in flush (no wants)
      const output = bytesToString(await collectBytes(handler.handleFetch(emptyStream())));

      expect(output).toBe("0000");
    });
  });
});

describe("Protocol V2 Capability Advertisement", () => {
  it("should include all basic capabilities", async () => {
    const repo = createMockRepository();
    const handler = createProtocolV2Handler({
      repository: repo,
      allowFilter: true,
      allowRefInWant: true,
    });

    const output = bytesToString(await collectBytes(handler.advertiseCapabilities()));

    expect(output).toContain("version 2");
    expect(output).toContain("ls-refs");
    expect(output).toContain("fetch=");
    expect(output).toContain("shallow");
    expect(output).toContain("filter");
    expect(output).toContain("ref-in-want");
    expect(output).toContain("server-option");
    expect(output).toContain("agent=");
  });
});
