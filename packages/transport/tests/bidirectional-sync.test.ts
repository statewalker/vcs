/**
 * Tests for Bidirectional P2P Synchronization.
 *
 * Verifies sync planning and conflict detection between peers.
 */

import { describe, expect, it } from "vitest";
import { planBidirectionalSync, planSync, type RefState } from "../src/peer/bidirectional-sync.js";

// Sample object IDs
const OID_A = "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa";
const OID_B = "bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb";
const OID_C = "cccccccccccccccccccccccccccccccccccccccc";
const OID_D = "dddddddddddddddddddddddddddddddddddddddd";

// =============================================================================
// Basic Sync Planning Tests
// =============================================================================

describe("planBidirectionalSync - Basic", () => {
  it("should detect refs that are up-to-date", async () => {
    const localRefs: RefState[] = [{ name: "refs/heads/main", objectId: OID_A }];

    const remoteRefs: RefState[] = [{ name: "refs/heads/main", objectId: OID_A }];

    const plan = await planBidirectionalSync({ localRefs, remoteRefs });

    expect(plan.needsSync).toBe(false);
    expect(plan.toFetch).toHaveLength(0);
    expect(plan.toPush).toHaveLength(0);
    expect(plan.conflicts).toHaveLength(0);
    expect(plan.refs[0].action.type).toBe("up-to-date");
  });

  it("should detect refs to fetch (remote only)", async () => {
    const localRefs: RefState[] = [];

    const remoteRefs: RefState[] = [{ name: "refs/heads/main", objectId: OID_A }];

    const plan = await planBidirectionalSync({ localRefs, remoteRefs });

    expect(plan.needsSync).toBe(true);
    expect(plan.toFetch).toEqual(["refs/heads/main"]);
    expect(plan.toPush).toHaveLength(0);
    expect(plan.refs[0].action.type).toBe("fetch");
  });

  it("should detect refs to push (local only)", async () => {
    const localRefs: RefState[] = [{ name: "refs/heads/main", objectId: OID_A }];

    const remoteRefs: RefState[] = [];

    const plan = await planBidirectionalSync({ localRefs, remoteRefs });

    expect(plan.needsSync).toBe(true);
    expect(plan.toFetch).toHaveLength(0);
    expect(plan.toPush).toEqual(["refs/heads/main"]);
    expect(plan.refs[0].action.type).toBe("push");
  });

  it("should detect conflicts when refs differ without ancestry check", async () => {
    const localRefs: RefState[] = [{ name: "refs/heads/main", objectId: OID_A }];

    const remoteRefs: RefState[] = [{ name: "refs/heads/main", objectId: OID_B }];

    const plan = await planBidirectionalSync({ localRefs, remoteRefs });

    expect(plan.needsSync).toBe(true);
    expect(plan.conflicts).toEqual(["refs/heads/main"]);
    expect(plan.refs[0].action.type).toBe("conflict");
  });

  it("should handle multiple refs", async () => {
    const localRefs: RefState[] = [
      { name: "refs/heads/main", objectId: OID_A },
      { name: "refs/heads/feature", objectId: OID_B },
    ];

    const remoteRefs: RefState[] = [
      { name: "refs/heads/main", objectId: OID_A }, // same
      { name: "refs/heads/develop", objectId: OID_C }, // remote only
    ];

    const plan = await planBidirectionalSync({ localRefs, remoteRefs });

    expect(plan.needsSync).toBe(true);
    expect(plan.toFetch).toEqual(["refs/heads/develop"]);
    expect(plan.toPush).toEqual(["refs/heads/feature"]);
    expect(plan.refs).toHaveLength(3);
  });
});

// =============================================================================
// Ancestry-Based Sync Planning
// =============================================================================

describe("planBidirectionalSync - Ancestry", () => {
  it("should fetch when local is ancestor of remote", async () => {
    const localRefs: RefState[] = [{ name: "refs/heads/main", objectId: OID_A }];

    const remoteRefs: RefState[] = [{ name: "refs/heads/main", objectId: OID_B }];

    // OID_A is ancestor of OID_B (remote is ahead)
    const isAncestor = async (ancestor: string, descendant: string) => {
      return ancestor === OID_A && descendant === OID_B;
    };

    const plan = await planBidirectionalSync({ localRefs, remoteRefs, isAncestor });

    expect(plan.toFetch).toEqual(["refs/heads/main"]);
    expect(plan.toPush).toHaveLength(0);
    expect(plan.conflicts).toHaveLength(0);
  });

  it("should push when remote is ancestor of local", async () => {
    const localRefs: RefState[] = [{ name: "refs/heads/main", objectId: OID_B }];

    const remoteRefs: RefState[] = [{ name: "refs/heads/main", objectId: OID_A }];

    // OID_A is ancestor of OID_B (local is ahead)
    const isAncestor = async (ancestor: string, descendant: string) => {
      return ancestor === OID_A && descendant === OID_B;
    };

    const plan = await planBidirectionalSync({ localRefs, remoteRefs, isAncestor });

    expect(plan.toPush).toEqual(["refs/heads/main"]);
    expect(plan.toFetch).toHaveLength(0);
    expect(plan.conflicts).toHaveLength(0);
  });

  it("should detect conflict when neither is ancestor (diverged)", async () => {
    const localRefs: RefState[] = [{ name: "refs/heads/main", objectId: OID_C }];

    const remoteRefs: RefState[] = [{ name: "refs/heads/main", objectId: OID_D }];

    // Neither is ancestor of the other (diverged from common ancestor)
    const isAncestor = async (_ancestor: string, _descendant: string) => {
      return false;
    };

    const plan = await planBidirectionalSync({ localRefs, remoteRefs, isAncestor });

    expect(plan.conflicts).toEqual(["refs/heads/main"]);
    expect(plan.toFetch).toHaveLength(0);
    expect(plan.toPush).toHaveLength(0);
  });
});

// =============================================================================
// Conflict Resolution
// =============================================================================

describe("planBidirectionalSync - Conflict Resolution", () => {
  it("should prefer local on conflict when configured", async () => {
    const localRefs: RefState[] = [{ name: "refs/heads/main", objectId: OID_A }];

    const remoteRefs: RefState[] = [{ name: "refs/heads/main", objectId: OID_B }];

    const plan = await planBidirectionalSync({
      localRefs,
      remoteRefs,
      conflictResolution: "prefer-local",
    });

    expect(plan.toPush).toEqual(["refs/heads/main"]);
    expect(plan.conflicts).toHaveLength(0);
  });

  it("should prefer remote on conflict when configured", async () => {
    const localRefs: RefState[] = [{ name: "refs/heads/main", objectId: OID_A }];

    const remoteRefs: RefState[] = [{ name: "refs/heads/main", objectId: OID_B }];

    const plan = await planBidirectionalSync({
      localRefs,
      remoteRefs,
      conflictResolution: "prefer-remote",
    });

    expect(plan.toFetch).toEqual(["refs/heads/main"]);
    expect(plan.conflicts).toHaveLength(0);
  });

  it("should report conflict by default", async () => {
    const localRefs: RefState[] = [{ name: "refs/heads/main", objectId: OID_A }];

    const remoteRefs: RefState[] = [{ name: "refs/heads/main", objectId: OID_B }];

    const plan = await planBidirectionalSync({
      localRefs,
      remoteRefs,
      conflictResolution: "conflict",
    });

    expect(plan.conflicts).toEqual(["refs/heads/main"]);
  });
});

// =============================================================================
// Exclusion Patterns
// =============================================================================

describe("planBidirectionalSync - Exclusion Patterns", () => {
  it("should exclude refs matching exact pattern", async () => {
    const localRefs: RefState[] = [
      { name: "refs/heads/main", objectId: OID_A },
      { name: "refs/heads/private", objectId: OID_B },
    ];

    const remoteRefs: RefState[] = [{ name: "refs/heads/main", objectId: OID_A }];

    const plan = await planBidirectionalSync({
      localRefs,
      remoteRefs,
      excludePatterns: ["refs/heads/private"],
    });

    expect(plan.refs).toHaveLength(1);
    expect(plan.refs[0].refName).toBe("refs/heads/main");
  });

  it("should exclude refs matching wildcard pattern", async () => {
    const localRefs: RefState[] = [
      { name: "refs/heads/main", objectId: OID_A },
      { name: "refs/notes/commits", objectId: OID_B },
      { name: "refs/notes/trees", objectId: OID_C },
    ];

    const remoteRefs: RefState[] = [];

    const plan = await planBidirectionalSync({
      localRefs,
      remoteRefs,
      excludePatterns: ["refs/notes/*"],
    });

    expect(plan.refs).toHaveLength(1);
    expect(plan.refs[0].refName).toBe("refs/heads/main");
  });
});

// =============================================================================
// planSync Shorthand
// =============================================================================

describe("planSync", () => {
  it("should work as shorthand for planBidirectionalSync", async () => {
    const localRefs: RefState[] = [{ name: "refs/heads/main", objectId: OID_A }];

    const remoteRefs: RefState[] = [{ name: "refs/heads/main", objectId: OID_B }];

    const plan = await planSync(localRefs, remoteRefs);

    expect(plan.conflicts).toEqual(["refs/heads/main"]);
  });

  it("should accept options", async () => {
    const localRefs: RefState[] = [{ name: "refs/heads/main", objectId: OID_A }];

    const remoteRefs: RefState[] = [{ name: "refs/heads/main", objectId: OID_B }];

    const plan = await planSync(localRefs, remoteRefs, {
      conflictResolution: "prefer-local",
    });

    expect(plan.toPush).toEqual(["refs/heads/main"]);
    expect(plan.conflicts).toHaveLength(0);
  });
});

// =============================================================================
// Edge Cases
// =============================================================================

describe("planBidirectionalSync - Edge Cases", () => {
  it("should handle empty local and remote refs", async () => {
    const plan = await planBidirectionalSync({ localRefs: [], remoteRefs: [] });

    expect(plan.needsSync).toBe(false);
    expect(plan.refs).toHaveLength(0);
  });

  it("should handle refs with same name and same oid in different positions", async () => {
    const localRefs: RefState[] = [
      { name: "refs/heads/a", objectId: OID_A },
      { name: "refs/heads/b", objectId: OID_B },
      { name: "refs/heads/c", objectId: OID_C },
    ];

    const remoteRefs: RefState[] = [
      { name: "refs/heads/c", objectId: OID_C },
      { name: "refs/heads/a", objectId: OID_A },
      { name: "refs/heads/b", objectId: OID_B },
    ];

    const plan = await planBidirectionalSync({ localRefs, remoteRefs });

    expect(plan.needsSync).toBe(false);
    expect(plan.refs).toHaveLength(3);
    for (const ref of plan.refs) {
      expect(ref.action.type).toBe("up-to-date");
    }
  });

  it("should handle tag refs", async () => {
    const localRefs: RefState[] = [{ name: "refs/tags/v1.0.0", objectId: OID_A }];

    const remoteRefs: RefState[] = [{ name: "refs/tags/v1.0.1", objectId: OID_B }];

    const plan = await planBidirectionalSync({ localRefs, remoteRefs });

    expect(plan.toFetch).toEqual(["refs/tags/v1.0.1"]);
    expect(plan.toPush).toEqual(["refs/tags/v1.0.0"]);
  });

  it("should handle deeply nested ref paths", async () => {
    const localRefs: RefState[] = [
      { name: "refs/heads/feature/user/john/branch", objectId: OID_A },
    ];

    const remoteRefs: RefState[] = [];

    const plan = await planBidirectionalSync({ localRefs, remoteRefs });

    expect(plan.toPush).toEqual(["refs/heads/feature/user/john/branch"]);
  });
});
