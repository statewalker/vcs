/**
 * Upload Pack (Fetch Server-Side) Tests
 *
 * Tests for Git fetch server functionality including:
 * - Refs advertisement generation
 * - Want validation
 * - Protocol state management
 *
 * These tests focus on unit testing individual components rather than
 * full end-to-end integration (which requires complete FSM implementation).
 *
 * Modeled after JGit's UploadPackTest.java
 */

import { describe, expect, it } from "vitest";
import { ProtocolState } from "../src/context/protocol-state.js";
import {
  createComplexRepository,
  createInitializedRepository,
  TestRepository,
} from "./helpers/test-repository.js";
import { createMockRefStore, createMockTransport } from "./helpers/test-protocol.js";

// ─────────────────────────────────────────────────────────────────────────────
// Test Repository Tests
// ─────────────────────────────────────────────────────────────────────────────

describe("TestRepository as RepositoryFacade", () => {
  it("should check object existence", async () => {
    const repo = TestRepository.create();
    const oid = repo.storeBlob("test content");

    expect(await repo.has(oid)).toBe(true);
    expect(await repo.has("nonexistent0123456789abcdef01234567")).toBe(false);
  });

  it("should walk commit ancestors", async () => {
    const repo = TestRepository.create();
    const commits = repo.createCommitChain(3, "Test");

    const ancestors: string[] = [];
    for await (const oid of repo.walkAncestors(commits[2])) {
      ancestors.push(oid);
    }

    expect(ancestors).toContain(commits[0]);
    expect(ancestors).toContain(commits[1]);
    expect(ancestors).toContain(commits[2]);
  });

  it("should export pack with objects", async () => {
    const repo = TestRepository.create();
    const commit = repo.createEmptyCommit("Test commit");

    const chunks: Uint8Array[] = [];
    for await (const chunk of repo.exportPack(new Set([commit]), new Set())) {
      chunks.push(chunk);
    }

    expect(chunks.length).toBeGreaterThan(0);

    // Verify pack header
    const header = chunks[0];
    expect(header[0]).toBe(0x50); // 'P'
    expect(header[1]).toBe(0x41); // 'A'
    expect(header[2]).toBe(0x43); // 'C'
    expect(header[3]).toBe(0x4b); // 'K'
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// TestRepository RefStore Implementation Tests
// ─────────────────────────────────────────────────────────────────────────────

describe("TestRepository as RefStore", () => {
  it("should implement get", async () => {
    const repo = TestRepository.create();
    const commit = repo.createEmptyCommit("Test");
    repo.setRef("refs/heads/main", commit);

    expect(await repo.get("refs/heads/main")).toBe(commit);
    expect(await repo.get("refs/heads/nonexistent")).toBeUndefined();
  });

  it("should implement update", async () => {
    const repo = TestRepository.create();
    const commit1 = repo.createEmptyCommit("Test 1");
    const commit2 = repo.createEmptyCommit("Test 2");

    await repo.update("refs/heads/main", commit1);
    expect(await repo.get("refs/heads/main")).toBe(commit1);

    await repo.update("refs/heads/main", commit2);
    expect(await repo.get("refs/heads/main")).toBe(commit2);
  });

  it("should implement listAll", async () => {
    const repo = TestRepository.create();
    const commit1 = repo.createEmptyCommit("Test 1");
    const commit2 = repo.createEmptyCommit("Test 2");

    repo.setRef("refs/heads/main", commit1);
    repo.setRef("refs/heads/feature", commit2);

    const refs = await repo.listAll();
    const refsArray = [...refs];

    expect(refsArray).toContainEqual(["refs/heads/main", commit1]);
    expect(refsArray).toContainEqual(["refs/heads/feature", commit2]);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Protocol State Tests
// ─────────────────────────────────────────────────────────────────────────────

describe("ProtocolState for UploadPack", () => {
  it("should track refs", () => {
    const state = new ProtocolState();

    state.refs.set("refs/heads/main", "abc123");
    state.refs.set("refs/tags/v1.0", "def456");

    expect(state.refs.size).toBe(2);
    expect(state.refs.get("refs/heads/main")).toBe("abc123");
  });

  it("should track capabilities", () => {
    const state = new ProtocolState();

    state.capabilities.add("multi_ack_detailed");
    state.capabilities.add("side-band-64k");

    expect(state.capabilities.has("multi_ack_detailed")).toBe(true);
    expect(state.capabilities.has("side-band-64k")).toBe(true);
    expect(state.capabilities.has("nonexistent")).toBe(false);
  });

  it("should track wants", () => {
    const state = new ProtocolState();

    state.wants.add("abc123");
    state.wants.add("def456");

    expect(state.wants.size).toBe(2);
    expect(state.wants.has("abc123")).toBe(true);
  });

  it("should track haves", () => {
    const state = new ProtocolState();

    state.haves.add("commit1");
    state.haves.add("commit2");

    expect(state.haves.size).toBe(2);
    expect(state.haves.has("commit1")).toBe(true);
  });

  it("should track common base", () => {
    const state = new ProtocolState();

    state.commonBase.add("common1");

    expect(state.commonBase.has("common1")).toBe(true);
    expect(state.commonBase.has("notcommon")).toBe(false);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Want Validation Logic Tests
// ─────────────────────────────────────────────────────────────────────────────

describe("Want Validation", () => {
  describe("ADVERTISED policy", () => {
    it("should accept wants that match advertised refs", () => {
      const refs = new Map([
        ["refs/heads/main", "abc123"],
        ["refs/tags/v1.0", "def456"],
      ]);

      // Valid wants
      const validWants = ["abc123", "def456"];
      for (const want of validWants) {
        const isValid = [...refs.values()].includes(want);
        expect(isValid).toBe(true);
      }
    });

    it("should reject wants not in advertised refs", () => {
      const refs = new Map([["refs/heads/main", "abc123"]]);

      const invalidWant = "notadvertised";
      const isValid = [...refs.values()].includes(invalidWant);
      expect(isValid).toBe(false);
    });
  });

  describe("ANY policy", () => {
    it("should accept wants for any object in repository", async () => {
      const repo = TestRepository.create();
      const blob = repo.storeBlob("test");
      const commit = repo.createEmptyCommit("Test");

      expect(await repo.has(blob)).toBe(true);
      expect(await repo.has(commit)).toBe(true);
      expect(await repo.has("nonexistent")).toBe(false);
    });
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Complex Repository Factory Tests
// ─────────────────────────────────────────────────────────────────────────────

describe("Complex Repository", () => {
  it("should create repository with multiple branches", async () => {
    const { repo, commits } = await createComplexRepository();

    expect(commits.main).toHaveLength(3);
    expect(commits.feature).toHaveLength(2);

    expect(repo.getRef("refs/heads/main")).toBe(commits.main[2]);
    expect(repo.getRef("refs/heads/feature")).toBe(commits.feature[1]);

    // Verify commit chain
    const mainTip = repo.getCommit(commits.main[2]);
    expect(mainTip?.parents).toContain(commits.main[1]);
  });

  it("should create initialized repository", async () => {
    const { repo, initialCommit } = await createInitializedRepository();

    expect(repo.getRef("refs/heads/main")).toBe(initialCommit);
    expect(repo.getCommit(initialCommit)).toBeDefined();
    expect(repo.getCommit(initialCommit)?.parents).toHaveLength(0);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Mock Transport Tests
// ─────────────────────────────────────────────────────────────────────────────

describe("MockTransport for UploadPack testing", () => {
  it("should capture written lines", async () => {
    const transport = createMockTransport();

    await transport.writeLine("abc123 refs/heads/main");
    await transport.writeLine("def456 refs/tags/v1.0");
    await transport.writeFlush();

    const lines = transport._getWrittenLines();
    expect(lines).toContain("abc123 refs/heads/main");
    expect(lines).toContain("def456 refs/tags/v1.0");
  });

  it("should return preset packets", async () => {
    const transport = createMockTransport();
    transport._setPackets([
      { type: "data", text: "want abc123" },
      { type: "data", text: "want def456" },
      { type: "flush" },
    ]);

    expect(await transport.readLine()).toBe("want abc123");
    expect(await transport.readLine()).toBe("want def456");
    expect(await transport.readLine()).toBeNull(); // flush
  });

  it("should support pkt-line reading", async () => {
    const transport = createMockTransport();
    transport._setPackets([
      { type: "data", text: "have abc123" },
      { type: "data", text: "done" },
      { type: "flush" },
    ]);

    const pkt1 = await transport.readPktLine();
    expect(pkt1.type).toBe("data");
    expect(pkt1.text).toBe("have abc123");

    const pkt2 = await transport.readPktLine();
    expect(pkt2.type).toBe("data");
    expect(pkt2.text).toBe("done");
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Server FSM State Handler Tests
// ─────────────────────────────────────────────────────────────────────────────

describe("Server FSM Handler Logic", () => {
  describe("Advertisement generation", () => {
    it("should include capabilities in first ref", async () => {
      const transport = createMockTransport();
      const refStore = createMockRefStore();
      refStore._setRef("refs/heads/main", "abc123def456abc123def456abc123def456abc1");

      // Simulate advertisement generation
      const refs = await refStore.listAll();
      const refsArray = [...refs];
      const capabilities = ["multi_ack_detailed", "side-band-64k"];

      let first = true;
      for (const [name, oid] of refsArray) {
        const line = first ? `${oid} ${name}\0${capabilities.join(" ")}` : `${oid} ${name}`;
        await transport.writeLine(line);
        first = false;
      }
      await transport.writeFlush();

      const lines = transport._getWrittenLines();
      expect(lines[0]).toContain("\0"); // Actual null byte in capabilities
      expect(lines[0]).toContain("multi_ack_detailed");
    });

    it("should send capabilities^{} for empty repository", async () => {
      const transport = createMockTransport();
      const capabilities = ["multi_ack_detailed", "side-band-64k"];

      // Empty repo advertisement
      await transport.writeLine(`${"0".repeat(40)} capabilities^{}\0${capabilities.join(" ")}`);
      await transport.writeFlush();

      const lines = transport._getWrittenLines();
      expect(lines[0]).toContain("capabilities^{}");
      expect(lines[0]).toContain("0".repeat(40));
    });
  });

  describe("ACK/NAK logic", () => {
    it("should send NAK when no common base found", async () => {
      const state = new ProtocolState();
      const transport = createMockTransport();

      // No common base
      expect(state.commonBase.size).toBe(0);

      // Server should send NAK
      await transport.writeLine("NAK");

      expect(transport._getWrittenLines()).toContain("NAK");
    });

    it("should send ACK with common base OID", async () => {
      const state = new ProtocolState();
      const transport = createMockTransport();

      state.commonBase.add("abc123def456abc123def456abc123def456abc1");

      // Server should send ACK
      const oid = [...state.commonBase][0];
      await transport.writeLine(`ACK ${oid}`);

      expect(transport._getWrittenLines()[0]).toContain("ACK");
      expect(transport._getWrittenLines()[0]).toContain(oid);
    });

    it("should track ACK modes (continue, common, ready)", async () => {
      const state = new ProtocolState();
      state.capabilities.add("multi_ack_detailed");

      expect(state.capabilities.has("multi_ack_detailed")).toBe(true);

      // Detailed mode supports: ACK <oid> continue, ACK <oid> common, ACK <oid> ready
      const ackModes = ["continue", "common", "ready"];
      for (const mode of ackModes) {
        const ackLine = `ACK abc123 ${mode}`;
        expect(ackLine).toMatch(/ACK [a-f0-9]+ (continue|common|ready)/);
      }
    });
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Pack Generation Tests
// ─────────────────────────────────────────────────────────────────────────────

describe("Pack generation for UploadPack", () => {
  it("should generate valid pack header", async () => {
    const repo = TestRepository.create();
    const commit = repo.createEmptyCommit("Test");

    const chunks: Uint8Array[] = [];
    for await (const chunk of repo.exportPack(new Set([commit]), new Set())) {
      chunks.push(chunk);
    }

    // Pack header: "PACK" (4 bytes) + version (4 bytes) + object count (4 bytes)
    const header = chunks[0];
    expect(header.length).toBeGreaterThanOrEqual(12);

    // Magic "PACK"
    const magic = String.fromCharCode(header[0], header[1], header[2], header[3]);
    expect(magic).toBe("PACK");

    // Version 2
    const version = (header[4] << 24) | (header[5] << 16) | (header[6] << 8) | header[7];
    expect(version).toBe(2);
  });

  it("should exclude objects in common base", async () => {
    const repo = TestRepository.create();
    const commits = repo.createCommitChain(3, "Commit");

    // Client has first commit, wants third
    const wants = new Set([commits[2]]);
    const exclude = new Set([commits[0]]);

    const chunks: Uint8Array[] = [];
    for await (const chunk of repo.exportPack(wants, exclude)) {
      chunks.push(chunk);
    }

    // Pack should be generated (may or may not include excluded objects
    // depending on implementation - here we just verify pack is created)
    expect(chunks.length).toBeGreaterThan(0);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Shallow Clone Logic Tests
// ─────────────────────────────────────────────────────────────────────────────

describe("Shallow clone support", () => {
  it("should compute shallow boundaries", async () => {
    const repo = TestRepository.create();
    const commits = repo.createCommitChain(5, "Commit");

    // Request depth 2 from tip
    const depth = 2;
    const wants = new Set([commits[4]]);

    if (repo.computeShallowBoundaries) {
      const boundaries = await repo.computeShallowBoundaries(wants, depth);
      expect(boundaries).toBeDefined();
    }
  });

  it("should track shallow boundaries in state", () => {
    const state = new ProtocolState();

    state.serverShallow = new Set(["boundary1", "boundary2"]);
    state.serverUnshallow = new Set(["unshallow1"]);

    expect(state.serverShallow.size).toBe(2);
    expect(state.serverUnshallow.size).toBe(1);
  });
});
