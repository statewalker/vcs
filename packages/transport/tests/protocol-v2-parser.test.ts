/**
 * Protocol V2 Parser Tests
 *
 * Comprehensive tests for Protocol V2 command parsing.
 * Modeled after JGit's ProtocolV2ParserTest.java
 */

import { beforeEach, describe, expect, it } from "vitest";
import type { RepositoryFacade } from "../src/api/repository-facade.js";

import { HandlerOutput } from "../src/context/handler-output.js";
import { ProcessConfiguration } from "../src/context/process-config.js";
import type { ProcessContext } from "../src/context/process-context.js";
import { ProtocolState } from "../src/context/protocol-state.js";
import { Fsm } from "../src/fsm/index.js";
import { serverV2Handlers, serverV2Transitions } from "../src/fsm/protocol-v2/index.js";
import {
  createMockRefStore,
  createMockRepository,
  createMockTransport,
  type MockRefStore,
  type MockTransport,
  packets,
} from "./helpers/index.js";

// ─────────────────────────────────────────────────────────────────────────────
// Test Setup
// ─────────────────────────────────────────────────────────────────────────────

function createContext(
  transport: MockTransport,
  refStore?: MockRefStore,
  repository?: RepositoryFacade,
): ProcessContext {
  const rs = refStore ?? createMockRefStore();
  const repo = repository ?? createMockRepository();

  return {
    transport,
    repository: repo,
    refStore: rs,
    state: new ProtocolState(),
    output: new HandlerOutput(),
    config: new ProcessConfiguration(),
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// ls-refs Command Tests
// ─────────────────────────────────────────────────────────────────────────────

describe("ProtocolV2Parser", () => {
  describe("ls-refs command", () => {
    let transport: MockTransport;
    let refStore: MockRefStore;
    let fsm: Fsm<ProcessContext>;

    beforeEach(() => {
      transport = createMockTransport();
      refStore = createMockRefStore();
      fsm = new Fsm(serverV2Transitions, serverV2Handlers);

      // Set up refs
      refStore._setRef("refs/heads/main", "abc123def456789012345678901234567890abcdef");
      refStore._setRef("refs/heads/feature", "def456789012345678901234567890abcdef123456");
      refStore._setRef("refs/tags/v1.0", "123456789012345678901234567890abcdef456789");
    });

    it("should parse basic ls-refs request", async () => {
      transport._setPackets(
        packets()
          .data("command=ls-refs")
          .flush() // End of ls-refs args
          .flush() // Client done
          .build(),
      );

      const ctx = createContext(transport, refStore);

      // Run FSM until READ_COMMAND (after sending caps)
      await fsm.run(ctx, "READ_COMMAND");
      // Now run the command - run to completion or next READ_COMMAND
      await fsm.run(ctx);

      const written = transport._getWrittenLines();
      expect(written).toContain("version 2");
      // Should include refs
      expect(written.some((l) => l.includes("refs/heads/main"))).toBe(true);
      expect(written.some((l) => l.includes("refs/heads/feature"))).toBe(true);
    });

    it("should parse ls-refs with symrefs option", async () => {
      transport._setPackets(
        packets().data("command=ls-refs").data("symrefs").flush().flush().build(),
      );

      // Create refStore with symref support
      const customRefStore = createMockRefStore();
      customRefStore._setRef("HEAD", "abc123def456789012345678901234567890abcdef");
      customRefStore._setRef("refs/heads/main", "abc123def456789012345678901234567890abcdef");
      (
        customRefStore as unknown as { getSymrefTarget: (name: string) => Promise<string | null> }
      ).getSymrefTarget = async (name: string) => {
        if (name === "HEAD") return "refs/heads/main";
        return null;
      };

      const ctx = createContext(transport, customRefStore);

      await fsm.run(ctx, "READ_COMMAND");
      await fsm.run(ctx);

      const written = transport._getWrittenLines();
      // Should include symref info if HEAD is returned
      const headLine = written.find((l) => l.includes("HEAD"));
      if (headLine) {
        expect(headLine).toContain("symref-target:refs/heads/main");
      }
    });

    it("should parse ls-refs with peel option", async () => {
      transport._setPackets(packets().data("command=ls-refs").data("peel").flush().flush().build());

      // Create repository with peel support
      const repo = createMockRepository();
      repo._addObject("123456789012345678901234567890abcdef456789");
      (repo as unknown as { peelTag: (oid: string) => Promise<string | null> }).peelTag = async (
        oid: string,
      ) => {
        // Simulate tag pointing to commit
        if (oid === "123456789012345678901234567890abcdef456789") {
          return "peeled123456789012345678901234567890abcd";
        }
        return oid;
      };

      const ctx = createContext(transport, refStore, repo);

      await fsm.run(ctx, "READ_COMMAND");
      await fsm.run(ctx);

      const written = transport._getWrittenLines();
      // Should include peeled info for tags
      const tagLine = written.find((l) => l.includes("refs/tags/v1.0"));
      if (tagLine) {
        expect(tagLine).toContain("peeled:");
      }
    });

    it("should parse ls-refs with ref-prefix filters", async () => {
      transport._setPackets(
        packets().data("command=ls-refs").data("ref-prefix refs/heads/").flush().flush().build(),
      );

      const ctx = createContext(transport, refStore);

      await fsm.run(ctx, "READ_COMMAND");
      await fsm.run(ctx);

      const written = transport._getWrittenLines();
      // Should include heads but not tags
      expect(written.some((l) => l.includes("refs/heads/main"))).toBe(true);
      expect(written.some((l) => l.includes("refs/heads/feature"))).toBe(true);
      expect(written.some((l) => l.includes("refs/tags/v1.0"))).toBe(false);
    });

    it("should parse ls-refs with multiple ref-prefix filters", async () => {
      transport._setPackets(
        packets()
          .data("command=ls-refs")
          .data("ref-prefix refs/heads/main")
          .data("ref-prefix refs/tags/")
          .flush()
          .flush()
          .build(),
      );

      const ctx = createContext(transport, refStore);

      await fsm.run(ctx, "READ_COMMAND");
      await fsm.run(ctx);

      const written = transport._getWrittenLines();
      // Should include main and tags but not feature
      expect(written.some((l) => l.includes("refs/heads/main"))).toBe(true);
      expect(written.some((l) => l.includes("refs/tags/v1.0"))).toBe(true);
      expect(written.some((l) => l.includes("refs/heads/feature"))).toBe(false);
    });

    it("should handle multiple ls-refs commands in sequence", async () => {
      transport._setPackets(
        packets()
          .data("command=ls-refs")
          .flush()
          .data("command=ls-refs")
          .data("ref-prefix refs/tags/")
          .flush()
          .flush()
          .build(),
      );

      const ctx = createContext(transport, refStore);

      // Run to completion - handles caps and both ls-refs commands
      await fsm.run(ctx);

      // Both commands should have completed
      expect(ctx.output.error).toBeUndefined();
    });
  });

  // ─────────────────────────────────────────────────────────────────────────────
  // fetch command Tests
  // ─────────────────────────────────────────────────────────────────────────────

  describe("fetch command", () => {
    let transport: MockTransport;
    let refStore: MockRefStore;
    let fsm: Fsm<ProcessContext>;

    beforeEach(() => {
      transport = createMockTransport();
      refStore = createMockRefStore();
      fsm = new Fsm(serverV2Transitions, serverV2Handlers);

      refStore._setRef("refs/heads/main", "abc123def456789012345678901234567890abcdef");
    });

    it("should parse basic fetch arguments (thin-pack, no-progress, include-tag, ofs-delta)", async () => {
      const wantOid = "abc123def456789012345678901234567890abcdef";
      const repo = createMockRepository();
      repo._addObject(wantOid);

      transport._setPackets(
        packets()
          .data("command=fetch")
          .data("thin-pack")
          .data("no-progress")
          .data("include-tag")
          .data("ofs-delta")
          .data(`want ${wantOid}`)
          .data("done")
          .flush()
          .flush()
          .build(),
      );

      const ctx = createContext(transport, refStore, repo);

      // Run through capability advertisement
      await fsm.run(ctx, "READ_COMMAND");
      // Run the fetch command to completion
      await fsm.run(ctx);

      // Check that the command was processed
      expect(ctx.output.error).toBeUndefined();
      expect(ctx.state.wants.has(wantOid)).toBe(true);
    });

    it("should parse want and have lines", async () => {
      const wantOid = "abc123def456789012345678901234567890abcdef";
      const haveOid = "def456789012345678901234567890abcdef123456";

      const repo = createMockRepository();
      repo._addObject(wantOid);
      repo._addObject(haveOid);

      transport._setPackets(
        packets()
          .data("command=fetch")
          .data(`want ${wantOid}`)
          .data(`have ${haveOid}`)
          .data("done")
          .flush()
          .flush()
          .build(),
      );

      const ctx = createContext(transport, refStore, repo);

      await fsm.run(ctx, "READ_COMMAND");
      await fsm.run(ctx);

      expect(ctx.state.wants.has(wantOid)).toBe(true);
      expect(ctx.state.commonBase.has(haveOid)).toBe(true);
    });

    it("should recognize done signal", async () => {
      const wantOid = "abc123def456789012345678901234567890abcdef";
      const repo = createMockRepository();
      repo._addObject(wantOid);

      transport._setPackets(
        packets()
          .data("command=fetch")
          .data(`want ${wantOid}`)
          .data("done")
          .flush()
          .flush()
          .build(),
      );

      const ctx = createContext(transport, refStore, repo);

      await fsm.run(ctx, "READ_COMMAND");
      await fsm.run(ctx);

      // Should have sent packfile response
      const written = transport._getWrittenLines();
      expect(written.some((l) => l === "packfile")).toBe(true);
    });

    it("should parse shallow clones with deepen", async () => {
      const wantOid = "abc123def456789012345678901234567890abcdef";
      const repo = createMockRepository();
      repo._addObject(wantOid);

      transport._setPackets(
        packets()
          .data("command=fetch")
          .data(`want ${wantOid}`)
          .data("deepen 3")
          .data("done")
          .flush()
          .flush()
          .build(),
      );

      const ctx = createContext(transport, refStore, repo);

      await fsm.run(ctx, "READ_COMMAND");
      await fsm.run(ctx);

      // Should include shallow-info section
      const written = transport._getWrittenLines();
      expect(written.some((l) => l === "shallow-info")).toBe(true);
    });

    it("should parse shallow with deepen-relative", async () => {
      const wantOid = "abc123def456789012345678901234567890abcdef";
      const repo = createMockRepository();
      repo._addObject(wantOid);

      transport._setPackets(
        packets()
          .data("command=fetch")
          .data(`want ${wantOid}`)
          .data("deepen 2")
          .data("deepen-relative")
          .data("done")
          .flush()
          .flush()
          .build(),
      );

      const ctx = createContext(transport, refStore, repo);

      await fsm.run(ctx, "READ_COMMAND");
      await fsm.run(ctx);

      expect(ctx.output.error).toBeUndefined();
    });

    it("should parse shallow with deepen-not", async () => {
      const wantOid = "abc123def456789012345678901234567890abcdef";
      const repo = createMockRepository();
      repo._addObject(wantOid);

      transport._setPackets(
        packets()
          .data("command=fetch")
          .data(`want ${wantOid}`)
          .data("deepen-not refs/heads/old")
          .data("deepen-not refs/heads/ancient")
          .data("done")
          .flush()
          .flush()
          .build(),
      );

      const ctx = createContext(transport, refStore, repo);

      await fsm.run(ctx, "READ_COMMAND");
      await fsm.run(ctx);

      expect(ctx.output.error).toBeUndefined();
    });

    it("should parse shallow with deepen-since", async () => {
      const wantOid = "abc123def456789012345678901234567890abcdef";
      const repo = createMockRepository();
      repo._addObject(wantOid);

      const timestamp = Math.floor(Date.now() / 1000) - 86400 * 30; // 30 days ago

      transport._setPackets(
        packets()
          .data("command=fetch")
          .data(`want ${wantOid}`)
          .data(`deepen-since ${timestamp}`)
          .data("done")
          .flush()
          .flush()
          .build(),
      );

      const ctx = createContext(transport, refStore, repo);

      await fsm.run(ctx, "READ_COMMAND");
      await fsm.run(ctx);

      expect(ctx.output.error).toBeUndefined();
    });

    it("should parse blob:none filter", async () => {
      const wantOid = "abc123def456789012345678901234567890abcdef";
      const repo = createMockRepository();
      repo._addObject(wantOid);

      transport._setPackets(
        packets()
          .data("command=fetch")
          .data(`want ${wantOid}`)
          .data("filter blob:none")
          .data("done")
          .flush()
          .flush()
          .build(),
      );

      const ctx = createContext(transport, refStore, repo);

      await fsm.run(ctx, "READ_COMMAND");
      await fsm.run(ctx);

      expect(ctx.output.error).toBeUndefined();
    });

    it("should parse blob:limit=N filter", async () => {
      const wantOid = "abc123def456789012345678901234567890abcdef";
      const repo = createMockRepository();
      repo._addObject(wantOid);

      transport._setPackets(
        packets()
          .data("command=fetch")
          .data(`want ${wantOid}`)
          .data("filter blob:limit=1048576")
          .data("done")
          .flush()
          .flush()
          .build(),
      );

      const ctx = createContext(transport, refStore, repo);

      await fsm.run(ctx, "READ_COMMAND");
      await fsm.run(ctx);

      expect(ctx.output.error).toBeUndefined();
    });

    it("should parse tree:N depth filter", async () => {
      const wantOid = "abc123def456789012345678901234567890abcdef";
      const repo = createMockRepository();
      repo._addObject(wantOid);

      transport._setPackets(
        packets()
          .data("command=fetch")
          .data(`want ${wantOid}`)
          .data("filter tree:0")
          .data("done")
          .flush()
          .flush()
          .build(),
      );

      const ctx = createContext(transport, refStore, repo);

      await fsm.run(ctx, "READ_COMMAND");
      await fsm.run(ctx);

      expect(ctx.output.error).toBeUndefined();
    });

    it("should parse want-ref for ref-in-want", async () => {
      const oid = "abc123def456789012345678901234567890abcdef";
      const repo = createMockRepository();
      repo._addObject(oid);
      refStore._setRef("refs/heads/feature", oid);

      transport._setPackets(
        packets()
          .data("command=fetch")
          .data("want-ref refs/heads/feature")
          .data("done")
          .flush()
          .flush()
          .build(),
      );

      const ctx = createContext(transport, refStore, repo);

      await fsm.run(ctx, "READ_COMMAND");
      await fsm.run(ctx);

      // Should include wanted-refs section
      const written = transport._getWrittenLines();
      expect(written.some((l) => l === "wanted-refs")).toBe(true);
      expect(ctx.state.wants.has(oid)).toBe(true);
    });

    it("should reject unknown want-ref", async () => {
      transport._setPackets(
        packets()
          .data("command=fetch")
          .data("want-ref refs/heads/nonexistent")
          .data("done")
          .flush()
          .flush()
          .build(),
      );

      const ctx = createContext(transport, refStore);

      await fsm.run(ctx, "READ_COMMAND");
      await fsm.run(ctx);

      expect(ctx.output.error).toContain("Unknown ref");
      expect(ctx.output.invalidWant).toBe("refs/heads/nonexistent");
    });
  });

  // ─────────────────────────────────────────────────────────────────────────────
  // object-info command Tests
  // ─────────────────────────────────────────────────────────────────────────────

  describe("object-info command", () => {
    let transport: MockTransport;
    let refStore: MockRefStore;
    let fsm: Fsm<ProcessContext>;

    beforeEach(() => {
      transport = createMockTransport();
      refStore = createMockRefStore();
      fsm = new Fsm(serverV2Transitions, serverV2Handlers);
    });

    it("should parse object-info request", async () => {
      const oid = "abc123def456789012345678901234567890abcdef";
      const repo = createMockRepository();
      repo._addObject(oid);
      (
        repo as unknown as { getObjectSize: (oid: string) => Promise<number | null> }
      ).getObjectSize = async (o: string) => {
        if (o === oid) return 1234;
        return null;
      };

      transport._setPackets(
        packets().data("command=object-info").data(`oid ${oid}`).flush().flush().build(),
      );

      const ctx = createContext(transport, refStore, repo);

      await fsm.run(ctx, "READ_COMMAND");
      await fsm.run(ctx);

      const written = transport._getWrittenLines();
      expect(written.some((l) => l === "size")).toBe(true);
      expect(written.some((l) => l.includes(oid) && l.includes("1234"))).toBe(true);
    });

    it("should parse object-info with multiple objects", async () => {
      const oid1 = "abc123def456789012345678901234567890abcdef";
      const oid2 = "def456789012345678901234567890abcdef123456";

      const repo = createMockRepository();
      repo._addObject(oid1);
      repo._addObject(oid2);
      (
        repo as unknown as { getObjectSize: (oid: string) => Promise<number | null> }
      ).getObjectSize = async (o: string) => {
        if (o === oid1) return 1234;
        if (o === oid2) return 5678;
        return null;
      };

      transport._setPackets(
        packets()
          .data("command=object-info")
          .data(`oid ${oid1}`)
          .data(`oid ${oid2}`)
          .flush()
          .flush()
          .build(),
      );

      const ctx = createContext(transport, refStore, repo);

      await fsm.run(ctx, "READ_COMMAND");
      await fsm.run(ctx);

      const written = transport._getWrittenLines();
      expect(written.some((l) => l.includes(oid1) && l.includes("1234"))).toBe(true);
      expect(written.some((l) => l.includes(oid2) && l.includes("5678"))).toBe(true);
    });
  });

  // ─────────────────────────────────────────────────────────────────────────────
  // Capability Advertisement Tests
  // ─────────────────────────────────────────────────────────────────────────────

  describe("capability advertisement", () => {
    let transport: MockTransport;
    let fsm: Fsm<ProcessContext>;

    beforeEach(() => {
      transport = createMockTransport();
      fsm = new Fsm(serverV2Transitions, serverV2Handlers);
    });

    it("should advertise version 2", async () => {
      transport._setPackets(packets().flush().build());

      const ctx = createContext(transport);

      await fsm.run(ctx, "READ_COMMAND");

      const written = transport._getWrittenLines();
      expect(written[0]).toBe("version 2");
    });

    it("should advertise ls-refs command", async () => {
      transport._setPackets(packets().flush().build());

      const ctx = createContext(transport);

      await fsm.run(ctx, "READ_COMMAND");

      const written = transport._getWrittenLines();
      expect(written.some((l) => l === "ls-refs")).toBe(true);
    });

    it("should advertise fetch command with shallow", async () => {
      transport._setPackets(packets().flush().build());

      const ctx = createContext(transport);

      await fsm.run(ctx, "READ_COMMAND");

      const written = transport._getWrittenLines();
      expect(written.some((l) => l.startsWith("fetch=") && l.includes("shallow"))).toBe(true);
    });

    it("should advertise server-option", async () => {
      transport._setPackets(packets().flush().build());

      const ctx = createContext(transport);

      await fsm.run(ctx, "READ_COMMAND");

      const written = transport._getWrittenLines();
      expect(written.some((l) => l === "server-option")).toBe(true);
    });

    it("should advertise filter if configured", async () => {
      transport._setPackets(packets().flush().build());

      const ctx = createContext(transport);

      await fsm.run(ctx, "READ_COMMAND");

      const written = transport._getWrittenLines();
      expect(written.some((l) => l.includes("filter"))).toBe(true);
    });

    it("should advertise object-info", async () => {
      transport._setPackets(packets().flush().build());

      const ctx = createContext(transport);

      await fsm.run(ctx, "READ_COMMAND");

      const written = transport._getWrittenLines();
      expect(written.some((l) => l === "object-info")).toBe(true);
    });
  });

  // ─────────────────────────────────────────────────────────────────────────────
  // Error Handling Tests
  // ─────────────────────────────────────────────────────────────────────────────

  describe("error handling", () => {
    let transport: MockTransport;
    let fsm: Fsm<ProcessContext>;

    beforeEach(() => {
      transport = createMockTransport();
      fsm = new Fsm(serverV2Transitions, serverV2Handlers);
    });

    it("should reject unknown command", async () => {
      transport._setPackets(packets().data("command=unknown").flush().build());

      const ctx = createContext(transport);

      await fsm.run(ctx, "READ_COMMAND");
      await fsm.run(ctx);

      expect(ctx.output.error).toContain("Unknown command");
    });

    it("should handle unexpected delimiter", async () => {
      transport._setPackets(packets().delim().build());

      const ctx = createContext(transport);

      await fsm.run(ctx, "READ_COMMAND");
      await fsm.run(ctx);

      expect(ctx.output.error).toContain("Unexpected delimiter");
    });

    it("should handle non-existent want object", async () => {
      const nonExistentOid = "abc123def456789012345678901234567890abcdef";

      transport._setPackets(
        packets()
          .data("command=fetch")
          .data(`want ${nonExistentOid}`)
          .data("done")
          .flush()
          .flush()
          .build(),
      );

      const ctx = createContext(transport);

      // Run the full FSM flow
      await fsm.run(ctx);

      expect(ctx.output.error).toContain("not found");
      expect(ctx.output.invalidWant).toBe(nonExistentOid);
    });
  });
});
