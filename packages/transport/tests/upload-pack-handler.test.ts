/**
 * Tests for upload pack handler.
 * Ported from JGit's UploadPackTest.java
 *
 * Tests the server-side handling of git-upload-pack protocol for fetch/clone operations.
 */

import { describe, expect, it } from "vitest";
import type {
  HeadInfo,
  ObjectId,
  ObjectInfo,
  ObjectTypeCode,
  RefInfo,
  RepositoryAccess,
} from "../src/handlers/types.js";
import {
  createUploadPackHandler,
  parseUploadPackRequest,
} from "../src/handlers/upload-pack-handler.js";
import { ZERO_ID } from "../src/protocol/constants.js";

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

// Helper to create async iterable from string
async function* stringToStream(s: string): AsyncGenerator<Uint8Array> {
  yield new TextEncoder().encode(s);
}

// Helper to encode a pkt-line (adds proper length header)
function pktLine(data: string): string {
  const len = (4 + data.length).toString(16).padStart(4, "0");
  return len + data;
}

// Object type codes from git
const OBJ_COMMIT = 1 as ObjectTypeCode;
const OBJ_TREE = 2 as ObjectTypeCode;
const OBJ_BLOB = 3 as ObjectTypeCode;

// Sample object IDs
const COMMIT_A = "a".repeat(40);
const COMMIT_B = "b".repeat(40);
const TREE_A = "1".repeat(40);
const BLOB_A = "2".repeat(40);

// Sample content
const COMMIT_CONTENT = new TextEncoder().encode(`tree ${TREE_A}\nauthor Test\n`);
const TREE_CONTENT = new Uint8Array([]);
const BLOB_CONTENT = new TextEncoder().encode("Hello, World!");

/**
 * Create a mock repository for testing.
 */
function createMockRepository(options?: {
  refs?: RefInfo[];
  head?: HeadInfo | null;
  objects?: Map<ObjectId, { type: ObjectTypeCode; content: Uint8Array }>;
}): RepositoryAccess {
  const refs = options?.refs ?? [
    { name: "refs/heads/master", objectId: COMMIT_A },
    { name: "refs/heads/develop", objectId: COMMIT_B },
  ];
  const head = options?.head ?? { target: "refs/heads/master" };
  const objects =
    options?.objects ??
    new Map([
      [COMMIT_A, { type: OBJ_COMMIT, content: COMMIT_CONTENT }],
      [TREE_A, { type: OBJ_TREE, content: TREE_CONTENT }],
      [BLOB_A, { type: OBJ_BLOB, content: BLOB_CONTENT }],
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
      throw new Error("Not implemented in mock");
    },

    async updateRef(
      _name: string,
      _oldId: ObjectId | null,
      _newId: ObjectId | null,
    ): Promise<boolean> {
      throw new Error("Not implemented in mock");
    },

    async *walkObjects(
      wants: ObjectId[],
      haves: ObjectId[],
    ): AsyncIterable<{ id: ObjectId; type: ObjectTypeCode; content: Uint8Array }> {
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

describe("UploadPackHandler", () => {
  describe("advertise", () => {
    it("should advertise refs with capabilities on first line", async () => {
      const repo = createMockRepository();
      const handler = createUploadPackHandler({ repository: repo });

      const output = bytesToString(await collectBytes(handler.advertise()));

      // First line should have capabilities after null byte
      expect(output).toContain(COMMIT_A);
      expect(output).toContain("refs/heads/master");
      expect(output).toContain("\0");
      expect(output).toContain("side-band-64k");
      expect(output).toContain("ofs-delta");
      expect(output).toContain("no-progress");
    });

    it("should include symref capability for HEAD", async () => {
      const repo = createMockRepository({
        head: { target: "refs/heads/master" },
      });
      const handler = createUploadPackHandler({ repository: repo });

      const output = bytesToString(await collectBytes(handler.advertise()));

      expect(output).toContain("symref=HEAD:refs/heads/master");
    });

    it("should handle detached HEAD", async () => {
      const repo = createMockRepository({
        head: { objectId: COMMIT_A },
      });
      const handler = createUploadPackHandler({ repository: repo });

      const output = bytesToString(await collectBytes(handler.advertise()));

      // Should not include symref when HEAD is detached
      expect(output).not.toContain("symref=HEAD:");
    });

    it("should handle empty repository", async () => {
      const repo = createMockRepository({
        refs: [],
        head: null,
      });
      const handler = createUploadPackHandler({ repository: repo });

      const output = bytesToString(await collectBytes(handler.advertise()));

      // Empty repo should send zero-id with capabilities
      expect(output).toContain(ZERO_ID);
      expect(output).toContain("capabilities^{}");
    });

    it("should include service announcement for HTTP", async () => {
      const repo = createMockRepository();
      const handler = createUploadPackHandler({ repository: repo });

      const output = bytesToString(
        await collectBytes(
          handler.advertise({
            includeServiceAnnouncement: true,
            serviceName: "git-upload-pack",
          }),
        ),
      );

      // Should start with service announcement
      expect(output).toMatch(/^[0-9a-f]{4}# service=git-upload-pack/);
    });

    it("should advertise multiple refs", async () => {
      const repo = createMockRepository({
        refs: [
          { name: "refs/heads/master", objectId: COMMIT_A },
          { name: "refs/heads/feature", objectId: COMMIT_B },
          { name: "refs/tags/v1.0", objectId: COMMIT_A },
        ],
      });
      const handler = createUploadPackHandler({ repository: repo });

      const output = bytesToString(await collectBytes(handler.advertise()));

      expect(output).toContain("refs/heads/master");
      expect(output).toContain("refs/heads/feature");
      expect(output).toContain("refs/tags/v1.0");
    });

    it("should include agent capability", async () => {
      const repo = createMockRepository();
      const handler = createUploadPackHandler({ repository: repo });

      const output = bytesToString(await collectBytes(handler.advertise()));

      expect(output).toContain("agent=webrun-vcs");
    });
  });

  describe("process (want/have negotiation)", () => {
    it("should handle simple want request", async () => {
      const repo = createMockRepository();
      const handler = createUploadPackHandler({ repository: repo });

      // Send want for COMMIT_A
      const request = `0032want ${COMMIT_A}\n00000009done\n`;
      const output = await collectBytes(handler.process(stringToStream(request)));

      // Should respond with NAK and pack data
      const outputStr = bytesToString(output);
      expect(outputStr).toContain("NAK");
    });

    it("should return flush for empty wants", async () => {
      const repo = createMockRepository();
      const handler = createUploadPackHandler({ repository: repo });

      const request = "0000"; // Just flush, no wants
      const output = await collectBytes(handler.process(stringToStream(request)));

      // Should just return flush
      expect(bytesToString(output)).toBe("0000");
    });

    it("should parse capabilities from first want line", async () => {
      const repo = createMockRepository();
      const handler = createUploadPackHandler({ repository: repo });

      // First want with capabilities
      const request =
        pktLine(`want ${COMMIT_A} side-band-64k ofs-delta agent=git/2.0\n`) +
        "0000" +
        pktLine("done\n");

      const output = await collectBytes(handler.process(stringToStream(request)));

      // With sideband, output should be in sideband format
      const outputBytes = output;
      // Sideband data starts after NAK response
      expect(outputBytes.length).toBeGreaterThan(0);
    });

    it("should handle multiple wants", async () => {
      const repo = createMockRepository();
      const handler = createUploadPackHandler({ repository: repo });

      const request = `0032want ${COMMIT_A}\n0032want ${COMMIT_B}\n00000009done\n`;

      const output = await collectBytes(handler.process(stringToStream(request)));
      expect(output.length).toBeGreaterThan(0);
    });
  });

  describe("parseUploadPackRequest", () => {
    it("should parse simple want request", async () => {
      const input = `0032want ${COMMIT_A}\n00000009done\n`;
      const request = await parseUploadPackRequest(stringToStream(input));

      expect(request.wants).toContain(COMMIT_A);
      expect(request.done).toBe(true);
    });

    it("should parse wants with capabilities", async () => {
      const input = `${pktLine(`want ${COMMIT_A} side-band-64k ofs-delta\n`)}0000${pktLine("done\n")}`;
      const request = await parseUploadPackRequest(stringToStream(input));

      expect(request.wants).toContain(COMMIT_A);
      expect(request.capabilities.has("side-band-64k")).toBe(true);
      expect(request.capabilities.has("ofs-delta")).toBe(true);
    });

    it("should parse multiple wants", async () => {
      const input = `0032want ${COMMIT_A}\n0032want ${COMMIT_B}\n00000009done\n`;
      const request = await parseUploadPackRequest(stringToStream(input));

      expect(request.wants).toHaveLength(2);
      expect(request.wants).toContain(COMMIT_A);
      expect(request.wants).toContain(COMMIT_B);
    });

    it("should parse have lines", async () => {
      const input = `0032want ${COMMIT_A}\n00000032have ${COMMIT_B}\n0009done\n`;
      const request = await parseUploadPackRequest(stringToStream(input));

      expect(request.wants).toContain(COMMIT_A);
      expect(request.haves).toContain(COMMIT_B);
    });

    it("should parse depth for shallow clone", async () => {
      const input = `${pktLine(`want ${COMMIT_A}\n`) + pktLine("deepen 1\n")}0000${pktLine("done\n")}`;
      const request = await parseUploadPackRequest(stringToStream(input));

      expect(request.depth).toBe(1);
    });

    it("should parse filter for partial clone", async () => {
      const input = `${pktLine(`want ${COMMIT_A}\n`) + pktLine("filter blob:none\n")}0000${pktLine("done\n")}`;
      const request = await parseUploadPackRequest(stringToStream(input));

      expect(request.filter).toBe("blob:none");
    });
  });
});

describe("Pack generation", () => {
  it("should generate valid pack header", async () => {
    const repo = createMockRepository();
    const handler = createUploadPackHandler({ repository: repo });

    // Simple request without sideband to get raw pack
    const request = `0032want ${COMMIT_A}\n00000009done\n`;
    const output = await collectBytes(handler.process(stringToStream(request)));

    // Skip NAK response, find PACK header
    const outputStr = bytesToString(output);
    const packIndex = outputStr.indexOf("PACK");
    expect(packIndex).toBeGreaterThan(-1);

    // PACK header: "PACK" + version (4 bytes) + object count (4 bytes)
    const packStart = output.slice(packIndex);
    expect(bytesToString(packStart.slice(0, 4))).toBe("PACK");

    // Version should be 2
    const version =
      (packStart[4] << 24) | (packStart[5] << 16) | (packStart[6] << 8) | packStart[7];
    expect(version).toBe(2);
  });

  it("should include all requested objects in pack", async () => {
    const objects = new Map([
      [COMMIT_A, { type: OBJ_COMMIT, content: COMMIT_CONTENT }],
      [TREE_A, { type: OBJ_TREE, content: TREE_CONTENT }],
    ]);
    const repo = createMockRepository({ objects });
    const handler = createUploadPackHandler({ repository: repo });

    const request = `0032want ${COMMIT_A}\n00000009done\n`;
    const output = await collectBytes(handler.process(stringToStream(request)));

    // Should have valid pack with objects
    const outputStr = bytesToString(output);
    expect(outputStr).toContain("PACK");
  });
});

describe("Sideband output", () => {
  it("should send pack via sideband when requested", async () => {
    const repo = createMockRepository();
    const handler = createUploadPackHandler({ repository: repo });

    // Request with side-band-64k capability
    const request = `${pktLine(`want ${COMMIT_A} side-band-64k\n`)}0000${pktLine("done\n")}`;
    const output = await collectBytes(handler.process(stringToStream(request)));

    // Sideband format: length (4 hex) + channel (1 byte) + data
    // Channel 1 = pack data, Channel 2 = progress
    expect(output.length).toBeGreaterThan(0);
  });

  it("should send progress messages on sideband channel 2", async () => {
    const repo = createMockRepository();
    const handler = createUploadPackHandler({ repository: repo });

    const request = `${pktLine(`want ${COMMIT_A} side-band-64k\n`)}0000${pktLine("done\n")}`;
    const output = await collectBytes(handler.process(stringToStream(request)));

    // Look for sideband channel 2 (progress) - byte value 2 after length header
    // Progress messages like "Enumerating objects"
    const outputStr = bytesToString(output);
    expect(outputStr).toContain("Enumerating objects");
  });
});
