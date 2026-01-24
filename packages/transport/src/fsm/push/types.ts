/**
 * Push command types and interfaces for Push FSM.
 */

import { ZERO_OID } from "../../protocol/constants.js";

// Re-export for backward compatibility
export { ZERO_OID };

/**
 * Type of push command being executed.
 */
export type PushCommandType =
  | "CREATE" // New ref (old = 0000...)
  | "UPDATE" // Fast-forward update
  | "UPDATE_NONFASTFORWARD" // Force push
  | "DELETE"; // Delete ref (new = 0000...)

/**
 * Result of a push command.
 */
export type PushCommandResult =
  | "NOT_ATTEMPTED"
  | "OK"
  | "REJECTED_NOCREATE" // Server doesn't allow creating refs
  | "REJECTED_NODELETE" // Server doesn't allow deleting refs
  | "REJECTED_NONFASTFORWARD" // Not a fast-forward, force not allowed
  | "REJECTED_CURRENT_BRANCH" // Cannot update checked-out branch
  | "REJECTED_MISSING_OBJECT" // Required objects not in pack
  | "REJECTED_OTHER_REASON" // Other rejection (hook, permission, etc.)
  | "LOCK_FAILURE" // Could not lock ref for update
  | "ATOMIC_REJECTED"; // Atomic push failed

/**
 * A single push command.
 */
export interface PushCommand {
  /** Current remote ref value (or 0000... for create) */
  oldOid: string;
  /** New value to set (or 0000... for delete) */
  newOid: string;
  /** Full ref name (refs/heads/main) */
  refName: string;
  /** Type of push command */
  type: PushCommandType;
  /** Result of the command */
  result: PushCommandResult;
  /** Server's rejection message */
  message?: string;
}

/**
 * Parse a refspec string into components.
 *
 * @deprecated Use parseRefSpec from utils/refspec.js for full refspec support
 * including wildcards and negative refspecs. This simplified version is kept
 * for backward compatibility in the push FSM.
 */
export function parseRefspec(refspec: string): {
  src: string | null;
  dst: string;
  force: boolean;
} {
  let force = false;
  let spec = refspec;

  if (spec.startsWith("+")) {
    force = true;
    spec = spec.slice(1);
  }

  if (spec.includes(":")) {
    const [src, dst] = spec.split(":", 2);
    return { src: src || null, dst, force };
  }

  return { src: spec, dst: spec, force };
}

/**
 * Map server rejection reason to PushCommandResult.
 */
export function mapRejectReason(reason: string): PushCommandResult {
  if (reason.includes("non-fast-forward")) return "REJECTED_NONFASTFORWARD";
  if (reason.includes("current branch")) return "REJECTED_CURRENT_BRANCH";
  if (reason.includes("deny deleting")) return "REJECTED_NODELETE";
  if (reason.includes("deny creating")) return "REJECTED_NOCREATE";
  if (reason.includes("missing")) return "REJECTED_MISSING_OBJECT";
  if (reason.includes("atomic")) return "ATOMIC_REJECTED";
  if (reason.includes("lock")) return "LOCK_FAILURE";
  return "REJECTED_OTHER_REASON";
}
