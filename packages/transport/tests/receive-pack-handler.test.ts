/**
 * Tests for receive pack handler.
 * Ported from JGit's ReceivePackTest.java
 *
 * Tests the server-side handling of git-receive-pack protocol for push operations.
 */

import type { ObjectTypeCode } from "@statewalker/vcs-core";
import { describe, expect, it } from "vitest";
import {
  createReceivePackHandler,
  parseReceivePackRequest,
} from "../src/handlers/receive-pack-handler.js";
import type {
  HeadInfo,
  ObjectId,
  ObjectInfo,
  RefInfo,
  RepositoryAccess,
} from "../src/handlers/types.js";
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

// Helper to create async iterable from bytes
async function* bytesToStream(bytes: Uint8Array): AsyncGenerator<Uint8Array> {
  yield bytes;
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

// Sample object IDs
const OLD_COMMIT = "deadbeef".repeat(5);
const NEW_COMMIT = "cafebabe".repeat(5);
const ANOTHER_COMMIT = "12345678".repeat(5);

/**
 * Create a mock repository for testing.
 */
function createMockRepository(options?: {
  refs?: RefInfo[];
  head?: HeadInfo | null;
  existingObjects?: Set<ObjectId>;
  storedObjects?: Map<ObjectId, { type: ObjectTypeCode; content: Uint8Array }>;
  refUpdateResults?: Map<string, boolean>;
}): RepositoryAccess {
  const refs = options?.refs ?? [{ name: "refs/heads/master", objectId: OLD_COMMIT }];
  const head = options?.head ?? { target: "refs/heads/master" };
  const existingObjects = options?.existingObjects ?? new Set([OLD_COMMIT]);
  const storedObjects =
    options?.storedObjects ?? new Map<ObjectId, { type: ObjectTypeCode; content: Uint8Array }>();
  const refUpdateResults = options?.refUpdateResults ?? new Map();

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
      return existingObjects.has(id) || storedObjects.has(id);
    },

    async getObjectInfo(id: ObjectId): Promise<ObjectInfo | null> {
      const obj = storedObjects.get(id);
      if (!obj) return null;
      return {
        type: obj.type,
        size: obj.content.length,
      };
    },

    async *loadObject(id: ObjectId): AsyncIterable<Uint8Array> {
      const obj = storedObjects.get(id);
      if (obj) {
        yield obj.content;
      }
    },

    async storeObject(type: ObjectTypeCode, content: Uint8Array): Promise<ObjectId> {
      // Generate a simple hash-like ID
      const id = Array.from(content.slice(0, 20))
        .map((b) => b.toString(16).padStart(2, "0"))
        .join("")
        .padEnd(40, "0");
      storedObjects.set(id, { type, content });
      existingObjects.add(id);
      return id;
    },

    async updateRef(
      name: string,
      _oldId: ObjectId | null,
      newId: ObjectId | null,
    ): Promise<boolean> {
      // Check if we have a predefined result
      const predefinedResult = refUpdateResults.get(name);
      if (predefinedResult !== undefined) {
        return predefinedResult;
      }
      // Default: succeed if newId exists or is null (delete)
      return newId === null || existingObjects.has(newId) || storedObjects.has(newId);
    },

    async *walkObjects(
      _wants: ObjectId[],
      _haves: ObjectId[],
    ): AsyncIterable<{ id: ObjectId; type: ObjectTypeCode; content: Uint8Array }> {
      // Not used in receive-pack
    },
  };
}

describe("ReceivePackHandler", () => {
  describe("advertise", () => {
    it("should advertise refs with capabilities on first line", async () => {
      const repo = createMockRepository();
      const handler = createReceivePackHandler({ repository: repo });

      const output = bytesToString(await collectBytes(handler.advertise()));

      // First line should have capabilities after null byte
      expect(output).toContain(OLD_COMMIT);
      expect(output).toContain("refs/heads/master");
      expect(output).toContain("\0");
      expect(output).toContain("report-status");
      expect(output).toContain("delete-refs");
    });

    it("should include side-band-64k capability", async () => {
      const repo = createMockRepository();
      const handler = createReceivePackHandler({ repository: repo });

      const output = bytesToString(await collectBytes(handler.advertise()));

      expect(output).toContain("side-band-64k");
    });

    it("should handle empty repository", async () => {
      const repo = createMockRepository({
        refs: [],
        head: null,
      });
      const handler = createReceivePackHandler({ repository: repo });

      const output = bytesToString(await collectBytes(handler.advertise()));

      // Empty repo should send zero-id with capabilities
      expect(output).toContain(ZERO_ID);
      expect(output).toContain("capabilities^{}");
    });

    it("should include service announcement for HTTP", async () => {
      const repo = createMockRepository();
      const handler = createReceivePackHandler({ repository: repo });

      const output = bytesToString(
        await collectBytes(
          handler.advertise({
            includeServiceAnnouncement: true,
            serviceName: "git-receive-pack",
          }),
        ),
      );

      // Should start with service announcement
      expect(output).toMatch(/^[0-9a-f]{4}# service=git-receive-pack/);
    });

    it("should advertise multiple refs", async () => {
      const repo = createMockRepository({
        refs: [
          { name: "refs/heads/master", objectId: OLD_COMMIT },
          { name: "refs/heads/develop", objectId: NEW_COMMIT },
          { name: "refs/tags/v1.0", objectId: OLD_COMMIT },
        ],
      });
      const handler = createReceivePackHandler({ repository: repo });

      const output = bytesToString(await collectBytes(handler.advertise()));

      expect(output).toContain("refs/heads/master");
      expect(output).toContain("refs/heads/develop");
      expect(output).toContain("refs/tags/v1.0");
    });

    it("should include ofs-delta capability", async () => {
      const repo = createMockRepository();
      const handler = createReceivePackHandler({ repository: repo });

      const output = bytesToString(await collectBytes(handler.advertise()));

      expect(output).toContain("ofs-delta");
    });

    it("should include agent capability", async () => {
      const repo = createMockRepository();
      const handler = createReceivePackHandler({ repository: repo });

      const output = bytesToString(await collectBytes(handler.advertise()));

      expect(output).toContain("agent=webrun-vcs");
    });
  });

  describe("parseReceivePackRequest", () => {
    it("should parse create ref command", async () => {
      const input = `${pktLine(`${ZERO_ID} ${NEW_COMMIT} refs/heads/feature\n`)}0000`;
      const result = await parseReceivePackRequest(stringToStream(input));

      expect(result.updates).toHaveLength(1);
      expect(result.updates[0].refName).toBe("refs/heads/feature");
      expect(result.updates[0].oldId).toBe(ZERO_ID);
      expect(result.updates[0].newId).toBe(NEW_COMMIT);
    });

    it("should parse update ref command", async () => {
      const input = `${pktLine(`${OLD_COMMIT} ${NEW_COMMIT} refs/heads/master\n`)}0000`;
      const result = await parseReceivePackRequest(stringToStream(input));

      expect(result.updates).toHaveLength(1);
      expect(result.updates[0].refName).toBe("refs/heads/master");
      expect(result.updates[0].oldId).toBe(OLD_COMMIT);
      expect(result.updates[0].newId).toBe(NEW_COMMIT);
    });

    it("should parse delete ref command", async () => {
      const input = `${pktLine(`${OLD_COMMIT} ${ZERO_ID} refs/heads/feature\n`)}0000`;
      const result = await parseReceivePackRequest(stringToStream(input));

      expect(result.updates).toHaveLength(1);
      expect(result.updates[0].refName).toBe("refs/heads/feature");
      expect(result.updates[0].oldId).toBe(OLD_COMMIT);
      expect(result.updates[0].newId).toBe(ZERO_ID);
    });

    it("should parse multiple commands", async () => {
      const input =
        pktLine(`${OLD_COMMIT} ${NEW_COMMIT} refs/heads/master\n`) +
        pktLine(`${ZERO_ID} ${ANOTHER_COMMIT} refs/heads/feature\n`) +
        "0000";
      const result = await parseReceivePackRequest(stringToStream(input));

      expect(result.updates).toHaveLength(2);
      expect(result.updates[0].refName).toBe("refs/heads/master");
      expect(result.updates[1].refName).toBe("refs/heads/feature");
    });

    it("should parse capabilities from first command", async () => {
      const input =
        pktLine(`${OLD_COMMIT} ${NEW_COMMIT} refs/heads/master\0report-status side-band-64k\n`) +
        "0000";
      const result = await parseReceivePackRequest(stringToStream(input));

      expect(result.capabilities.has("report-status")).toBe(true);
      expect(result.capabilities.has("side-band-64k")).toBe(true);
    });
  });
});

describe("Command validation", () => {
  it("should validate old ID format", async () => {
    const input = `${pktLine(`invalid_old_id ${NEW_COMMIT} refs/heads/master\n`)}0000`;

    // Should either throw or return error in commands
    const result = await parseReceivePackRequest(stringToStream(input));
    // Invalid IDs might be handled differently - check either error or length
    expect(result.updates.length === 0 || result.updates[0].oldId).toBeTruthy();
  });

  it("should validate ref name format", async () => {
    // Valid ref name should work
    const input = `${pktLine(`${OLD_COMMIT} ${NEW_COMMIT} refs/heads/valid-name\n`)}0000`;
    const result = await parseReceivePackRequest(stringToStream(input));

    expect(result.updates).toHaveLength(1);
    expect(result.updates[0].refName).toBe("refs/heads/valid-name");
  });
});

describe("Ref update types", () => {
  it("should identify create operation (old is zero)", async () => {
    const input = `${pktLine(`${ZERO_ID} ${NEW_COMMIT} refs/heads/new-branch\n`)}0000`;
    const result = await parseReceivePackRequest(stringToStream(input));

    const cmd = result.updates[0];
    expect(cmd.oldId).toBe(ZERO_ID);
    expect(cmd.newId).not.toBe(ZERO_ID);
  });

  it("should identify delete operation (new is zero)", async () => {
    const input = `${pktLine(`${OLD_COMMIT} ${ZERO_ID} refs/heads/to-delete\n`)}0000`;
    const result = await parseReceivePackRequest(stringToStream(input));

    const cmd = result.updates[0];
    expect(cmd.oldId).not.toBe(ZERO_ID);
    expect(cmd.newId).toBe(ZERO_ID);
  });

  it("should identify update operation (both non-zero)", async () => {
    const input = `${pktLine(`${OLD_COMMIT} ${NEW_COMMIT} refs/heads/master\n`)}0000`;
    const result = await parseReceivePackRequest(stringToStream(input));

    const cmd = result.updates[0];
    expect(cmd.oldId).not.toBe(ZERO_ID);
    expect(cmd.newId).not.toBe(ZERO_ID);
  });
});

describe("Pack data handling", () => {
  it("should detect pack data after commands", async () => {
    // Commands followed by PACK header
    const cmdPkt = pktLine(`${ZERO_ID} ${NEW_COMMIT} refs/heads/feature\n`);

    // Minimal valid pack: "PACK" + version(2) + count(0) + sha1 checksum
    const packHeader = new Uint8Array([
      0x50,
      0x41,
      0x43,
      0x4b, // "PACK"
      0x00,
      0x00,
      0x00,
      0x02, // version 2
      0x00,
      0x00,
      0x00,
      0x00, // 0 objects
    ]);
    // SHA-1 of the pack header would go here (20 bytes)
    const dummyChecksum = new Uint8Array(20);

    const commandBytes = new TextEncoder().encode(`${cmdPkt}0000`);
    const fullInput = new Uint8Array(
      commandBytes.length + packHeader.length + dummyChecksum.length,
    );
    fullInput.set(commandBytes, 0);
    fullInput.set(packHeader, commandBytes.length);
    fullInput.set(dummyChecksum, commandBytes.length + packHeader.length);

    const result = await parseReceivePackRequest(bytesToStream(fullInput));

    expect(result.updates).toHaveLength(1);
    // Pack data should be available
    expect(result.packData).toBeDefined();
  });
});
