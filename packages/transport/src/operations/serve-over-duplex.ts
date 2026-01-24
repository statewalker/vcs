/**
 * High-level server operation over any Duplex stream.
 *
 * Serves Git requests (fetch/push) over any bidirectional stream.
 * Detects the service type from the incoming request and runs
 * the appropriate FSM.
 */

import type { Duplex } from "../api/duplex.js";
import type { ServeResult } from "../api/fetch-result.js";
import type { RepositoryFacade } from "../api/repository-facade.js";
import {
  getOutput,
  type ProcessContext,
  setConfig,
  setOutput,
  setRefStore,
  setRepository,
  setState,
  setTransport,
} from "../context/context-adapters.js";
import { HandlerOutput } from "../context/handler-output.js";
import type { ProcessConfiguration } from "../context/process-config.js";
import type { RefStore } from "../context/process-context.js";
import { ProtocolState } from "../context/protocol-state.js";
import { createTransportApi } from "../factories/transport-api-factory.js";
import { serverFetchHandlers, serverFetchTransitions } from "../fsm/fetch/server-fetch-fsm.js";
import { Fsm } from "../fsm/fsm.js";
import { serverPushHandlers, serverPushTransitions } from "../fsm/push/server-push-fsm.js";
import type { ServiceType } from "../protocol/types.js";

/**
 * Options for serve-over-duplex operation.
 */
export interface ServeOverDuplexOptions {
  /** Bidirectional stream to serve requests on */
  duplex: Duplex;
  /** Repository facade for pack import/export */
  repository: RepositoryFacade;
  /** Ref store for reading/writing refs */
  refStore: RefStore;
  /** Service type to serve (auto-detect if not specified) */
  service?: ServiceType;
  /** Allow ref deletions (receive-pack only) */
  allowDeletes?: boolean;
  /** Allow non-fast-forward updates (receive-pack only) */
  allowNonFastForward?: boolean;
  /** Deny updates to the currently checked-out branch */
  denyCurrentBranch?: boolean;
  /** Currently checked-out branch (for denyCurrentBranch) */
  currentBranch?: string;
  /** Server capabilities to advertise */
  capabilities?: string[];
}

/**
 * Serves Git requests over a Duplex stream.
 *
 * This is the transport-agnostic server operation that works with any
 * bidirectional stream (MessagePort, WebSocket, WebRTC, HTTP, etc.).
 *
 * @param options - Serve options including duplex, repository, and refStore
 * @returns Serve result with success status
 *
 * @example
 * ```ts
 * // Using with MessagePort
 * const channel = new MessageChannel();
 * const duplex = createMessagePortDuplex(channel.port2);
 *
 * const result = await serveOverDuplex({
 *   duplex,
 *   repository: serverRepo,
 *   refStore: serverRefStore,
 *   service: "git-upload-pack",
 * });
 *
 * if (result.success) {
 *   console.log("Served request successfully");
 * }
 * ```
 */
export async function serveOverDuplex(options: ServeOverDuplexOptions): Promise<ServeResult> {
  const { duplex, repository, refStore, service = "git-upload-pack" } = options;

  const state = new ProtocolState();
  const transport = createTransportApi(duplex, state);

  // Populate refs from refStore for advertisement
  const allRefs = await refStore.listAll();
  for (const [refName, oid] of allRefs) {
    state.refs.set(refName, oid);
  }

  const config: ProcessConfiguration = {
    localHead: options.currentBranch ?? "refs/heads/main",
    maxHaves: 256,
    serverCapabilities: options.capabilities,
    allowDeletes: options.allowDeletes ?? true,
    allowNonFastForward: options.allowNonFastForward ?? false,
    denyCurrentBranch: options.denyCurrentBranch ?? true,
    currentBranch: options.currentBranch,
  };

  const output = new HandlerOutput();

  const ctx: ProcessContext = {};
  setTransport(ctx, transport);
  setRepository(ctx, repository);
  setRefStore(ctx, refStore);
  setState(ctx, state);
  setOutput(ctx, output);
  setConfig(ctx, config);

  // Select FSM based on service type
  const fsm =
    service === "git-receive-pack"
      ? new Fsm(serverPushTransitions, serverPushHandlers)
      : new Fsm(serverFetchTransitions, serverFetchHandlers);

  try {
    const success = await fsm.run(ctx);

    const ctxOutput = getOutput(ctx);
    if (!success || ctxOutput.error) {
      return {
        success: false,
        error: ctxOutput.error ?? "FSM did not complete successfully",
      };
    }

    return {
      success: true,
      objectsSent: ctxOutput.objectCount,
    };
  } catch (error) {
    return {
      success: false,
      error: error instanceof Error ? error.message : String(error),
    };
  }
}
