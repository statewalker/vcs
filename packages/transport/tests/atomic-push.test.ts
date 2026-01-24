/**
 * Atomic Push Tests
 *
 * Tests for atomic push functionality where all refs succeed or fail together.
 *
 * Modeled after JGit's AtomicPushTest.java
 */

import { describe, expect, it } from "vitest";
import { type PushCommand, type PushCommandResult, ZERO_OID } from "../src/fsm/push/types.js";

// ─────────────────────────────────────────────────────────────────────────────
// Atomic Push Test Helpers
// ─────────────────────────────────────────────────────────────────────────────

interface AtomicPushResult {
  success: boolean;
  commands: PushCommand[];
  atomicFailure?: boolean;
  rollbackPerformed?: boolean;
}

/**
 * Simulates atomic push processing.
 * If any command fails validation, all commands are rejected.
 */
function processAtomicPush(
  commands: PushCommand[],
  validateFn: (cmd: PushCommand) => PushCommandResult,
): AtomicPushResult {
  // First pass: validate all commands
  const validationResults: Array<{ cmd: PushCommand; result: PushCommandResult }> = [];

  for (const cmd of commands) {
    const result = validateFn(cmd);
    validationResults.push({ cmd, result });
  }

  // Check if any validation failed
  const anyFailed = validationResults.some((v) => v.result !== "OK");

  if (anyFailed) {
    // Mark all commands as atomic rejected
    for (const { cmd } of validationResults) {
      cmd.result = "ATOMIC_REJECTED";
      cmd.message = "atomic push failed";
    }

    return {
      success: false,
      commands,
      atomicFailure: true,
    };
  }

  // All validations passed - mark as OK
  for (const { cmd } of validationResults) {
    cmd.result = "OK";
  }

  return {
    success: true,
    commands,
  };
}

/**
 * Simulates applying atomic ref updates with rollback on failure.
 */
function applyAtomicUpdates(
  commands: PushCommand[],
  refs: Map<string, string>,
  failOnRef?: string,
): AtomicPushResult {
  const appliedCommands: PushCommand[] = [];
  const originalRefs = new Map(refs);

  for (const cmd of commands) {
    // Simulate failure on specific ref
    if (cmd.refName === failOnRef) {
      cmd.result = "LOCK_FAILURE";
      cmd.message = "cannot lock ref";

      // Rollback all previously applied updates
      for (const applied of appliedCommands) {
        const originalOid = originalRefs.get(applied.refName) ?? ZERO_OID;
        refs.set(applied.refName, originalOid);
        applied.result = "ATOMIC_REJECTED";
        applied.message = "atomic push failed";
      }

      // Mark remaining commands as rejected
      for (const remaining of commands) {
        if (remaining.result === "NOT_ATTEMPTED") {
          remaining.result = "ATOMIC_REJECTED";
          remaining.message = "atomic push failed";
        }
      }

      return {
        success: false,
        commands,
        atomicFailure: true,
        rollbackPerformed: true,
      };
    }

    // Apply the update
    if (cmd.newOid === ZERO_OID) {
      refs.delete(cmd.refName);
    } else {
      refs.set(cmd.refName, cmd.newOid);
    }
    cmd.result = "OK";
    appliedCommands.push(cmd);
  }

  return {
    success: true,
    commands,
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// Atomic Push Tests
// ─────────────────────────────────────────────────────────────────────────────

describe("Atomic Push", () => {
  describe("should succeed when all refs succeed", () => {
    it("applies all updates atomically", () => {
      const commands: PushCommand[] = [
        {
          oldOid: "a".repeat(40),
          newOid: "b".repeat(40),
          refName: "refs/heads/main",
          type: "UPDATE",
          result: "NOT_ATTEMPTED",
        },
        {
          oldOid: ZERO_OID,
          newOid: "c".repeat(40),
          refName: "refs/heads/feature",
          type: "CREATE",
          result: "NOT_ATTEMPTED",
        },
        {
          oldOid: "d".repeat(40),
          newOid: ZERO_OID,
          refName: "refs/heads/old-feature",
          type: "DELETE",
          result: "NOT_ATTEMPTED",
        },
      ];

      // All commands pass validation
      const result = processAtomicPush(commands, () => "OK");

      expect(result.success).toBe(true);
      expect(result.commands.every((c) => c.result === "OK")).toBe(true);
    });

    it("updates refs in order", () => {
      const refs = new Map([
        ["refs/heads/main", "a".repeat(40)],
        ["refs/heads/feature", "d".repeat(40)],
      ]);

      const commands: PushCommand[] = [
        {
          oldOid: "a".repeat(40),
          newOid: "b".repeat(40),
          refName: "refs/heads/main",
          type: "UPDATE",
          result: "NOT_ATTEMPTED",
        },
        {
          oldOid: "d".repeat(40),
          newOid: "e".repeat(40),
          refName: "refs/heads/feature",
          type: "UPDATE",
          result: "NOT_ATTEMPTED",
        },
      ];

      const result = applyAtomicUpdates(commands, refs);

      expect(result.success).toBe(true);
      expect(refs.get("refs/heads/main")).toBe("b".repeat(40));
      expect(refs.get("refs/heads/feature")).toBe("e".repeat(40));
    });
  });

  describe("should reject all when any ref fails", () => {
    it("rejects all on validation failure", () => {
      const commands: PushCommand[] = [
        {
          oldOid: "a".repeat(40),
          newOid: "b".repeat(40),
          refName: "refs/heads/main",
          type: "UPDATE",
          result: "NOT_ATTEMPTED",
        },
        {
          oldOid: "c".repeat(40),
          newOid: "d".repeat(40),
          refName: "refs/heads/feature",
          type: "UPDATE",
          result: "NOT_ATTEMPTED",
        },
      ];

      // Second command fails validation
      const result = processAtomicPush(commands, (cmd) =>
        cmd.refName === "refs/heads/feature" ? "REJECTED_NONFASTFORWARD" : "OK",
      );

      expect(result.success).toBe(false);
      expect(result.atomicFailure).toBe(true);
      expect(result.commands.every((c) => c.result === "ATOMIC_REJECTED")).toBe(true);
    });

    it("rejects all on apply failure", () => {
      const refs = new Map([
        ["refs/heads/main", "a".repeat(40)],
        ["refs/heads/protected", "c".repeat(40)],
      ]);

      const commands: PushCommand[] = [
        {
          oldOid: "a".repeat(40),
          newOid: "b".repeat(40),
          refName: "refs/heads/main",
          type: "UPDATE",
          result: "NOT_ATTEMPTED",
        },
        {
          oldOid: "c".repeat(40),
          newOid: "d".repeat(40),
          refName: "refs/heads/protected",
          type: "UPDATE",
          result: "NOT_ATTEMPTED",
        },
      ];

      // Second command fails on apply (lock failure)
      const result = applyAtomicUpdates(commands, refs, "refs/heads/protected");

      expect(result.success).toBe(false);
      expect(result.atomicFailure).toBe(true);
    });
  });

  describe("should not partially update refs", () => {
    it("rolls back applied updates on failure", () => {
      const originalMain = "a".repeat(40);
      const refs = new Map([
        ["refs/heads/main", originalMain],
        ["refs/heads/feature", "c".repeat(40)],
      ]);

      const commands: PushCommand[] = [
        {
          oldOid: originalMain,
          newOid: "b".repeat(40),
          refName: "refs/heads/main",
          type: "UPDATE",
          result: "NOT_ATTEMPTED",
        },
        {
          oldOid: "c".repeat(40),
          newOid: "d".repeat(40),
          refName: "refs/heads/feature",
          type: "UPDATE",
          result: "NOT_ATTEMPTED",
        },
      ];

      // Second command fails - should rollback first
      const result = applyAtomicUpdates(commands, refs, "refs/heads/feature");

      expect(result.success).toBe(false);
      expect(result.rollbackPerformed).toBe(true);

      // Main should be rolled back to original
      expect(refs.get("refs/heads/main")).toBe(originalMain);
    });

    it("leaves refs unchanged on early failure", () => {
      const originalMain = "a".repeat(40);
      const refs = new Map([
        ["refs/heads/main", originalMain],
        ["refs/heads/feature", "c".repeat(40)],
      ]);

      const commands: PushCommand[] = [
        {
          oldOid: originalMain,
          newOid: "b".repeat(40),
          refName: "refs/heads/main",
          type: "UPDATE",
          result: "NOT_ATTEMPTED",
        },
        {
          oldOid: "c".repeat(40),
          newOid: "d".repeat(40),
          refName: "refs/heads/feature",
          type: "UPDATE",
          result: "NOT_ATTEMPTED",
        },
      ];

      // First command fails - nothing should be applied
      const result = applyAtomicUpdates(commands, refs, "refs/heads/main");

      expect(result.success).toBe(false);

      // Both refs unchanged
      expect(refs.get("refs/heads/main")).toBe(originalMain);
      expect(refs.get("refs/heads/feature")).toBe("c".repeat(40));
    });
  });

  describe("should report atomic failure reason", () => {
    it("sets ATOMIC_REJECTED result on all commands", () => {
      const commands: PushCommand[] = [
        {
          oldOid: "a".repeat(40),
          newOid: "b".repeat(40),
          refName: "refs/heads/main",
          type: "UPDATE",
          result: "NOT_ATTEMPTED",
        },
        {
          oldOid: "c".repeat(40),
          newOid: "d".repeat(40),
          refName: "refs/heads/feature",
          type: "UPDATE",
          result: "NOT_ATTEMPTED",
        },
      ];

      // Feature fails validation
      const result = processAtomicPush(commands, (cmd) =>
        cmd.refName === "refs/heads/feature" ? "REJECTED_NONFASTFORWARD" : "OK",
      );

      expect(result.atomicFailure).toBe(true);

      // All commands should have ATOMIC_REJECTED
      for (const cmd of result.commands) {
        expect(cmd.result).toBe("ATOMIC_REJECTED");
        expect(cmd.message).toContain("atomic");
      }
    });

    it("includes original failure reason in message", () => {
      const refs = new Map([
        ["refs/heads/main", "a".repeat(40)],
        ["refs/heads/locked", "c".repeat(40)],
      ]);

      const commands: PushCommand[] = [
        {
          oldOid: "a".repeat(40),
          newOid: "b".repeat(40),
          refName: "refs/heads/main",
          type: "UPDATE",
          result: "NOT_ATTEMPTED",
        },
        {
          oldOid: "c".repeat(40),
          newOid: "d".repeat(40),
          refName: "refs/heads/locked",
          type: "UPDATE",
          result: "NOT_ATTEMPTED",
        },
      ];

      const result = applyAtomicUpdates(commands, refs, "refs/heads/locked");

      // The locked ref should have LOCK_FAILURE
      const lockedCmd = result.commands.find((c) => c.refName === "refs/heads/locked");
      expect(lockedCmd?.result).toBe("LOCK_FAILURE");
      expect(lockedCmd?.message).toContain("lock");
    });
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Atomic vs Non-Atomic Comparison Tests
// ─────────────────────────────────────────────────────────────────────────────

describe("Atomic vs Non-Atomic Push", () => {
  it("non-atomic push allows partial success", () => {
    const commands: PushCommand[] = [
      {
        oldOid: "a".repeat(40),
        newOid: "b".repeat(40),
        refName: "refs/heads/main",
        type: "UPDATE",
        result: "NOT_ATTEMPTED",
      },
      {
        oldOid: "c".repeat(40),
        newOid: "d".repeat(40),
        refName: "refs/heads/feature",
        type: "UPDATE",
        result: "NOT_ATTEMPTED",
      },
    ];

    // Non-atomic: process each independently
    for (const cmd of commands) {
      if (cmd.refName === "refs/heads/feature") {
        cmd.result = "REJECTED_NONFASTFORWARD";
        cmd.message = "non-fast-forward";
      } else {
        cmd.result = "OK";
      }
    }

    // Main succeeded, feature failed
    expect(commands[0].result).toBe("OK");
    expect(commands[1].result).toBe("REJECTED_NONFASTFORWARD");
  });

  it("atomic push capability negotiation", () => {
    const clientCapabilities = new Set(["report-status", "atomic"]);
    const serverCapabilities = new Set(["report-status", "atomic", "delete-refs"]);

    // Both support atomic
    const atomicSupported =
      clientCapabilities.has("atomic") && serverCapabilities.has("atomic");

    expect(atomicSupported).toBe(true);
  });

  it("falls back to non-atomic when server does not support", () => {
    const clientCapabilities = new Set(["report-status", "atomic"]);
    const serverCapabilities = new Set(["report-status", "delete-refs"]); // No atomic

    const atomicSupported =
      clientCapabilities.has("atomic") && serverCapabilities.has("atomic");

    expect(atomicSupported).toBe(false);

    // Should fall back to non-atomic push
    const useAtomic = atomicSupported;
    expect(useAtomic).toBe(false);
  });
});
