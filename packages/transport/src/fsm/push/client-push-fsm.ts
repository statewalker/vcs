/**
 * Client Push FSM for git-receive-pack operations.
 *
 * Handles the client side of push operations:
 * 1. Read server advertisement (refs + capabilities)
 * 2. Compute ref updates based on refspecs
 * 3. Send push commands
 * 4. Send pack file with objects
 * 5. Read status report
 */

import {
  getConfig,
  getOutput,
  getRefStore,
  getRepository,
  getState,
  getTransport,
  type ProcessContext,
} from "../../context/context-adapters.js";
import {
  applyAdvertisementToState,
  parseAdvertisement,
} from "../../protocol/advertisement-parser.js";
import { createEmptyPack } from "../../protocol/pack-utils.js";
import { parseRefSpec } from "../../utils/refspec.js";
import type { FsmStateHandler, FsmTransition } from "../types.js";
import {
  mapRejectReason,
  type PushCommand,
  type PushCommandResult,
  type PushCommandType,
  ZERO_OID,
} from "./types.js";

/**
 * Client push FSM transitions.
 */
export const clientPushTransitions: FsmTransition[] = [
  // Entry point
  ["", "START", "READ_ADVERTISEMENT"],

  // Read refs and capabilities from server
  ["READ_ADVERTISEMENT", "REFS_RECEIVED", "COMPUTE_UPDATES"],
  ["READ_ADVERTISEMENT", "EMPTY_REPO", "COMPUTE_UPDATES"], // Server is empty
  ["READ_ADVERTISEMENT", "ERROR", ""],

  // Compute what refs to update
  ["COMPUTE_UPDATES", "UPDATES_COMPUTED", "SEND_COMMANDS"],
  ["COMPUTE_UPDATES", "NO_UPDATES", ""], // Nothing to push
  ["COMPUTE_UPDATES", "LOCAL_VALIDATION_FAILED", ""], // Pre-push validation failed
  ["COMPUTE_UPDATES", "ERROR", ""],

  // Send push commands (old-sha new-sha refname)
  ["SEND_COMMANDS", "COMMANDS_SENT", "SEND_PACK"],
  ["SEND_COMMANDS", "COMMANDS_SENT_ATOMIC", "SEND_PACK"], // Atomic mode
  ["SEND_COMMANDS", "COMMANDS_REJECTED", ""], // Pre-flight rejected
  ["SEND_COMMANDS", "ERROR", ""],

  // Send push options (if push-options capability)
  ["SEND_COMMANDS", "COMMANDS_SENT_OPTIONS", "SEND_PUSH_OPTIONS"],
  ["SEND_PUSH_OPTIONS", "OPTIONS_SENT", "SEND_PACK"],
  ["SEND_PUSH_OPTIONS", "ERROR", ""],

  // Send pack file containing objects needed for the push
  ["SEND_PACK", "PACK_SENT", "READ_STATUS"],
  ["SEND_PACK", "EMPTY_PACK", "READ_STATUS"], // Delete-only push
  ["SEND_PACK", "ERROR", ""],

  // Read status report (if report-status capability)
  ["READ_STATUS", "STATUS_OK", ""], // All refs updated
  ["READ_STATUS", "STATUS_PARTIAL", ""], // Some refs failed
  ["READ_STATUS", "STATUS_FAILED", ""], // All refs failed
  ["READ_STATUS", "ATOMIC_FAILED", ""], // Atomic push rejected
  ["READ_STATUS", "ERROR", ""],

  // No report-status capability: exit after pack sent
  ["SEND_PACK", "NO_REPORT_STATUS", ""],
];

/**
 * Client push FSM handlers.
 */
export const clientPushHandlers = new Map<string, FsmStateHandler<ProcessContext>>([
  // Initial handler
  ["", async () => "START"],

  // Read advertisement from server (receive-pack)
  [
    "READ_ADVERTISEMENT",
    async (ctx) => {
      try {
        const result = await parseAdvertisement(() => transport.readPktLine());
        applyAdvertisementToState(result, state);

        return result.isEmpty ? "EMPTY_REPO" : "REFS_RECEIVED";
      } catch (e) {
        ctx.output.error = String(e);
        return "ERROR";
      }
    },
  ],

  // Compute what refs need to be updated
  [
    "COMPUTE_UPDATES",
    async (ctx) => {
      try {
        const pushCommands: PushCommand[] = [];

        for (const refspec of config.pushRefspecs ?? []) {
          const { source, destination, force } = parseRefSpec(refspec);

          // Get local ref value
          const localOid = source ? await refStore.get(source) : undefined;
          // Get remote ref value
          const remoteOid = state.refs.get(destination ?? "") ?? ZERO_OID;

          // Determine command type
          let type: PushCommandType;
          if (!localOid || localOid === ZERO_OID) {
            if (remoteOid === ZERO_OID) continue; // Nothing to do
            type = "DELETE";
          } else if (remoteOid === ZERO_OID) {
            type = "CREATE";
          } else if (localOid === remoteOid) {
            continue; // Already up to date
          } else {
            // Check if fast-forward
            const isFastForward = await ctx.repository.has(remoteOid);
            type = isFastForward ? "UPDATE" : "UPDATE_NONFASTFORWARD";
          }

          // Check if non-fast-forward is allowed
          if (type === "UPDATE_NONFASTFORWARD" && !force) {
            output.error = `Cannot push non-fast-forward to ${destination ?? ""} without force`;
            return "LOCAL_VALIDATION_FAILED";
          }

          pushCommands.push({
            oldOid: remoteOid,
            newOid: localOid ?? ZERO_OID,
            refName: destination ?? "",
            type,
            result: "NOT_ATTEMPTED",
          });
        }

        // Store push commands in state for use by other handlers
        (ctx.state as PushProcessState).pushCommands = pushCommands;

        if (pushCommands.length === 0) {
          return "NO_UPDATES";
        }

        return "UPDATES_COMPUTED";
      } catch (e) {
        ctx.output.error = String(e);
        return "ERROR";
      }
    },
  ],

  // Send push commands
  [
    "SEND_COMMANDS",
    async (ctx) => {
      try {
        const state = ctx.state as PushProcessState;
        const atomic = ctx.config.atomic && ctx.state.capabilities.has("atomic");
        const pushOptions =
          ctx.config.pushOptions?.length && ctx.state.capabilities.has("push-options");

        // Build capability string for first command
        const caps: string[] = [];
        if (ctx.state.capabilities.has("report-status")) caps.push("report-status");
        if (ctx.state.capabilities.has("delete-refs")) caps.push("delete-refs");
        if (ctx.state.capabilities.has("ofs-delta")) caps.push("ofs-delta");
        if (ctx.state.capabilities.has("side-band-64k")) caps.push("side-band-64k");
        if (atomic) caps.push("atomic");
        if (pushOptions) caps.push("push-options");
        if (ctx.config.quiet && ctx.state.capabilities.has("quiet")) caps.push("quiet");

        let first = true;
        for (const cmd of state.pushCommands ?? []) {
          const line = first
            ? `${cmd.oldOid} ${cmd.newOid} ${cmd.refName}\0${caps.join(" ")}`
            : `${cmd.oldOid} ${cmd.newOid} ${cmd.refName}`;
          await ctx.transport.writeLine(line);
          first = false;
        }
        await ctx.transport.writeFlush();

        if (pushOptions) {
          return "COMMANDS_SENT_OPTIONS";
        }
        return atomic ? "COMMANDS_SENT_ATOMIC" : "COMMANDS_SENT";
      } catch (e) {
        ctx.output.error = String(e);
        return "ERROR";
      }
    },
  ],

  // Send push options
  [
    "SEND_PUSH_OPTIONS",
    async (ctx) => {
      try {
        for (const option of ctx.config.pushOptions ?? []) {
          await ctx.transport.writeLine(option);
        }
        await ctx.transport.writeFlush();
        return "OPTIONS_SENT";
      } catch (e) {
        ctx.output.error = String(e);
        return "ERROR";
      }
    },
  ],

  // Send pack file
  [
    "SEND_PACK",
    async (ctx) => {
      try {
        const state = ctx.state as PushProcessState;

        // Check if pack is needed (not needed for delete-only)
        const needsPack = state.pushCommands?.some((cmd) => cmd.type !== "DELETE");

        if (!needsPack) {
          // Empty pack for delete-only push
          // Server expects a minimal pack header
          const emptyPack = createEmptyPack();
          await ctx.transport.writePktLine(emptyPack);
          await ctx.transport.writeFlush();

          if (!ctx.state.capabilities.has("report-status")) {
            return "NO_REPORT_STATUS";
          }
          return "EMPTY_PACK";
        }

        // Collect objects needed for push
        const wants = new Set(
          (state.pushCommands ?? [])
            .filter((cmd) => cmd.type !== "DELETE")
            .map((cmd) => cmd.newOid),
        );
        const haves = new Set(
          (state.pushCommands ?? [])
            .filter((cmd) => cmd.oldOid !== ZERO_OID)
            .map((cmd) => cmd.oldOid),
        );

        // Export and send raw pack data.
        // In Git push protocol, sideband is server→client only.
        const packStream = repository.exportPack(wants, haves);
        await transport.writeRawPack(packStream);

        if (!ctx.state.capabilities.has("report-status")) {
          return "NO_REPORT_STATUS";
        }
        return "PACK_SENT";
      } catch (e) {
        ctx.output.error = String(e);
        return "ERROR";
      }
    },
  ],

  // Read status report
  [
    "READ_STATUS",
    async (ctx) => {
      try {
        const state = ctx.state as PushProcessState;
        const useSideband = ctx.state.capabilities.has("side-band-64k");
        let unpackStatus: string | null = null;
        const commandResults = new Map<string, { result: string; message?: string }>();

        // Read status lines
        while (true) {
          let line: string;

          if (useSideband) {
            const result = await ctx.transport.readSideband();
            if (result.channel === 1) {
              // Data channel - parse pkt-line within
              const text = new TextDecoder().decode(result.data);
              line = text.trim();
            } else if (result.channel === 2) {
              // Progress
              continue;
            } else if (result.channel === 3) {
              // Error
              ctx.output.error = new TextDecoder().decode(result.data);
              return "ERROR";
            } else {
              continue;
            }
          } else {
            const pkt = await ctx.transport.readPktLine();
            if (pkt.type === "flush" || pkt.type === "eof") break;
            if (pkt.type === "delim") continue;
            line = pkt.text.trim();
          }

          if (!line) break;

          // Parse status line
          if (line.startsWith("unpack ")) {
            unpackStatus = line.slice(7);
          } else if (line.startsWith("ok ")) {
            const refName = line.slice(3);
            commandResults.set(refName, { result: "OK" });
          } else if (line.startsWith("ng ")) {
            const parts = line.slice(3).split(" ", 2);
            const refName = parts[0];
            const reason = parts[1] ?? "rejected";
            commandResults.set(refName, { result: mapRejectReason(reason), message: reason });
          }
        }

        // Update command results
        let okCount = 0;
        let failCount = 0;

        for (const cmd of state.pushCommands ?? []) {
          const status = commandResults.get(cmd.refName);
          if (status) {
            cmd.result = status.result as PushCommandResult;
            cmd.message = status.message;
            if (status.result === "OK") okCount++;
            else failCount++;
          }
        }

        // Check unpack status
        if (unpackStatus && unpackStatus !== "ok") {
          ctx.output.error = `Unpack failed: ${unpackStatus}`;
          return "STATUS_FAILED";
        }

        // Determine overall result
        if (failCount === 0) {
          return "STATUS_OK";
        }
        if (okCount === 0) {
          // Check if atomic push failed
          if ((state.pushCommands ?? []).some((c) => c.result === "ATOMIC_REJECTED")) {
            return "ATOMIC_FAILED";
          }
          return "STATUS_FAILED";
        }
        return "STATUS_PARTIAL";
      } catch (e) {
        ctx.output.error = String(e);
        return "ERROR";
      }
    },
  ],
]);

/**
 * Extended ProcessContext state for push operations.
 */
interface PushProcessState {
  pushCommands?: PushCommand[];
}

/**
 * Create an empty pack file (header + checksum only).
 */
function createEmptyPack(): Uint8Array {
  // Pack header with 0 objects + SHA-1 checksum
  // "PACK" + version 2 + 0 objects + checksum
  return new Uint8Array([
    0x50,
    0x41,
    0x43,
    0x4b, // "PACK"
    0x00,
    0x00,
    0x00,
    0x02, // Version 2
    0x00,
    0x00,
    0x00,
    0x00, // 0 objects
    // SHA-1 checksum of the above header
    0x02,
    0x9d,
    0x08,
    0x82,
    0x3b,
    0xd8,
    0xa8,
    0xea,
    0xb5,
    0x10,
    0xad,
    0x6a,
    0xc7,
    0x5c,
    0x82,
    0x3c,
    0xfd,
    0x3e,
    0xd3,
    0x1e,
  ]);
}
