/**
 * Client Fetch FSM - handles Git fetch operations from the client perspective.
 *
 * Protocol flow:
 * 1. Read refs from server advertisement
 * 2. Send wants (objects we need)
 * 3. Send shallow info (if shallow clone)
 * 4. Negotiate with haves/acks
 * 5. Receive pack
 * 6. Update local refs
 */

import type { ProcessContext } from "../../context/process-context.js";
import type { FsmStateHandler, FsmTransition } from "../types.js";

/**
 * Client fetch FSM transitions.
 */
export const clientFetchTransitions: FsmTransition[] = [
  // Entry point: "" is the initial state
  ["", "START", "READ_ADVERTISEMENT"],

  // Read refs from server
  ["READ_ADVERTISEMENT", "REFS_RECEIVED", "SEND_WANTS"],
  ["READ_ADVERTISEMENT", "EMPTY_REPO", ""], // Server has no refs
  ["READ_ADVERTISEMENT", "ERROR", ""],

  // Send wants to server
  ["SEND_WANTS", "WANTS_SENT", "SEND_SHALLOW_INFO"],
  ["SEND_WANTS", "WANTS_SENT_NO_SHALLOW", "SEND_HAVES"], // No shallow needed
  ["SEND_WANTS", "NO_WANTS", ""], // nothing to fetch, exit
  ["SEND_WANTS", "ERROR", ""],

  // Shallow fetch: send depth/since/not info
  ["SEND_SHALLOW_INFO", "SHALLOW_SENT", "SEND_HAVES"],
  ["SEND_SHALLOW_INFO", "DEEPEN_SENT", "READ_SHALLOW_UPDATE"],
  ["SEND_SHALLOW_INFO", "ERROR", ""],

  // Read shallow update from server
  ["READ_SHALLOW_UPDATE", "SHALLOW_UPDATED", "SEND_HAVES"],
  ["READ_SHALLOW_UPDATE", "ERROR", ""],

  // Partial clone: send filter specification
  ["SEND_WANTS", "WANTS_SENT_FILTER", "SEND_FILTER"],
  ["SEND_FILTER", "FILTER_SENT", "SEND_SHALLOW_INFO"],
  ["SEND_FILTER", "ERROR", ""],

  // Negotiation: send haves
  ["SEND_HAVES", "HAVES_SENT", "READ_ACKS"],
  ["SEND_HAVES", "NO_HAVES", "SEND_DONE"], // no local commits
  ["SEND_HAVES", "ALL_HAVES_SENT", "SEND_DONE"], // Stateless RPC: all haves at once
  ["SEND_HAVES", "ERROR", ""],

  // Negotiation: read ACK/NAK responses
  ["READ_ACKS", "NAK", "SEND_HAVES"], // continue sending
  ["READ_ACKS", "ACK_CONTINUE", "SEND_HAVES"], // common found, continue
  ["READ_ACKS", "ACK_COMMON", "SEND_HAVES"], // multi_ack_detailed: common base found
  ["READ_ACKS", "ACK_READY", "RECEIVE_PACK"], // server ready (no-done)
  ["READ_ACKS", "ACK_SINGLE", "RECEIVE_PACK"], // single-ack mode: go directly to pack
  ["READ_ACKS", "MAX_HAVES", "SEND_DONE"], // sent enough
  ["READ_ACKS", "ERROR", ""],

  // Send done
  ["SEND_DONE", "DONE_SENT", "READ_FINAL_ACK"],
  ["SEND_DONE", "DONE_SENT_STATELESS", "RECEIVE_PACK"], // Stateless RPC: no final ack
  ["SEND_DONE", "ERROR", ""],

  // Read final ACK/NAK after done
  ["READ_FINAL_ACK", "ACK_FINAL", "RECEIVE_PACK"],
  ["READ_FINAL_ACK", "NAK_FINAL", "RECEIVE_PACK"], // clone case
  ["READ_FINAL_ACK", "ERROR", ""],

  // Receive pack data
  ["RECEIVE_PACK", "PACK_RECEIVED", "UPDATE_REFS"],
  ["RECEIVE_PACK", "SIDEBAND_ERROR", ""], // Error on channel 3
  ["RECEIVE_PACK", "ERROR", ""],

  // Update local refs after successful pack import
  ["UPDATE_REFS", "REFS_UPDATED", ""], // exit
  ["UPDATE_REFS", "ERROR", ""],
];

/**
 * Client fetch FSM handlers.
 */
export const clientFetchHandlers = new Map<string, FsmStateHandler<ProcessContext>>([
  // Initial handler - triggers START event
  ["", async () => "START"],

  // Read advertisement from server
  [
    "READ_ADVERTISEMENT",
    async (ctx) => {
      try {
        while (true) {
          const pkt = await ctx.transport.readPktLine();
          if (pkt.type === "flush") break;
          if (pkt.type === "eof") {
            ctx.output.error = "Unexpected end of stream";
            return "ERROR";
          }
          if (pkt.type === "delim") {
            continue; // Unexpected delimiter in v1 advertisement
          }

          // Type narrowing: pkt.type === "data" guaranteed here
          const line = pkt.text;
          // Split on FIRST space only — split(" ", 2) truncates results
          const spaceIdx = line.indexOf(" ");
          const oid = spaceIdx >= 0 ? line.slice(0, spaceIdx) : line;
          const refAndCaps = spaceIdx >= 0 ? line.slice(spaceIdx + 1) : undefined;

          // Check for empty repository (special capabilities^{} line)
          if (refAndCaps?.startsWith("capabilities^{}")) {
            const [, caps] = refAndCaps.split("\0");
            if (caps) {
              for (const c of caps.split(" ")) {
                ctx.state.capabilities.add(c);
              }
            }
            continue; // Don't store this as a real ref
          }

          if (refAndCaps?.includes("\0")) {
            const [ref, caps] = refAndCaps.split("\0");
            ctx.state.refs.set(ref, oid);
            for (const c of caps.split(" ")) {
              ctx.state.capabilities.add(c);
            }
          } else if (refAndCaps) {
            ctx.state.refs.set(refAndCaps, oid);
          }
        }

        // Empty repository check
        if (ctx.state.refs.size === 0) {
          return "EMPTY_REPO";
        }

        return "REFS_RECEIVED";
      } catch (e) {
        ctx.output.error = String(e);
        return "ERROR";
      }
    },
  ],

  // Send wants
  [
    "SEND_WANTS",
    async (ctx) => {
      try {
        // Determine what we want (objects we don't have locally)
        for (const [, oid] of ctx.state.refs) {
          if (!(await ctx.repository.has(oid))) {
            ctx.state.wants.add(oid);
          }
        }

        if (ctx.state.wants.size === 0) {
          return "NO_WANTS";
        }

        // Build capability string
        const supportedCaps = [
          "multi_ack_detailed",
          "side-band-64k",
          "thin-pack",
          "no-done",
          "ofs-delta",
          "shallow",
          "deepen-since",
          "deepen-not",
          "filter",
          "include-tag",
          "no-progress",
        ];
        const clientCaps = [...ctx.state.capabilities].filter((c) => supportedCaps.includes(c));

        let first = true;
        for (const oid of ctx.state.wants) {
          const line = first ? `want ${oid} ${clientCaps.join(" ")}` : `want ${oid}`;
          await ctx.transport.writeLine(line);
          first = false;
        }
        await ctx.transport.writeFlush();

        // Determine next state based on configuration
        if (ctx.config.filter) {
          return "WANTS_SENT_FILTER";
        }
        if (ctx.config.depth || ctx.config.shallowSince || ctx.config.shallowExclude?.length) {
          return "WANTS_SENT"; // Goes to SEND_SHALLOW_INFO
        }
        return "WANTS_SENT_NO_SHALLOW"; // Skip shallow, go directly to haves
      } catch (e) {
        ctx.output.error = String(e);
        return "ERROR";
      }
    },
  ],

  // Send filter specification (partial clone)
  [
    "SEND_FILTER",
    async (ctx) => {
      try {
        if (ctx.config.filter) {
          await ctx.transport.writeLine(`filter ${ctx.config.filter}`);
        }
        await ctx.transport.writeFlush();
        return "FILTER_SENT";
      } catch (e) {
        ctx.output.error = String(e);
        return "ERROR";
      }
    },
  ],

  // Send shallow information
  [
    "SEND_SHALLOW_INFO",
    async (ctx) => {
      try {
        // Send existing shallow boundaries
        for (const oid of ctx.state.clientShallow ?? []) {
          await ctx.transport.writeLine(`shallow ${oid}`);
        }

        // Send deepen request
        if (ctx.config.depth) {
          await ctx.transport.writeLine(`deepen ${ctx.config.depth}`);
          await ctx.transport.writeFlush();
          return "DEEPEN_SENT";
        }
        if (ctx.config.shallowSince) {
          await ctx.transport.writeLine(`deepen-since ${ctx.config.shallowSince}`);
          await ctx.transport.writeFlush();
          return "DEEPEN_SENT";
        }
        if (ctx.config.shallowExclude) {
          for (const ref of ctx.config.shallowExclude) {
            await ctx.transport.writeLine(`deepen-not ${ref}`);
          }
          await ctx.transport.writeFlush();
          return "DEEPEN_SENT";
        }

        await ctx.transport.writeFlush();
        return "SHALLOW_SENT";
      } catch (e) {
        ctx.output.error = String(e);
        return "ERROR";
      }
    },
  ],

  // Read shallow update from server
  [
    "READ_SHALLOW_UPDATE",
    async (ctx) => {
      try {
        ctx.state.serverShallow = ctx.state.serverShallow ?? new Set();
        ctx.state.serverUnshallow = ctx.state.serverUnshallow ?? new Set();

        while (true) {
          const pkt = await ctx.transport.readPktLine();
          if (pkt.type === "flush") break;
          if (pkt.type === "eof") {
            ctx.output.error = "Unexpected end of input during shallow update";
            return "ERROR";
          }
          if (pkt.type === "delim") {
            continue; // Unexpected delimiter in shallow update
          }

          // Type narrowing: pkt.type === "data" guaranteed here
          const line = pkt.text;
          if (line.startsWith("shallow ")) {
            ctx.state.serverShallow.add(line.slice(8));
          } else if (line.startsWith("unshallow ")) {
            ctx.state.serverUnshallow.add(line.slice(10));
          }
        }
        return "SHALLOW_UPDATED";
      } catch (e) {
        ctx.output.error = String(e);
        return "ERROR";
      }
    },
  ],

  // Send haves
  [
    "SEND_HAVES",
    async (ctx) => {
      try {
        const BATCH_SIZE = 32;
        let sentInBatch = 0;
        ctx.output.havesSent = ctx.output.havesSent ?? 0;
        ctx.output.havesSinceLastContinue = ctx.output.havesSinceLastContinue ?? 0;

        const maxHaves = ctx.config.maxHaves ?? 256;

        // Stateless RPC mode (HTTP): send all haves at once
        if (ctx.config.statelessRpc) {
          if (ctx.config.localHead) {
            for await (const oid of ctx.repository.walkAncestors(ctx.config.localHead)) {
              if (ctx.state.commonBase.has(oid)) continue;
              await ctx.transport.writeLine(`have ${oid}`);
              ctx.state.haves.add(oid);
              ctx.output.havesSent++;
              ctx.output.havesSinceLastContinue++;
            }
          }
          await ctx.transport.writeFlush();
          return ctx.output.havesSent > 0 ? "ALL_HAVES_SENT" : "NO_HAVES";
        }

        // Walk local commit ancestry (streaming mode)
        if (ctx.config.localHead) {
          for await (const oid of ctx.repository.walkAncestors(ctx.config.localHead)) {
            // Check max haves limit (JGit uses both total and since-continue)
            // If we've received a continue ACK and sent many haves since, stop
            if (
              ctx.output.havesSent >= maxHaves ||
              (ctx.output.receivedContinue && ctx.output.havesSinceLastContinue >= maxHaves)
            ) {
              await ctx.transport.writeFlush();
              return "MAX_HAVES";
            }

            if (ctx.state.commonBase.has(oid)) continue;

            await ctx.transport.writeLine(`have ${oid}`);
            ctx.state.haves.add(oid);
            ctx.output.havesSent++;
            ctx.output.havesSinceLastContinue++;
            sentInBatch++;

            if (sentInBatch >= BATCH_SIZE) {
              await ctx.transport.writeFlush();

              // JGit "race ahead" optimization: on first block (32 haves),
              // continue sending without waiting for ACKs to reduce latency.
              // Only for persistent connections (not stateless RPC).
              if (ctx.output.havesSent === BATCH_SIZE) {
                sentInBatch = 0;
                continue; // Send another batch before reading ACKs
              }

              return "HAVES_SENT";
            }
          }
        }

        if (sentInBatch > 0) {
          await ctx.transport.writeFlush();
          return "HAVES_SENT";
        }
        return "NO_HAVES";
      } catch (e) {
        ctx.output.error = String(e);
        return "ERROR";
      }
    },
  ],

  // Read ACK/NAK responses
  [
    "READ_ACKS",
    async (ctx) => {
      try {
        const multiAckDetailed = ctx.state.capabilities.has("multi_ack_detailed");
        const multiAck = ctx.state.capabilities.has("multi_ack");

        while (true) {
          const pkt = await ctx.transport.readPktLine();

          if (pkt.type === "flush") {
            return "NAK";
          }
          if (pkt.type === "eof") {
            ctx.output.error = "Unexpected end of input";
            return "ERROR";
          }
          if (pkt.type === "delim") {
            continue; // Unexpected delimiter in v1 negotiation
          }

          // Type narrowing: pkt.type === "data" guaranteed here
          const line = pkt.text;

          // Handle NAK (same in all modes)
          if (line === "NAK") {
            return "NAK";
          }

          // Single ACK mode (no multi_ack capability):
          // Server sends at most ONE ACK, then we go directly to pack.
          if (!multiAck && !multiAckDetailed) {
            if (line.startsWith("ACK ")) {
              const oid = line.split(" ")[1];
              ctx.state.commonBase.add(oid);
              ctx.output.lastAckOid = oid;
              return "ACK_SINGLE";
            }
            // In single-ack mode, unexpected input means protocol error
            ctx.output.error = `Unexpected response in single-ack mode: ${line}`;
            return "ERROR";
          }

          // Multi-ack modes (multi_ack or multi_ack_detailed)
          if (line.startsWith("ACK ")) {
            const parts = line.split(" ");
            const oid = parts[1];
            const mode = parts[2]?.trim();
            ctx.state.commonBase.add(oid);
            ctx.output.lastAckOid = oid;

            // multi_ack_detailed modes
            if (multiAckDetailed) {
              if (mode === "ready") {
                ctx.output.receivedReady = true;
                ctx.output.receivedContinue = true;
                return "ACK_READY";
              }
              if (mode === "common") {
                // Common ACK doesn't reset havesSinceLastContinue
                return "ACK_COMMON";
              }
              if (mode === "continue") {
                // Continue ACK: reset havesSinceLastContinue counter (JGit behavior)
                ctx.output.receivedContinue = true;
                ctx.output.havesSinceLastContinue = 0;
                return "ACK_CONTINUE";
              }
            }

            // multi_ack mode (not detailed): bare ACK means continue
            if (multiAck) {
              if (mode === "continue") {
                // Reset havesSinceLastContinue on continue ACK
                ctx.output.receivedContinue = true;
                ctx.output.havesSinceLastContinue = 0;
                return "ACK_CONTINUE";
              }
              // In multi_ack mode, a bare ACK without "continue" is final
              // This happens when server decides it has enough common base
              return "ACK_FINAL";
            }

            // Single ACK mode: any ACK is final
            return "ACK_FINAL";
          }
        }
      } catch (e) {
        ctx.output.error = String(e);
        return "ERROR";
      }
    },
  ],

  // Send done
  [
    "SEND_DONE",
    async (ctx) => {
      try {
        await ctx.transport.writeLine("done");

        // Stateless RPC: no final ACK expected, go directly to pack
        if (ctx.config.statelessRpc) {
          return "DONE_SENT_STATELESS";
        }
        return "DONE_SENT";
      } catch (e) {
        ctx.output.error = String(e);
        return "ERROR";
      }
    },
  ],

  // Read final ACK/NAK
  [
    "READ_FINAL_ACK",
    async (ctx) => {
      try {
        // JGit reads exactly one final ACK or NAK before pack data
        // Limit iterations to prevent infinite loop on malformed input
        const maxIterations = 100;
        let iterations = 0;

        while (iterations++ < maxIterations) {
          const pkt = await ctx.transport.readPktLine();

          if (pkt.type === "eof") {
            ctx.output.error = "Expected final ACK/NAK";
            return "ERROR";
          }

          // Flush indicates end of negotiation, proceed to pack
          if (pkt.type === "flush") {
            // No final ACK - treat as NAK (clone case)
            return "NAK_FINAL";
          }

          if (pkt.type === "data") {
            const line = pkt.text;
            if (line === "NAK") return "NAK_FINAL";
            if (line.startsWith("ACK ")) {
              // Store the final ACK oid
              const oid = line.split(" ")[1];
              ctx.output.lastAckOid = oid;
              return "ACK_FINAL";
            }
            // Skip unexpected lines (e.g., progress messages)
          }
        }

        ctx.output.error = "Too many packets waiting for final ACK/NAK";
        return "ERROR";
      } catch (e) {
        ctx.output.error = String(e);
        return "ERROR";
      }
    },
  ],

  // Receive pack: read bytes from transport, import via SerializationApi
  [
    "RECEIVE_PACK",
    async (ctx) => {
      try {
        // Handle sideband multiplexing
        if (ctx.state.capabilities.has("side-band-64k")) {
          const packChunks: Uint8Array[] = [];

          // Read pkt-lines and demux sideband channels until flush/eof.
          // Uses readPktLine() directly because readSideband() throws on
          // flush packets which are the normal termination signal.
          while (true) {
            const pkt = await transport.readPktLine();
            if (pkt.type === "flush" || pkt.type === "eof") break;
            if (pkt.type !== "data" || pkt.payload.length < 1) continue;

            const channel = pkt.payload[0];
            const data = pkt.payload.slice(1);

            if (channel === 1) {
              // Pack data channel
              packChunks.push(data);
            } else if (channel === 2) {
              // Progress message channel
              if (!config.noProgress) {
                output.progress = new TextDecoder().decode(data);
              }
            } else if (channel === 3) {
              // Error message from server
              output.error = new TextDecoder().decode(data);
              return "SIDEBAND_ERROR";
            }
          }

          // Import collected pack data
          const packIterable = (async function* () {
            for (const chunk of packChunks) yield chunk;
          })();
          const importResult = await ctx.repository.importPack(packIterable);
          ctx.output.objectCount = importResult.objectsImported;
        } else {
          // Raw pack data (no sideband)
          const importResult = await ctx.repository.importPack(ctx.transport.readPack());
          ctx.output.objectCount = importResult.objectsImported;
        }

        return "PACK_RECEIVED";
      } catch (e) {
        ctx.output.error = String(e);
        return "ERROR";
      }
    },
  ],

  // Update local refs after successful pack import
  [
    "UPDATE_REFS",
    async (ctx) => {
      try {
        if (ctx.config.wantedRefs) {
          for (const [ref, oid] of ctx.config.wantedRefs) {
            await ctx.refStore.update(ref, oid);
          }
        }

        // Handle include-tag: update tag refs if server sent additional tags
        if (ctx.state.capabilities.has("include-tag") && ctx.output.additionalTags) {
          for (const [tagRef, tagOid] of ctx.output.additionalTags) {
            await ctx.refStore.update(tagRef, tagOid);
          }
        }

        return "REFS_UPDATED";
      } catch (e) {
        ctx.output.error = String(e);
        return "ERROR";
      }
    },
  ],
]);
