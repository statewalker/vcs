/**
 * Server Push FSM for git-receive-pack operations.
 *
 * Handles the server side of push operations:
 * 1. Send advertisement (refs + capabilities)
 * 2. Read push commands from client
 * 3. Read push options (if negotiated)
 * 4. Receive and unpack pack file
 * 5. Validate commands and check connectivity
 * 6. Run hooks and apply ref updates
 * 7. Send status report
 */

import {
  getAppliedCommands,
  getConfig,
  getOutput,
  getRefStore,
  getRepository,
  getServerPackStream,
  getServerPushCommands,
  getServerPushHooks,
  getServerPushOptions,
  getState,
  getTransport,
  type ProcessContext,
  type ServerPushCommand,
  setAppliedCommands,
  setServerPackStream,
  setServerPushCommands,
  setServerPushOptions,
} from "../../context/context-adapters.js";
import { encodeFlush, encodePacketLine } from "../../protocol/pkt-line-codec.js";
import type { FsmStateHandler, FsmTransition } from "../types.js";
import { type PushCommand, type PushCommandType, ZERO_OID } from "./types.js";

/**
 * Server push FSM transitions.
 */
export const serverPushTransitions: FsmTransition[] = [
  // Entry point
  ["", "START", "SEND_ADVERTISEMENT"],

  // Send refs and capabilities to client
  ["SEND_ADVERTISEMENT", "REFS_SENT", "READ_COMMANDS"],
  ["SEND_ADVERTISEMENT", "EMPTY_REPO", "READ_COMMANDS"],
  ["SEND_ADVERTISEMENT", "ERROR", ""],

  // Read push commands from client
  ["READ_COMMANDS", "COMMANDS_RECEIVED", "READ_PUSH_OPTIONS"],
  ["READ_COMMANDS", "COMMANDS_WITH_DELETE", "CHECK_DELETE_ALLOWED"],
  ["READ_COMMANDS", "NO_COMMANDS", ""], // Client sent nothing
  ["READ_COMMANDS", "ERROR", ""],

  // Check if delete is allowed
  ["CHECK_DELETE_ALLOWED", "DELETE_ALLOWED", "READ_PUSH_OPTIONS"],
  ["CHECK_DELETE_ALLOWED", "DELETE_DENIED", "REJECT_COMMANDS"],

  // Read push options (if push-options capability negotiated)
  ["READ_PUSH_OPTIONS", "OPTIONS_RECEIVED", "RECEIVE_PACK"],
  ["READ_PUSH_OPTIONS", "NO_OPTIONS", "RECEIVE_PACK"],
  ["READ_PUSH_OPTIONS", "ERROR", ""],

  // Receive pack file from client
  ["RECEIVE_PACK", "PACK_RECEIVED", "UNPACK"],
  ["RECEIVE_PACK", "EMPTY_PACK", "VALIDATE_COMMANDS"], // Delete-only
  ["RECEIVE_PACK", "ERROR", ""],

  // Unpack and store objects
  ["UNPACK", "UNPACK_OK", "CHECK_CONNECTIVITY"],
  ["UNPACK", "UNPACK_FAILED", "SEND_STATUS"],
  ["UNPACK", "ERROR", ""],

  // Check connectivity (all objects reachable)
  ["CHECK_CONNECTIVITY", "CONNECTIVITY_OK", "VALIDATE_COMMANDS"],
  ["CHECK_CONNECTIVITY", "CONNECTIVITY_FAILED", "REJECT_COMMANDS"],
  ["CHECK_CONNECTIVITY", "ERROR", ""],

  // Validate all commands
  ["VALIDATE_COMMANDS", "ALL_VALID", "RUN_PRE_RECEIVE_HOOK"],
  ["VALIDATE_COMMANDS", "SOME_INVALID", "RUN_PRE_RECEIVE_HOOK"], // Partial execution
  ["VALIDATE_COMMANDS", "ALL_INVALID", "SEND_STATUS"],
  ["VALIDATE_COMMANDS", "ERROR", ""],

  // Reject commands (used for fatal errors)
  ["REJECT_COMMANDS", "REJECTED", "SEND_STATUS"],

  // Pre-receive hook
  ["RUN_PRE_RECEIVE_HOOK", "HOOK_OK", "APPLY_UPDATES"],
  ["RUN_PRE_RECEIVE_HOOK", "HOOK_REJECTED", "SEND_STATUS"],
  ["RUN_PRE_RECEIVE_HOOK", "HOOK_ERROR", "SEND_STATUS"],
  ["RUN_PRE_RECEIVE_HOOK", "NO_HOOK", "APPLY_UPDATES"],
  ["RUN_PRE_RECEIVE_HOOK", "ERROR", ""],

  // Apply ref updates
  ["APPLY_UPDATES", "UPDATES_APPLIED", "RUN_POST_RECEIVE_HOOK"],
  ["APPLY_UPDATES", "PARTIAL_APPLIED", "RUN_POST_RECEIVE_HOOK"], // Some failed
  ["APPLY_UPDATES", "ATOMIC_FAILED", "SEND_STATUS"], // Atomic push failed
  ["APPLY_UPDATES", "ERROR", ""],

  // Post-receive hook
  ["RUN_POST_RECEIVE_HOOK", "HOOK_DONE", "SEND_STATUS"],
  ["RUN_POST_RECEIVE_HOOK", "NO_HOOK", "SEND_STATUS"],

  // Send status report
  ["SEND_STATUS", "STATUS_SENT", ""],
  ["SEND_STATUS", "ERROR", ""],
];

/**
 * Server push FSM handlers.
 */
export const serverPushHandlers = new Map<string, FsmStateHandler<ProcessContext>>([
  // Initial handler
  ["", async () => "START"],

  // Send advertisement to client
  [
    "SEND_ADVERTISEMENT",
    async (ctx) => {
      try {
        const refs = await ctx.refStore.listAll();
        const capabilities = [
          "report-status",
          "delete-refs",
          "ofs-delta",
          "side-band-64k",
          "atomic",
          "push-options",
          "quiet",
        ];

        let first = true;
        const refsArray = Array.from(refs);

        // Empty repository
        if (refsArray.length === 0) {
          await ctx.transport.writeLine(`${ZERO_OID} capabilities^{}\0${capabilities.join(" ")}`);
          await ctx.transport.writeFlush();
          for (const cap of capabilities) {
            ctx.state.capabilities.add(cap);
          }
          return "EMPTY_REPO";
        }

        for (const [name, oid] of refsArray) {
          const line = first ? `${oid} ${name}\0${capabilities.join(" ")}` : `${oid} ${name}`;
          await ctx.transport.writeLine(line);
          ctx.state.refs.set(name, oid);
          first = false;
        }
        await ctx.transport.writeFlush();
        for (const cap of capabilities) {
          ctx.state.capabilities.add(cap);
        }
        return "REFS_SENT";
      } catch (e) {
        ctx.output.error = String(e);
        return "ERROR";
      }
    },
  ],

  // Read push commands from client
  [
    "READ_COMMANDS",
    async (ctx) => {
      try {
        const pushCommands: PushCommand[] = [];
        let hasDelete = false;

        while (true) {
          const pkt = await ctx.transport.readPktLine();
          if (pkt.type === "flush") break;
          if (pkt.type === "eof") {
            ctx.output.error = "Unexpected end of input";
            return "ERROR";
          }
          if (pkt.type === "delim") {
            continue; // Unexpected delimiter in push commands
          }

          const line = pkt.text;

          // Parse command: old-oid SP new-oid SP refname\0caps
          // Cannot use split(" ", 3) — JS split with limit truncates remaining text.
          // e.g., "a b c d".split(" ", 3) → ["a", "b", "c"] NOT ["a", "b", "c d"]
          const sp1 = line.indexOf(" ");
          const sp2 = line.indexOf(" ", sp1 + 1);
          const oldOid = line.slice(0, sp1);
          const newOid = line.slice(sp1 + 1, sp2);
          let refName = line.slice(sp2 + 1);

          // Parse capabilities from first command
          if (refName.includes("\0")) {
            const nullIdx = refName.indexOf("\0");
            const caps = refName.slice(nullIdx + 1);
            refName = refName.slice(0, nullIdx);
            for (const c of caps.split(" ")) {
              ctx.state.capabilities.add(c);
            }
          }

          // Determine command type
          let type: PushCommandType;
          if (newOid === ZERO_OID) {
            type = "DELETE";
            hasDelete = true;
          } else if (oldOid === ZERO_OID) {
            type = "CREATE";
          } else {
            type = "UPDATE"; // Will validate fast-forward later
          }

          pushCommands.push({
            oldOid,
            newOid,
            refName,
            type,
            result: "NOT_ATTEMPTED",
          });
        }

        (ctx.state as ServerPushState).pushCommands = pushCommands;

        if (pushCommands.length === 0) {
          return "NO_COMMANDS";
        }

        return hasDelete ? "COMMANDS_WITH_DELETE" : "COMMANDS_RECEIVED";
      } catch (e) {
        ctx.output.error = String(e);
        return "ERROR";
      }
    },
  ],

  // Check if delete is allowed
  [
    "CHECK_DELETE_ALLOWED",
    async (ctx) => {
      try {
        const state = ctx.state as ServerPushState;

        if (ctx.config.allowDeletes === false && !ctx.state.capabilities.has("delete-refs")) {
          // Mark delete commands as rejected
          for (const cmd of state.pushCommands ?? []) {
            if (cmd.type === "DELETE") {
              cmd.result = "REJECTED_NODELETE";
              cmd.message = "deletion prohibited";
            }
          }
          return "DELETE_DENIED";
        }
        return "DELETE_ALLOWED";
      } catch (e) {
        ctx.output.error = String(e);
        return "ERROR";
      }
    },
  ],

  // Read push options
  [
    "READ_PUSH_OPTIONS",
    async (ctx) => {
      try {
        if (!ctx.state.capabilities.has("push-options")) {
          return "NO_OPTIONS";
        }

        const pushOptions: string[] = [];

        while (true) {
          const pkt = await ctx.transport.readPktLine();
          if (pkt.type === "flush") break;
          if (pkt.type === "eof") {
            ctx.output.error = "Unexpected end of input";
            return "ERROR";
          }
          if (pkt.type === "delim") {
            continue; // Unexpected delimiter in push options
          }
          pushOptions.push(pkt.text);
        }

        (ctx.state as ServerPushState).pushOptions = pushOptions;
        return "OPTIONS_RECEIVED";
      } catch (e) {
        ctx.output.error = String(e);
        return "ERROR";
      }
    },
  ],

  // Receive pack from client
  [
    "RECEIVE_PACK",
    async (ctx) => {
      try {
        const state = ctx.state as ServerPushState;

        // Check if pack is expected (not for delete-only)
        const expectPack = (state.pushCommands ?? []).some((cmd) => cmd.type !== "DELETE");

        if (!expectPack) {
          return "EMPTY_PACK";
        }

        // Store pack stream for later unpacking.
        // Use readRawPack() because the client sends raw pack data
        // after the pkt-line commands, regardless of sideband capability.
        // Sideband is only used for the server's response direction.
        setServerPackStream(ctx, transport.readRawPack());
        return "PACK_RECEIVED";
      } catch (e) {
        ctx.output.error = String(e);
        return "ERROR";
      }
    },
  ],

  // Unpack and store objects
  [
    "UNPACK",
    async (ctx) => {
      try {
        const state = ctx.state as ServerPushState;
        if (state.packStream) {
          const result = await ctx.repository.importPack(state.packStream);
          ctx.output.packResult = result;
        }
        return "UNPACK_OK";
      } catch (e) {
        ctx.output.error = String(e);
        return "UNPACK_FAILED";
      }
    },
  ],

  // Check connectivity
  [
    "CHECK_CONNECTIVITY",
    async (ctx) => {
      try {
        const state = ctx.state as ServerPushState;

        for (const cmd of state.pushCommands ?? []) {
          if (cmd.type === "DELETE") continue;

          // Check if new objects are reachable
          const exists = await ctx.repository.has(cmd.newOid);
          if (!exists) {
            cmd.result = "REJECTED_MISSING_OBJECT";
            cmd.message = "missing necessary objects";
          }
        }

        const anyMissing = (state.pushCommands ?? []).some(
          (c) => c.result === "REJECTED_MISSING_OBJECT",
        );
        return anyMissing ? "CONNECTIVITY_FAILED" : "CONNECTIVITY_OK";
      } catch (e) {
        ctx.output.error = String(e);
        return "ERROR";
      }
    },
  ],

  // Validate commands
  [
    "VALIDATE_COMMANDS",
    async (ctx) => {
      try {
        const state = ctx.state as ServerPushState;
        let invalidCount = 0;

        for (const cmd of state.pushCommands ?? []) {
          // Skip already rejected
          if (cmd.result !== "NOT_ATTEMPTED") {
            invalidCount++;
            continue;
          }

          // Validate old OID matches current ref
          const currentOid = ctx.state.refs.get(cmd.refName) ?? ZERO_OID;
          if (cmd.oldOid !== currentOid) {
            cmd.result = "REJECTED_NONFASTFORWARD";
            cmd.message = "remote ref changed since fetch";
            invalidCount++;
            continue;
          }

          // For updates, check fast-forward (unless config allows non-ff)
          if (cmd.type === "UPDATE") {
            const isFastForward = await ctx.repository.has(cmd.oldOid);
            if (!isFastForward && !ctx.config.allowNonFastForward) {
              cmd.result = "REJECTED_NONFASTFORWARD";
              cmd.message = "non-fast-forward";
              invalidCount++;
              continue;
            }
            if (!isFastForward) {
              cmd.type = "UPDATE_NONFASTFORWARD";
            }
          }

          // Check if updating current branch
          if (ctx.config.denyCurrentBranch && cmd.refName === ctx.config.currentBranch) {
            cmd.result = "REJECTED_CURRENT_BRANCH";
            cmd.message = "refusing to update checked out branch";
            invalidCount++;
          }
        }

        if (invalidCount === (state.pushCommands ?? []).length) {
          return "ALL_INVALID";
        }
        if (invalidCount > 0) {
          return "SOME_INVALID";
        }
        return "ALL_VALID";
      } catch (e) {
        ctx.output.error = String(e);
        return "ERROR";
      }
    },
  ],

  // Reject all commands
  [
    "REJECT_COMMANDS",
    async (ctx) => {
      try {
        const state = ctx.state as ServerPushState;
        const reason = ctx.output.error ?? "rejected";

        for (const cmd of state.pushCommands ?? []) {
          // Only reject commands that haven't been rejected yet
          if (cmd.result === "NOT_ATTEMPTED") {
            cmd.result = "REJECTED_OTHER_REASON";
            cmd.message = reason;
          }
        }
        return "REJECTED";
      } catch (e) {
        ctx.output.error = String(e);
        return "ERROR";
      }
    },
  ],

  // Run pre-receive hook
  [
    "RUN_PRE_RECEIVE_HOOK",
    async (ctx) => {
      try {
        const state = ctx.state as ServerPushState;
        const hooks = (ctx as ContextWithHooks).hooks;

        if (!hooks?.preReceive) {
          return "NO_HOOK";
        }

        const validCommands = (state.pushCommands ?? []).filter(
          (cmd) => cmd.result === "NOT_ATTEMPTED",
        );

        if (validCommands.length === 0) {
          return "NO_HOOK";
        }

        const result = await hooks.preReceive(validCommands, state.pushOptions);

        if (!result.ok) {
          // Reject specified refs or all
          const rejectedRefs = new Set(result.rejectedRefs ?? validCommands.map((c) => c.refName));
          for (const cmd of state.pushCommands ?? []) {
            if (rejectedRefs.has(cmd.refName) && cmd.result === "NOT_ATTEMPTED") {
              cmd.result = "REJECTED_OTHER_REASON";
              cmd.message = result.message ?? "pre-receive hook rejected";
            }
          }
          return "HOOK_REJECTED";
        }

        return "HOOK_OK";
      } catch (e) {
        ctx.output.error = String(e);
        return "HOOK_ERROR";
      }
    },
  ],

  // Apply ref updates
  [
    "APPLY_UPDATES",
    async (ctx) => {
      try {
        const state = ctx.state as ServerPushState;
        const atomic = ctx.state.capabilities.has("atomic");

        let failedCount = 0;
        const appliedCommands: PushCommand[] = [];

        for (const cmd of state.pushCommands ?? []) {
          if (cmd.result !== "NOT_ATTEMPTED") {
            failedCount++;
            continue;
          }

          try {
            if (cmd.type === "DELETE") {
              // Delete ref - refStore.update should handle this
              await ctx.refStore.update(cmd.refName, ZERO_OID);
            } else {
              await ctx.refStore.update(cmd.refName, cmd.newOid);
            }
            cmd.result = "OK";
            appliedCommands.push(cmd);
          } catch (e) {
            cmd.result = "LOCK_FAILURE";
            cmd.message = e instanceof Error ? e.message : "update failed";
            failedCount++;

            // If atomic, abort all
            if (atomic) {
              // Rollback applied updates (best effort)
              for (const applied of appliedCommands) {
                try {
                  await ctx.refStore.update(applied.refName, applied.oldOid);
                  applied.result = "ATOMIC_REJECTED";
                  applied.message = "atomic push failed";
                } catch {
                  // Rollback failed, continue
                }
              }
              return "ATOMIC_FAILED";
            }
          }
        }

        (state as ServerPushState).appliedCommands = appliedCommands;

        if (failedCount === 0) {
          return "UPDATES_APPLIED";
        }
        return "PARTIAL_APPLIED";
      } catch (e) {
        ctx.output.error = String(e);
        return "ERROR";
      }
    },
  ],

  // Run post-receive hook
  [
    "RUN_POST_RECEIVE_HOOK",
    async (ctx) => {
      try {
        const state = ctx.state as ServerPushState;
        const hooks = (ctx as ContextWithHooks).hooks;

        if (!hooks?.postReceive) {
          return "NO_HOOK";
        }

        const appliedCommands = state.appliedCommands ?? [];
        if (appliedCommands.length > 0) {
          await hooks.postReceive(appliedCommands, state.pushOptions);
        }

        return "HOOK_DONE";
      } catch {
        // Post-receive hook errors are non-fatal
        return "HOOK_DONE";
      }
    },
  ],

  // Send status report
  [
    "SEND_STATUS",
    async (ctx) => {
      try {
        const state = ctx.state as ServerPushState;
        const useSideband = ctx.state.capabilities.has("side-band-64k");
        const unpackOk = !ctx.output.error?.includes("Unpack");

        if (useSideband) {
          // Build pkt-line encoded report-status, then send via sideband.
          // Native git demuxes sideband first (stripping channel byte),
          // then reads pkt-lines from the inner byte stream.
          const innerChunks: Uint8Array[] = [];
          innerChunks.push(encodePacketLine(unpackOk ? "unpack ok" : `unpack ${output.error}`));

          for (const cmd of state.pushCommands ?? []) {
            if (cmd.result === "OK") {
              innerChunks.push(encodePacketLine(`ok ${cmd.refName}`));
            } else {
              innerChunks.push(encodePacketLine(`ng ${cmd.refName} ${cmd.message || "rejected"}`));
            }
          }

          innerChunks.push(encodeFlush());

          // Concatenate inner pkt-lines and send as one sideband frame
          const totalInnerLen = innerChunks.reduce((sum, c) => sum + c.length, 0);
          const innerData = new Uint8Array(totalInnerLen);
          let innerOff = 0;
          for (const chunk of innerChunks) {
            innerData.set(chunk, innerOff);
            innerOff += chunk.length;
          }

          await transport.writeSideband(1, innerData);
        } else {
          // Send status directly
          if (unpackOk) {
            await ctx.transport.writeLine("unpack ok");
          } else {
            await ctx.transport.writeLine(`unpack ${ctx.output.error || "failed"}`);
          }

          for (const cmd of state.pushCommands ?? []) {
            if (cmd.result === "OK") {
              await ctx.transport.writeLine(`ok ${cmd.refName}`);
            } else {
              await ctx.transport.writeLine(`ng ${cmd.refName} ${cmd.message || "rejected"}`);
            }
          }
        }

        await ctx.transport.writeFlush();
        return "STATUS_SENT";
      } catch (e) {
        ctx.output.error = String(e);
        return "ERROR";
      }
    },
  ],
]);

/**
 * Extended state for server push operations.
 */
interface ServerPushState {
  pushCommands?: PushCommand[];
  pushOptions?: string[];
  packStream?: AsyncIterable<Uint8Array>;
  appliedCommands?: PushCommand[];
}

/**
 * Context with hooks support.
 */
interface ContextWithHooks extends ProcessContext {
  hooks?: {
    preReceive?: (
      commands: PushCommand[],
      options?: string[],
    ) => Promise<{
      ok: boolean;
      message?: string;
      rejectedRefs?: string[];
    }>;
    postReceive?: (commands: PushCommand[], options?: string[]) => Promise<void>;
  };
}
