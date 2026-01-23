/**
 * High-level fetch operation over any Duplex stream.
 *
 * Composes FSM, TransportApi, and RepositoryFacade to perform
 * a Git fetch operation over any bidirectional stream.
 */

import type { Duplex } from "../api/duplex.js";
import type { FetchResult } from "../api/fetch-result.js";
import type { RepositoryFacade } from "../api/repository-facade.js";
import { HandlerOutput } from "../context/handler-output.js";
import type { ProcessConfiguration } from "../context/process-config.js";
import type { ProcessContext, RefStore } from "../context/process-context.js";
import { ProtocolState } from "../context/protocol-state.js";
import { createTransportApi } from "../factories/transport-api-factory.js";
import {
  clientFetchHandlers,
  clientFetchTransitions,
} from "../fsm/fetch/client-fetch-fsm.js";
import { Fsm } from "../fsm/fsm.js";

/**
 * Options for fetch-over-duplex operation.
 */
export interface FetchOverDuplexOptions {
  /** Bidirectional stream to use for transport */
  duplex: Duplex;
  /** Repository facade for pack import */
  repository: RepositoryFacade;
  /** Ref store for reading/writing refs */
  refStore: RefStore;
  /** Refspecs to fetch (if not all refs) */
  refspecs?: string[];
  /** Shallow clone depth */
  depth?: number;
  /** Filter spec for partial clone (e.g., "blob:none") */
  filter?: string;
  /** Local HEAD ref for negotiation */
  localHead?: string;
  /** Maximum haves to send during negotiation */
  maxHaves?: number;
}

/**
 * Performs a Git fetch over a Duplex stream.
 *
 * This is the transport-agnostic fetch operation that works with any
 * bidirectional stream (MessagePort, WebSocket, WebRTC, HTTP, etc.).
 *
 * @param options - Fetch options including duplex, repository, and refStore
 * @returns Fetch result with success status and updated refs
 *
 * @example
 * ```ts
 * // Using with MessagePort
 * const channel = new MessageChannel();
 * const duplex = createMessagePortDuplex(channel.port1);
 *
 * const result = await fetchOverDuplex({
 *   duplex,
 *   repository: myRepo,
 *   refStore: myRefStore,
 *   depth: 1, // shallow clone
 * });
 *
 * if (result.success) {
 *   console.log("Fetched refs:", result.updatedRefs);
 * }
 * ```
 */
export async function fetchOverDuplex(
  options: FetchOverDuplexOptions,
): Promise<FetchResult> {
  const { duplex, repository, refStore } = options;

  const state = new ProtocolState();
  const transport = createTransportApi(duplex, state);

  const config: ProcessConfiguration = {
    localHead: options.localHead ?? "refs/heads/main",
    maxHaves: options.maxHaves ?? 256,
    depth: options.depth,
    filter: options.filter,
  };

  const output = new HandlerOutput();

  const ctx: ProcessContext = {
    transport,
    repository,
    refStore,
    state,
    output,
    config,
  };

  const fsm = new Fsm(clientFetchTransitions, clientFetchHandlers);

  try {
    const success = await fsm.run(ctx);

    if (!success || ctx.output.error) {
      return {
        success: false,
        error: ctx.output.error ?? "FSM did not complete successfully",
      };
    }

    // Update local refs to match remote refs
    const updatedRefs = new Map<string, string>();
    for (const [refName, oid] of state.refs) {
      await refStore.update(refName, oid);
      updatedRefs.set(refName, oid);
    }

    return {
      success: true,
      updatedRefs,
      objectsImported: ctx.output.packResult?.objectsImported,
    };
  } catch (error) {
    return {
      success: false,
      error: error instanceof Error ? error.message : String(error),
    };
  }
}
