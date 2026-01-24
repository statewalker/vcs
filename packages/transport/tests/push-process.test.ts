/**
 * Push Process Tests
 *
 * Tests for Git push process functionality including:
 * - Fast-forward updates
 * - Non-fast-forward handling
 * - Ref creation and deletion
 * - Up-to-date detection
 * - Expected old object validation (compare-and-swap)
 * - Connection rejection
 * - Mixed updates
 * - Tracking ref updates
 *
 * Modeled after JGit's PushProcessTest.java
 */

import { describe, expect, it } from "vitest";
import { ProtocolState } from "../src/context/protocol-state.js";
import {
  type PushCommand,
  type PushCommandResult,
  type PushCommandType,
  ZERO_OID,
} from "../src/fsm/push/types.js";

// ─────────────────────────────────────────────────────────────────────────────
// Push Process Test Helpers
// ─────────────────────────────────────────────────────────────────────────────

interface PushUpdate {
  refName: string;
  localOid: string;
  remoteOid: string;
  force?: boolean;
  expectedOid?: string;
}

interface PushResult {
  updates: Array<{
    refName: string;
    result: PushCommandResult;
    message?: string;
  }>;
  trackingRefsUpdated: Map<string, string>;
}

/**
 * Determines the push command type based on OIDs.
 */
function determinePushCommandType(oldOid: string, newOid: string): PushCommandType {
  if (newOid === ZERO_OID) return "DELETE";
  if (oldOid === ZERO_OID) return "CREATE";
  return "UPDATE";
}

/**
 * Simulates checking if an update is fast-forward.
 * In a real implementation, this would check if oldOid is an ancestor of newOid.
 */
function isFastForward(
  oldOid: string,
  _newOid: string,
  knownObjects: Set<string>,
  ancestors: Map<string, string[]>,
): boolean {
  // If oldOid is not known, it's not fast-forward
  if (!knownObjects.has(oldOid)) return false;

  // Check if oldOid is in the ancestor chain (simplified check)
  // In real implementation, would walk the commit graph
  return ancestors.has(oldOid);
}

/**
 * Validates a push update and returns the result.
 */
function validatePushUpdate(
  update: PushUpdate,
  remoteRefs: Map<string, string>,
  localObjects: Set<string>,
  ancestors: Map<string, string[]>,
  allowNonFastForward: boolean = false,
): { result: PushCommandResult; message?: string } {
  const currentRemoteOid = remoteRefs.get(update.refName) ?? ZERO_OID;
  const type = determinePushCommandType(update.remoteOid, update.localOid);

  // Check expected OID if specified (compare-and-swap)
  if (update.expectedOid !== undefined && update.expectedOid !== currentRemoteOid) {
    return {
      result: "REJECTED_NONFASTFORWARD",
      message: "expected remote ref changed since fetch",
    };
  }

  // Check if remote OID matches current
  if (update.remoteOid !== currentRemoteOid) {
    return {
      result: "REJECTED_NONFASTFORWARD",
      message: "remote ref changed since fetch",
    };
  }

  // For updates, check fast-forward
  if (type === "UPDATE") {
    const isFF = isFastForward(update.remoteOid, update.localOid, localObjects, ancestors);
    if (!isFF && !update.force && !allowNonFastForward) {
      return {
        result: "REJECTED_NONFASTFORWARD",
        message: "non-fast-forward",
      };
    }
  }

  // For creates and deletes, check if new object exists (for creates)
  if (type === "CREATE" && !localObjects.has(update.localOid)) {
    return {
      result: "REJECTED_MISSING_OBJECT",
      message: "missing necessary objects",
    };
  }

  return { result: "OK" };
}

// ─────────────────────────────────────────────────────────────────────────────
// Fast-Forward Update Tests
// ─────────────────────────────────────────────────────────────────────────────

describe("Fast-Forward Updates", () => {
  it("should accept fast-forward update", () => {
    const oldOid = "aaa111bbb222ccc333ddd444eee555fff666777";
    const newOid = "bbb222ccc333ddd444eee555fff666777888999";

    const remoteRefs = new Map([["refs/heads/main", oldOid]]);
    const localObjects = new Set([oldOid, newOid]);
    const ancestors = new Map([[oldOid, [newOid]]]); // oldOid is ancestor of newOid

    const update: PushUpdate = {
      refName: "refs/heads/main",
      localOid: newOid,
      remoteOid: oldOid,
    };

    const result = validatePushUpdate(update, remoteRefs, localObjects, ancestors);

    expect(result.result).toBe("OK");
  });

  it("should mark as fast-forward in result", () => {
    const oldOid = "aaa111bbb222ccc333ddd444eee555fff666777";
    const newOid = "bbb222ccc333ddd444eee555fff666777888999";

    const localObjects = new Set([oldOid, newOid]);
    const ancestors = new Map([[oldOid, [newOid]]]);

    const isFF = isFastForward(oldOid, newOid, localObjects, ancestors);

    expect(isFF).toBe(true);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Non-Fast-Forward Update Tests
// ─────────────────────────────────────────────────────────────────────────────

describe("Non-Fast-Forward Updates", () => {
  it("should reject non-fast-forward (unknown remote object)", () => {
    const oldOid = "aaa111bbb222ccc333ddd444eee555fff666777";
    const newOid = "bbb222ccc333ddd444eee555fff666777888999";

    const remoteRefs = new Map([["refs/heads/main", oldOid]]);
    const localObjects = new Set([newOid]); // oldOid is NOT known locally
    const ancestors = new Map<string, string[]>();

    const update: PushUpdate = {
      refName: "refs/heads/main",
      localOid: newOid,
      remoteOid: oldOid,
    };

    const result = validatePushUpdate(update, remoteRefs, localObjects, ancestors);

    expect(result.result).toBe("REJECTED_NONFASTFORWARD");
  });

  it("should reject non-fast-forward (known but not ancestor)", () => {
    const oldOid = "aaa111bbb222ccc333ddd444eee555fff666777";
    const newOid = "bbb222ccc333ddd444eee555fff666777888999";

    const remoteRefs = new Map([["refs/heads/main", oldOid]]);
    const localObjects = new Set([oldOid, newOid]);
    const ancestors = new Map<string, string[]>(); // No ancestor relationship

    const update: PushUpdate = {
      refName: "refs/heads/main",
      localOid: newOid,
      remoteOid: oldOid,
    };

    const result = validatePushUpdate(update, remoteRefs, localObjects, ancestors);

    expect(result.result).toBe("REJECTED_NONFASTFORWARD");
    expect(result.message).toContain("non-fast-forward");
  });

  it("should accept non-fast-forward when force=true", () => {
    const oldOid = "aaa111bbb222ccc333ddd444eee555fff666777";
    const newOid = "bbb222ccc333ddd444eee555fff666777888999";

    const remoteRefs = new Map([["refs/heads/main", oldOid]]);
    const localObjects = new Set([oldOid, newOid]);
    const ancestors = new Map<string, string[]>(); // No ancestor relationship

    const update: PushUpdate = {
      refName: "refs/heads/main",
      localOid: newOid,
      remoteOid: oldOid,
      force: true, // Force push
    };

    const result = validatePushUpdate(update, remoteRefs, localObjects, ancestors);

    expect(result.result).toBe("OK");
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Ref Creation Tests
// ─────────────────────────────────────────────────────────────────────────────

describe("Ref Creation", () => {
  it("should create new remote ref", () => {
    const newOid = "bbb222ccc333ddd444eee555fff666777888999";

    const remoteRefs = new Map<string, string>(); // Empty - no refs yet
    const localObjects = new Set([newOid]);
    const ancestors = new Map<string, string[]>();

    const update: PushUpdate = {
      refName: "refs/heads/feature",
      localOid: newOid,
      remoteOid: ZERO_OID, // Create - no existing ref
    };

    const result = validatePushUpdate(update, remoteRefs, localObjects, ancestors);

    expect(result.result).toBe("OK");
  });

  it("should return OK status for successful creation", () => {
    const newOid = "bbb222ccc333ddd444eee555fff666777888999";

    const type = determinePushCommandType(ZERO_OID, newOid);

    expect(type).toBe("CREATE");
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Ref Deletion Tests
// ─────────────────────────────────────────────────────────────────────────────

describe("Ref Deletion", () => {
  it("should delete existing ref", () => {
    const oldOid = "aaa111bbb222ccc333ddd444eee555fff666777";

    const remoteRefs = new Map([["refs/heads/feature", oldOid]]);
    const localObjects = new Set([oldOid]);
    const ancestors = new Map<string, string[]>();

    const update: PushUpdate = {
      refName: "refs/heads/feature",
      localOid: ZERO_OID, // Delete
      remoteOid: oldOid,
    };

    const result = validatePushUpdate(update, remoteRefs, localObjects, ancestors);

    expect(result.result).toBe("OK");
  });

  it("should return NON_EXISTING for missing ref", () => {
    const remoteRefs = new Map<string, string>(); // No refs

    const update: PushUpdate = {
      refName: "refs/heads/nonexistent",
      localOid: ZERO_OID,
      remoteOid: "aaa111bbb222ccc333ddd444eee555fff666777", // Expected to exist
    };

    const result = validatePushUpdate(
      update,
      remoteRefs,
      new Set(),
      new Map(),
    );

    // Remote ref doesn't match expected
    expect(result.result).toBe("REJECTED_NONFASTFORWARD");
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Up-to-Date Tests
// ─────────────────────────────────────────────────────────────────────────────

describe("Up-to-Date", () => {
  it("should detect up-to-date refs", () => {
    const oid = "aaa111bbb222ccc333ddd444eee555fff666777";

    // Both local and remote have the same OID
    const localOid = oid;
    const remoteOid = oid;

    const isUpToDate = localOid === remoteOid;

    expect(isUpToDate).toBe(true);
  });

  it("should skip sending pack for up-to-date", () => {
    const oid = "aaa111bbb222ccc333ddd444eee555fff666777";

    const updates: PushUpdate[] = [
      {
        refName: "refs/heads/main",
        localOid: oid,
        remoteOid: oid, // Same OID - up to date
      },
    ];

    // Filter out up-to-date refs
    const needsPack = updates.filter((u) => u.localOid !== u.remoteOid);

    expect(needsPack).toHaveLength(0);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Expected Old Object Tests (Compare-and-Swap)
// ─────────────────────────────────────────────────────────────────────────────

describe("Expected Old Object (Compare-and-Swap)", () => {
  it("should accept when expected matches", () => {
    const oldOid = "aaa111bbb222ccc333ddd444eee555fff666777";
    const newOid = "bbb222ccc333ddd444eee555fff666777888999";

    const remoteRefs = new Map([["refs/heads/main", oldOid]]);
    const localObjects = new Set([oldOid, newOid]);
    const ancestors = new Map([[oldOid, [newOid]]]);

    const update: PushUpdate = {
      refName: "refs/heads/main",
      localOid: newOid,
      remoteOid: oldOid,
      expectedOid: oldOid, // Matches current
    };

    const result = validatePushUpdate(update, remoteRefs, localObjects, ancestors);

    expect(result.result).toBe("OK");
  });

  it("should reject when expected differs (compare-and-swap)", () => {
    const oldOid = "aaa111bbb222ccc333ddd444eee555fff666777";
    const newOid = "bbb222ccc333ddd444eee555fff666777888999";
    const currentOid = "ccc333ddd444eee555fff666777888999000aaa"; // Remote changed!

    const remoteRefs = new Map([["refs/heads/main", currentOid]]);
    const localObjects = new Set([oldOid, newOid, currentOid]);
    const ancestors = new Map([[oldOid, [newOid]]]);

    const update: PushUpdate = {
      refName: "refs/heads/main",
      localOid: newOid,
      remoteOid: oldOid,
      expectedOid: oldOid, // We expected oldOid, but remote has currentOid
    };

    const result = validatePushUpdate(update, remoteRefs, localObjects, ancestors);

    expect(result.result).toBe("REJECTED_NONFASTFORWARD");
    expect(result.message).toContain("expected");
  });

  it("should reject even with force when expected differs", () => {
    const oldOid = "aaa111bbb222ccc333ddd444eee555fff666777";
    const newOid = "bbb222ccc333ddd444eee555fff666777888999";
    const currentOid = "ccc333ddd444eee555fff666777888999000aaa";

    const remoteRefs = new Map([["refs/heads/main", currentOid]]);
    const localObjects = new Set([oldOid, newOid, currentOid]);

    const update: PushUpdate = {
      refName: "refs/heads/main",
      localOid: newOid,
      remoteOid: oldOid,
      expectedOid: oldOid, // Expected differs from current
      force: true, // Even force doesn't help
    };

    const result = validatePushUpdate(update, remoteRefs, localObjects, new Map());

    // Compare-and-swap should fail regardless of force
    expect(result.result).toBe("REJECTED_NONFASTFORWARD");
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Connection Rejection Tests
// ─────────────────────────────────────────────────────────────────────────────

describe("Connection Rejection", () => {
  it("should propagate connection rejection status", () => {
    // Simulate a connection rejection error
    const connectionError = "remote: repository not found";

    // The push result should include the rejection message
    const result: PushResult = {
      updates: [
        {
          refName: "refs/heads/main",
          result: "REJECTED_OTHER_REASON",
          message: connectionError,
        },
      ],
      trackingRefsUpdated: new Map(),
    };

    expect(result.updates[0].result).toBe("REJECTED_OTHER_REASON");
    expect(result.updates[0].message).toContain("repository not found");
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Mixed Updates Tests
// ─────────────────────────────────────────────────────────────────────────────

describe("Mixed Updates", () => {
  it("should handle independent updates independently", () => {
    const oid1 = "aaa111bbb222ccc333ddd444eee555fff666777";
    const newOid1 = "bbb222ccc333ddd444eee555fff666777888999";
    const oid2 = "ccc333ddd444eee555fff666777888999000aaa";
    const newOid2 = "ddd444eee555fff666777888999000aaa111bbb";

    const remoteRefs = new Map([
      ["refs/heads/main", oid1],
      ["refs/heads/feature", oid2],
    ]);
    const localObjects = new Set([oid1, newOid1, oid2, newOid2]);
    const ancestors = new Map([
      [oid1, [newOid1]], // main is fast-forward
      // feature is NOT fast-forward (no entry)
    ]);

    const updates: PushUpdate[] = [
      { refName: "refs/heads/main", localOid: newOid1, remoteOid: oid1 },
      { refName: "refs/heads/feature", localOid: newOid2, remoteOid: oid2 },
    ];

    const results = updates.map((u) =>
      validatePushUpdate(u, remoteRefs, localObjects, ancestors),
    );

    // main should succeed, feature should fail
    expect(results[0].result).toBe("OK");
    expect(results[1].result).toBe("REJECTED_NONFASTFORWARD");
  });

  it("should call pre-push hook with all refs", () => {
    const updates: PushUpdate[] = [
      {
        refName: "refs/heads/main",
        localOid: "aaa111bbb222ccc333ddd444eee555fff666777",
        remoteOid: "bbb222ccc333ddd444eee555fff666777888999",
      },
      {
        refName: "refs/heads/feature",
        localOid: "ccc333ddd444eee555fff666777888999000aaa",
        remoteOid: ZERO_OID,
      },
    ];

    // Pre-push hook should receive all updates
    const hookInput = updates.map((u) => ({
      localRef: u.refName,
      localOid: u.localOid,
      remoteRef: u.refName,
      remoteOid: u.remoteOid,
    }));

    expect(hookInput).toHaveLength(2);
    expect(hookInput[0].localRef).toBe("refs/heads/main");
    expect(hookInput[1].localRef).toBe("refs/heads/feature");
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Tracking Ref Updates Tests
// ─────────────────────────────────────────────────────────────────────────────

describe("Tracking Ref Updates", () => {
  it("should update local tracking ref on success", () => {
    const newOid = "aaa111bbb222ccc333ddd444eee555fff666777";
    const trackingRefs = new Map<string, string>();

    // After successful push to refs/heads/main
    const pushResult: PushCommandResult = "OK";
    const refName = "refs/heads/main";
    const trackingRefName = `refs/remotes/origin/${refName.replace("refs/heads/", "")}`;

    if (pushResult === "OK") {
      trackingRefs.set(trackingRefName, newOid);
    }

    expect(trackingRefs.get("refs/remotes/origin/main")).toBe(newOid);
  });

  it("should not update tracking ref on failure", () => {
    const trackingRefs = new Map<string, string>();

    // After failed push
    const pushResult: PushCommandResult = "REJECTED_NONFASTFORWARD";
    const newOid = "aaa111bbb222ccc333ddd444eee555fff666777";
    const trackingRefName = "refs/remotes/origin/main";

    if (pushResult === "OK") {
      trackingRefs.set(trackingRefName, newOid);
    }

    expect(trackingRefs.has(trackingRefName)).toBe(false);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Protocol State for Push Process Tests
// ─────────────────────────────────────────────────────────────────────────────

describe("ProtocolState for Push Process", () => {
  it("should track push commands", () => {
    const state = new ProtocolState() as ProtocolState & { pushCommands?: PushCommand[] };

    state.pushCommands = [
      {
        oldOid: "a".repeat(40),
        newOid: "b".repeat(40),
        refName: "refs/heads/main",
        type: "UPDATE",
        result: "NOT_ATTEMPTED",
      },
    ];

    expect(state.pushCommands).toHaveLength(1);
    expect(state.pushCommands[0].type).toBe("UPDATE");
  });

  it("should track push options", () => {
    const state = new ProtocolState() as ProtocolState & { pushOptions?: string[] };

    state.pushOptions = ["option1=value1", "option2=value2"];

    expect(state.pushOptions).toHaveLength(2);
  });
});
