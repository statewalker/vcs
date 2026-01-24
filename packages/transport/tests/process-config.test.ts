/**
 * Process Configuration Tests
 * Tests for FSM configuration options.
 * Covers transfer config and push options.
 */

import { describe, expect, it } from "vitest";
import { ProcessConfiguration } from "../src/context/process-config.js";

describe("ProcessConfiguration", () => {
  describe("constructor defaults", () => {
    it("should create with undefined defaults", () => {
      const config = new ProcessConfiguration();

      expect(config.maxHaves).toBeUndefined();
      expect(config.localHead).toBeUndefined();
      expect(config.wantedRefs).toBeUndefined();
      expect(config.serverCapabilities).toBeUndefined();
      expect(config.thinPack).toBeUndefined();
      expect(config.sideBand).toBeUndefined();
    });
  });

  describe("fetch configuration", () => {
    it("should set maxHaves for negotiation limit", () => {
      const config = new ProcessConfiguration();
      config.maxHaves = 256;

      expect(config.maxHaves).toBe(256);
    });

    it("should set localHead for ancestry walk", () => {
      const config = new ProcessConfiguration();
      config.localHead = "refs/heads/main";

      expect(config.localHead).toBe("refs/heads/main");
    });

    it("should set wantedRefs for fetch targets", () => {
      const config = new ProcessConfiguration();
      config.wantedRefs = new Map([
        ["refs/heads/main", "abc123".padEnd(40, "0")],
        ["refs/heads/feature", "def456".padEnd(40, "0")],
      ]);

      expect(config.wantedRefs?.size).toBe(2);
      expect(config.wantedRefs?.has("refs/heads/main")).toBe(true);
    });

    it("should set thinPack option", () => {
      const config = new ProcessConfiguration();
      config.thinPack = true;

      expect(config.thinPack).toBe(true);
    });

    it("should set sideBand option", () => {
      const config = new ProcessConfiguration();
      config.sideBand = true;

      expect(config.sideBand).toBe(true);
    });

    it("should set onProgress callback", () => {
      const config = new ProcessConfiguration();
      const messages: string[] = [];
      config.onProgress = (msg) => messages.push(msg);

      config.onProgress?.("Counting objects: 10");
      config.onProgress?.("Compressing objects: 100%");

      expect(messages).toEqual([
        "Counting objects: 10",
        "Compressing objects: 100%",
      ]);
    });
  });

  describe("push configuration", () => {
    it("should set pushRefspecs", () => {
      const config = new ProcessConfiguration();
      config.pushRefspecs = [
        "refs/heads/main:refs/heads/main",
        "+refs/heads/feature:refs/heads/feature",
      ];

      expect(config.pushRefspecs).toHaveLength(2);
      expect(config.pushRefspecs?.[0]).toBe("refs/heads/main:refs/heads/main");
      expect(config.pushRefspecs?.[1]).toContain("+"); // Force push
    });

    it("should set atomic push mode", () => {
      const config = new ProcessConfiguration();
      config.atomic = true;

      expect(config.atomic).toBe(true);
    });

    it("should set pushOptions", () => {
      const config = new ProcessConfiguration();
      config.pushOptions = ["ci.skip", "merge_request.create"];

      expect(config.pushOptions).toContain("ci.skip");
      expect(config.pushOptions).toContain("merge_request.create");
    });

    it("should set quiet mode", () => {
      const config = new ProcessConfiguration();
      config.quiet = true;

      expect(config.quiet).toBe(true);
    });
  });

  describe("server-side push configuration", () => {
    it("should set allowDeletes", () => {
      const config = new ProcessConfiguration();
      config.allowDeletes = false;

      expect(config.allowDeletes).toBe(false);
    });

    it("should set allowNonFastForward", () => {
      const config = new ProcessConfiguration();
      config.allowNonFastForward = true;

      expect(config.allowNonFastForward).toBe(true);
    });

    it("should set denyCurrentBranch", () => {
      const config = new ProcessConfiguration();
      config.denyCurrentBranch = true;
      config.currentBranch = "refs/heads/main";

      expect(config.denyCurrentBranch).toBe(true);
      expect(config.currentBranch).toBe("refs/heads/main");
    });
  });

  describe("protocol V2 configuration", () => {
    it("should set ls-refs options", () => {
      const config = new ProcessConfiguration();
      config.forceRefFetch = true;
      config.lsRefsSymrefs = true;
      config.lsRefsPeel = true;
      config.lsRefsUnborn = true;

      expect(config.forceRefFetch).toBe(true);
      expect(config.lsRefsSymrefs).toBe(true);
      expect(config.lsRefsPeel).toBe(true);
      expect(config.lsRefsUnborn).toBe(true);
    });

    it("should set refPrefixes filter", () => {
      const config = new ProcessConfiguration();
      config.refPrefixes = ["refs/heads/", "refs/tags/"];

      expect(config.refPrefixes).toContain("refs/heads/");
      expect(config.refPrefixes).toContain("refs/tags/");
    });

    it("should set noProgress option", () => {
      const config = new ProcessConfiguration();
      config.noProgress = true;

      expect(config.noProgress).toBe(true);
    });
  });

  describe("shallow clone configuration", () => {
    it("should set depth for shallow clone", () => {
      const config = new ProcessConfiguration();
      config.depth = 1;

      expect(config.depth).toBe(1);
    });

    it("should set deepenRelative", () => {
      const config = new ProcessConfiguration();
      config.depth = 5;
      config.deepenRelative = true;

      expect(config.deepenRelative).toBe(true);
    });

    it("should set shallowSince timestamp", () => {
      const config = new ProcessConfiguration();
      config.shallowSince = 1704067200; // 2024-01-01

      expect(config.shallowSince).toBe(1704067200);
    });

    it("should set shallowExclude refs", () => {
      const config = new ProcessConfiguration();
      config.shallowExclude = ["refs/heads/old-branch"];

      expect(config.shallowExclude).toContain("refs/heads/old-branch");
    });
  });

  describe("partial clone configuration", () => {
    it("should set blob:none filter", () => {
      const config = new ProcessConfiguration();
      config.filter = "blob:none";

      expect(config.filter).toBe("blob:none");
    });

    it("should set blob:limit filter", () => {
      const config = new ProcessConfiguration();
      config.filter = "blob:limit=1m";

      expect(config.filter).toBe("blob:limit=1m");
    });

    it("should set tree:0 filter for treeless clone", () => {
      const config = new ProcessConfiguration();
      config.filter = "tree:0";

      expect(config.filter).toBe("tree:0");
    });
  });

  describe("stateless RPC configuration", () => {
    it("should set statelessRpc mode", () => {
      const config = new ProcessConfiguration();
      config.statelessRpc = true;

      expect(config.statelessRpc).toBe(true);
    });
  });

  describe("negotiation configuration", () => {
    it("should set maxEmptyBatches", () => {
      const config = new ProcessConfiguration();
      config.maxEmptyBatches = 10;

      expect(config.maxEmptyBatches).toBe(10);
    });

    it("should set requestPolicy to ADVERTISED", () => {
      const config = new ProcessConfiguration();
      config.requestPolicy = "ADVERTISED";

      expect(config.requestPolicy).toBe("ADVERTISED");
    });

    it("should set requestPolicy to REACHABLE_COMMIT", () => {
      const config = new ProcessConfiguration();
      config.requestPolicy = "REACHABLE_COMMIT";

      expect(config.requestPolicy).toBe("REACHABLE_COMMIT");
    });

    it("should set requestPolicy to ANY", () => {
      const config = new ProcessConfiguration();
      config.requestPolicy = "ANY";

      expect(config.requestPolicy).toBe("ANY");
    });

    it("should set includeTag option", () => {
      const config = new ProcessConfiguration();
      config.includeTag = true;

      expect(config.includeTag).toBe(true);
    });

    it("should set multiAck mode to continue", () => {
      const config = new ProcessConfiguration();
      config.multiAck = "continue";

      expect(config.multiAck).toBe("continue");
    });

    it("should set multiAck mode to detailed", () => {
      const config = new ProcessConfiguration();
      config.multiAck = "detailed";

      expect(config.multiAck).toBe("detailed");
    });

    it("should set noDone optimization", () => {
      const config = new ProcessConfiguration();
      config.noDone = true;

      expect(config.noDone).toBe(true);
    });
  });

  describe("error recovery configuration", () => {
    it("should set maxRetries", () => {
      const config = new ProcessConfiguration();
      config.maxRetries = 3;

      expect(config.maxRetries).toBe(3);
    });

    it("should set allowReconnect", () => {
      const config = new ProcessConfiguration();
      config.allowReconnect = true;

      expect(config.allowReconnect).toBe(true);
    });

    it("should set reconnect callback", async () => {
      const config = new ProcessConfiguration();
      let reconnectAttempts = 0;
      config.reconnect = async () => {
        reconnectAttempts++;
        return null; // Simulate failed reconnect
      };

      await config.reconnect?.();

      expect(reconnectAttempts).toBe(1);
    });
  });

  describe("server capabilities configuration", () => {
    it("should set serverCapabilities array", () => {
      const config = new ProcessConfiguration();
      config.serverCapabilities = [
        "multi_ack_detailed",
        "side-band-64k",
        "thin-pack",
        "include-tag",
        "no-done",
      ];

      expect(config.serverCapabilities).toContain("multi_ack_detailed");
      expect(config.serverCapabilities).toContain("side-band-64k");
      expect(config.serverCapabilities).toHaveLength(5);
    });
  });

  describe("combined configurations", () => {
    it("should support typical fetch configuration", () => {
      const config = new ProcessConfiguration();
      config.maxHaves = 256;
      config.localHead = "refs/heads/main";
      config.thinPack = true;
      config.sideBand = true;
      config.multiAck = "detailed";
      config.noDone = true;
      config.depth = 0; // Full fetch

      expect(config.maxHaves).toBe(256);
      expect(config.localHead).toBe("refs/heads/main");
      expect(config.thinPack).toBe(true);
      expect(config.sideBand).toBe(true);
      expect(config.multiAck).toBe("detailed");
      expect(config.noDone).toBe(true);
      expect(config.depth).toBe(0);
    });

    it("should support typical shallow clone configuration", () => {
      const config = new ProcessConfiguration();
      config.depth = 1;
      config.filter = "blob:none";
      config.noProgress = false;
      config.sideBand = true;

      expect(config.depth).toBe(1);
      expect(config.filter).toBe("blob:none");
    });

    it("should support typical push configuration", () => {
      const config = new ProcessConfiguration();
      config.pushRefspecs = ["refs/heads/main:refs/heads/main"];
      config.atomic = false;
      config.pushOptions = [];
      config.quiet = false;

      expect(config.pushRefspecs).toHaveLength(1);
      expect(config.atomic).toBe(false);
    });

    it("should support server-side receive configuration", () => {
      const config = new ProcessConfiguration();
      config.serverCapabilities = ["report-status", "side-band-64k", "atomic"];
      config.allowDeletes = false;
      config.allowNonFastForward = false;
      config.denyCurrentBranch = true;
      config.currentBranch = "refs/heads/main";

      expect(config.allowDeletes).toBe(false);
      expect(config.allowNonFastForward).toBe(false);
      expect(config.denyCurrentBranch).toBe(true);
    });
  });
});
