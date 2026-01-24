/**
 * Protocol V2 Client FSM.
 *
 * Handles the client side of Git protocol V2:
 * 1. Read server capabilities
 * 2. Send ls-refs command
 * 3. Send fetch command
 * 4. Process response sections (acks, shallow-info, wanted-refs, packfile)
 * 5. Update local refs
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
import type { FsmStateHandler, FsmTransition } from "../types.js";
import type { FetchV2Request } from "./types.js";

/**
 * Client V2 FSM transitions.
 */
export const clientV2Transitions: FsmTransition[] = [
  // Entry: read server capabilities
  ["", "START", "READ_CAPABILITIES"],

  // Read server capability advertisement
  ["READ_CAPABILITIES", "CAPS_RECEIVED", "SEND_LS_REFS"],
  ["READ_CAPABILITIES", "ERROR", ""],

  // Send ls-refs command (ref discovery)
  ["SEND_LS_REFS", "LS_REFS_SENT", "READ_LS_REFS_RESPONSE"],
  ["SEND_LS_REFS", "SKIP_LS_REFS", "COMPUTE_WANTS"], // Skip if refs already known
  ["SEND_LS_REFS", "ERROR", ""],

  // Read ls-refs response
  ["READ_LS_REFS_RESPONSE", "REFS_RECEIVED", "COMPUTE_WANTS"],
  ["READ_LS_REFS_RESPONSE", "ERROR", ""],

  // Compute wants
  ["COMPUTE_WANTS", "WANTS_COMPUTED", "SEND_FETCH"],
  ["COMPUTE_WANTS", "NO_WANTS", ""], // Up to date

  // Send fetch command
  ["SEND_FETCH", "FETCH_SENT", "READ_FETCH_RESPONSE"],
  ["SEND_FETCH", "ERROR", ""],

  // Read fetch response (may need multiple rounds)
  ["READ_FETCH_RESPONSE", "ACKS_ONLY", "SEND_FETCH"], // More haves needed
  ["READ_FETCH_RESPONSE", "SHALLOW_INFO", "PROCESS_SHALLOW"], // Process shallow info
  ["READ_FETCH_RESPONSE", "WANTED_REFS", "PROCESS_REFS"], // Process wanted-refs
  ["READ_FETCH_RESPONSE", "PACKFILE", "RECEIVE_PACK"], // Pack follows
  ["READ_FETCH_RESPONSE", "PACKFILE_URIS", "FETCH_PACKFILE_URIS"], // CDN URIs
  ["READ_FETCH_RESPONSE", "ERROR", ""],

  // Process shallow info
  ["PROCESS_SHALLOW", "SHALLOW_PROCESSED", "READ_FETCH_RESPONSE"],

  // Process wanted-refs
  ["PROCESS_REFS", "REFS_PROCESSED", "READ_FETCH_RESPONSE"],

  // Fetch from CDN URIs (packfile-uri extension)
  ["FETCH_PACKFILE_URIS", "URIS_FETCHED", "RECEIVE_PACK"],
  ["FETCH_PACKFILE_URIS", "ERROR", ""],

  // Receive pack
  ["RECEIVE_PACK", "PACK_RECEIVED", "UPDATE_REFS"],
  ["RECEIVE_PACK", "ERROR", ""],

  // Update local refs
  ["UPDATE_REFS", "REFS_UPDATED", ""],
  ["UPDATE_REFS", "ERROR", ""],
];

/**
 * Client V2 FSM handlers.
 */
export const clientV2Handlers = new Map<string, FsmStateHandler<ProcessContext>>([
  // Initial handler
  ["", async () => "START"],

  // Read server capabilities
  [
    "READ_CAPABILITIES",
    async (ctx) => {
      const transport = getTransport(ctx);
      const state = getState(ctx);
      const output = getOutput(ctx);
      try {
        while (true) {
          const pkt = await transport.readPktLine();
          if (pkt.type === "flush") break;
          if (pkt.type === "eof") {
            output.error = "Unexpected end of stream";
            return "ERROR";
          }
          if (pkt.type === "delim") {
            continue;
          }

          const line = pkt.text;

          // First line: version announcement
          if (line.startsWith("version 2")) {
            state.protocolVersion = 2;
            continue;
          }

          // Capability lines: "capability" or "capability=value"
          if (line.includes("=")) {
            const eqIdx = line.indexOf("=");
            const cap = line.slice(0, eqIdx);
            const value = line.slice(eqIdx + 1);
            state.capabilities.add(cap);
            state.capabilityValues = state.capabilityValues ?? new Map();
            state.capabilityValues.set(cap, value);
          } else {
            state.capabilities.add(line);
          }
        }

        return "CAPS_RECEIVED";
      } catch (e) {
        output.error = String(e);
        return "ERROR";
      }
    },
  ],

  // Send ls-refs command
  [
    "SEND_LS_REFS",
    async (ctx) => {
      const transport = getTransport(ctx);
      const state = getState(ctx);
      const config = getConfig(ctx);
      const output = getOutput(ctx);
      try {
        // Skip if we already have refs
        if (state.refs.size > 0 && !config.forceRefFetch) {
          return "SKIP_LS_REFS";
        }

        await transport.writeLine("command=ls-refs");

        // Arguments delimiter
        await transport.writeDelimiter();

        // Options
        if (config.lsRefsSymrefs) {
          await transport.writeLine("symrefs");
        }
        if (config.lsRefsPeel) {
          await transport.writeLine("peel");
        }
        if (config.lsRefsUnborn) {
          await transport.writeLine("unborn");
        }

        // Ref prefixes
        const prefixes = config.refPrefixes ?? ["refs/heads/", "refs/tags/"];
        for (const prefix of prefixes) {
          await transport.writeLine(`ref-prefix ${prefix}`);
        }

        await transport.writeFlush();
        return "LS_REFS_SENT";
      } catch (e) {
        output.error = String(e);
        return "ERROR";
      }
    },
  ],

  // Read ls-refs response
  [
    "READ_LS_REFS_RESPONSE",
    async (ctx) => {
      const transport = getTransport(ctx);
      const state = getState(ctx);
      const output = getOutput(ctx);
      try {
        while (true) {
          const pkt = await transport.readPktLine();
          if (pkt.type === "flush") break;
          if (pkt.type === "eof") {
            output.error = "Unexpected end of stream";
            return "ERROR";
          }
          if (pkt.type === "delim") {
            continue;
          }

          const line = pkt.text;
          // Format: <oid> <refname>[ <attribute>...]
          const parts = line.split(" ");
          const oid = parts[0];
          const refName = parts[1];

          state.refs.set(refName, oid);

          // Parse attributes (symref-target, peeled)
          for (let i = 2; i < parts.length; i++) {
            const attr = parts[i];
            if (attr.startsWith("symref-target:")) {
              state.symrefs = state.symrefs ?? new Map();
              state.symrefs.set(refName, attr.slice(14));
            } else if (attr.startsWith("peeled:")) {
              state.peeled = state.peeled ?? new Map();
              state.peeled.set(refName, attr.slice(7));
            }
          }
        }

        return "REFS_RECEIVED";
      } catch (e) {
        output.error = String(e);
        return "ERROR";
      }
    },
  ],

  // Compute wants
  [
    "COMPUTE_WANTS",
    async (ctx) => {
      const state = getState(ctx);
      const repository = getRepository(ctx);
      const output = getOutput(ctx);
      try {
        for (const [ref, oid] of state.refs) {
          if (!(await repository.has(oid))) {
            state.wants.add(oid);
            state.wantedRefs = state.wantedRefs ?? new Map();
            state.wantedRefs.set(ref, oid);
          }
        }

        if (state.wants.size === 0) {
          return "NO_WANTS";
        }

        return "WANTS_COMPUTED";
      } catch (e) {
        output.error = String(e);
        return "ERROR";
      }
    },
  ],

  // Send fetch command
  [
    "SEND_FETCH",
    async (ctx) => {
      const transport = getTransport(ctx);
      const state = getState(ctx);
      const config = getConfig(ctx);
      const output = getOutput(ctx);
      const repository = getRepository(ctx);
      try {
        await transport.writeLine("command=fetch");

        // Arguments section
        await transport.writeDelimiter();

        // Capabilities/options
        if (state.capabilities.has("thin-pack")) {
          await transport.writeLine("thin-pack");
        }
        if (config.noProgress) {
          await transport.writeLine("no-progress");
        }
        if (state.capabilities.has("include-tag")) {
          await transport.writeLine("include-tag");
        }
        if (state.capabilities.has("ofs-delta")) {
          await transport.writeLine("ofs-delta");
        }

        // Wants (using want-ref if available)
        if (state.capabilities.has("want-ref") && state.wantedRefs) {
          for (const [ref] of state.wantedRefs) {
            await transport.writeLine(`want-ref ${ref}`);
          }
        } else {
          for (const oid of state.wants) {
            await transport.writeLine(`want ${oid}`);
          }
        }

        // Haves
        output.havesSent = output.havesSent ?? 0;
        const maxHaves = config.maxHaves ?? 256;

        if (config.localHead) {
          for await (const oid of repository.walkAncestors(config.localHead)) {
            if (output.havesSent >= maxHaves) break;
            if (state.commonBase?.has(oid)) continue;

            await transport.writeLine(`have ${oid}`);
            state.haves.add(oid);
            output.havesSent++;
          }
        }

        // Shallow options
        if (config.depth) {
          await transport.writeLine(`deepen ${config.depth}`);
          if (config.deepenRelative) {
            await transport.writeLine("deepen-relative");
          }
        }
        if (config.shallowSince) {
          await transport.writeLine(`deepen-since ${config.shallowSince}`);
        }
        for (const ref of config.shallowExclude ?? []) {
          await transport.writeLine(`deepen-not ${ref}`);
        }

        // Filter (partial clone)
        if (config.filter) {
          await transport.writeLine(`filter ${config.filter}`);
        }

        // Done (in stateless mode, always send done)
        if (config.statelessRpc || output.havesSent >= maxHaves) {
          await transport.writeLine("done");
          state.sentDone = true;
        }

        await transport.writeFlush();
        return "FETCH_SENT";
      } catch (e) {
        output.error = String(e);
        return "ERROR";
      }
    },
  ],

  // Read fetch response
  [
    "READ_FETCH_RESPONSE",
    async (ctx) => {
      const transport = getTransport(ctx);
      const state = getState(ctx);
      const output = getOutput(ctx);
      try {
        while (true) {
          const pkt = await transport.readPktLine();

          if (pkt.type === "flush") {
            // End of response without packfile means more haves needed
            if (!state.sentDone) {
              return "ACKS_ONLY";
            }
            output.error = "Expected packfile but got flush";
            return "ERROR";
          }

          if (pkt.type === "delim") {
            continue;
          }

          if (pkt.type === "eof") {
            output.error = "Unexpected end of stream";
            return "ERROR";
          }

          const line = pkt.text;

          // Section headers
          if (line === "acknowledgments") {
            state.currentSection = "acknowledgments";
            continue;
          }
          if (line === "shallow-info") {
            state.currentSection = "shallow-info";
            return "SHALLOW_INFO";
          }
          if (line === "wanted-refs") {
            state.currentSection = "wanted-refs";
            return "WANTED_REFS";
          }
          if (line === "packfile-uris") {
            state.currentSection = "packfile-uris";
            state.packfileUris = [];
            continue;
          }
          if (line === "packfile") {
            return "PACKFILE";
          }

          // Section content
          if (state.currentSection === "acknowledgments") {
            if (line.startsWith("ACK ")) {
              const oid = line.slice(4);
              state.commonBase = state.commonBase ?? new Set();
              state.commonBase.add(oid);
            } else if (line === "ready") {
              state.serverReady = true;
            }
          } else if (state.currentSection === "packfile-uris") {
            state.packfileUris = state.packfileUris ?? [];
            state.packfileUris.push(line);
          }
        }
      } catch (e) {
        output.error = String(e);
        return "ERROR";
      }
    },
  ],

  // Process shallow info
  [
    "PROCESS_SHALLOW",
    async (ctx) => {
      const transport = getTransport(ctx);
      const state = getState(ctx);
      const output = getOutput(ctx);
      try {
        while (true) {
          const pkt = await transport.readPktLine();
          if (pkt.type === "delim") break;
          if (pkt.type === "flush") {
            state.currentSection = undefined;
            break;
          }
          if (pkt.type === "eof") {
            output.error = "Unexpected end of stream";
            return "ERROR";
          }

          const line = pkt.text;
          if (line.startsWith("shallow ")) {
            state.clientShallow = state.clientShallow ?? new Set();
            state.clientShallow.add(line.slice(8));
          } else if (line.startsWith("unshallow ")) {
            state.serverUnshallow = state.serverUnshallow ?? new Set();
            state.serverUnshallow.add(line.slice(10));
          }
        }

        return "SHALLOW_PROCESSED";
      } catch (e) {
        output.error = String(e);
        return "ERROR";
      }
    },
  ],

  // Process wanted-refs
  [
    "PROCESS_REFS",
    async (ctx) => {
      const transport = getTransport(ctx);
      const state = getState(ctx);
      const output = getOutput(ctx);
      try {
        state.resolvedWantedRefs = new Map();

        while (true) {
          const pkt = await transport.readPktLine();
          if (pkt.type === "delim") break;
          if (pkt.type === "flush") {
            state.currentSection = undefined;
            break;
          }
          if (pkt.type === "eof") {
            output.error = "Unexpected end of stream";
            return "ERROR";
          }

          const line = pkt.text;
          // Format: <oid> <refname>
          const spaceIdx = line.indexOf(" ");
          if (spaceIdx !== -1) {
            const oid = line.slice(0, spaceIdx);
            const refName = line.slice(spaceIdx + 1);
            state.resolvedWantedRefs.set(refName, oid);
          }
        }

        return "REFS_PROCESSED";
      } catch (e) {
        output.error = String(e);
        return "ERROR";
      }
    },
  ],

  // Fetch packfile URIs (CDN extension)
  [
    "FETCH_PACKFILE_URIS",
    async (ctx) => {
      const state = getState(ctx);
      const output = getOutput(ctx);
      try {
        // For now, just mark URIs as fetched
        // Actual CDN fetching would be implemented by the caller
        output.packfileUrisFetched = state.packfileUris?.length ?? 0;
        return "URIS_FETCHED";
      } catch (e) {
        output.error = String(e);
        return "ERROR";
      }
    },
  ],

  // Receive pack
  [
    "RECEIVE_PACK",
    async (ctx) => {
      const transport = getTransport(ctx);
      const repository = getRepository(ctx);
      const output = getOutput(ctx);
      try {
        const packStream = transport.readPack();
        const result = await repository.importPack(packStream);
        output.packResult = result;
        return "PACK_RECEIVED";
      } catch (e) {
        output.error = String(e);
        return "ERROR";
      }
    },
  ],

  // Update local refs
  [
    "UPDATE_REFS",
    async (ctx) => {
      const state = getState(ctx);
      const refStore = getRefStore(ctx);
      const output = getOutput(ctx);
      try {
        // Use resolved wanted-refs if available, otherwise use refs from ls-refs
        const refsToUpdate = state.resolvedWantedRefs ?? state.wantedRefs ?? new Map();

        for (const [refName, oid] of refsToUpdate) {
          await refStore.update(refName, oid);
        }

        return "REFS_UPDATED";
      } catch (e) {
        output.error = String(e);
        return "ERROR";
      }
    },
  ],
]);

/**
 * Extended context state for V2 client operations.
 */
export interface V2ClientState {
  fetchRequest?: FetchV2Request;
  currentSection?: string;
  packfileUris?: string[];
  resolvedWantedRefs?: Map<string, string>;
}
