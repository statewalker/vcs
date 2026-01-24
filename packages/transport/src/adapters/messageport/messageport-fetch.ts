/**
 * MessagePort-based fetch client.
 *
 * Runs a Git fetch operation over a MessagePort channel.
 * Connects to a server running messagePortServe on the other end.
 */

import type { FetchResult } from "../../api/fetch-result.js";
import type { RepositoryFacade } from "../../api/repository-facade.js";
import {
  getOutput,
  type ProcessContext,
  setConfig,
  setOutput,
  setRefStore,
  setRepository,
  setState,
  setTransport,
} from "../../context/context-adapters.js";
import { HandlerOutput } from "../../context/handler-output.js";
import type { ProcessConfiguration } from "../../context/process-config.js";
import type { RefStore } from "../../context/process-context.js";
import { ProtocolState } from "../../context/protocol-state.js";
import { createTransportApi } from "../../factories/transport-api-factory.js";
import { clientFetchHandlers, clientFetchTransitions } from "../../fsm/fetch/client-fetch-fsm.js";
import { Fsm } from "../../fsm/fsm.js";
import { createMessagePortDuplex } from "./messageport-duplex.js";

/**
 * Options for MessagePort fetch operation.
 */
export interface MessagePortFetchOptions {
  /** Local HEAD ref for negotiation */
  localHead?: string;
  /** Maximum haves to send during negotiation */
  maxHaves?: number;
  /** Shallow clone depth */
  depth?: number;
  /** Filter spec for partial clone */
  filter?: string;
  /** Refs to fetch (if not all) */
  refSpecs?: string[];
}

/**
 * Performs a Git fetch over a MessagePort.
 *
 * The MessagePort should be connected to a server running
 * messagePortServe() on the other end.
 *
 * @param port - MessagePort connected to the server
 * @param repository - Repository facade for pack import/export
 * @param refStore - Ref store for reading/writing refs
 * @param options - Fetch options
 * @returns Fetch result
 *
 * @example
 * ```ts
 * // Create channel
 * const channel = new MessageChannel();
 *
 * // Start server in background
 * messagePortServe(channel.port2, serverRepo, serverRefs);
 *
 * // Run fetch
 * const result = await messagePortFetch(
 *   channel.port1,
 *   clientRepo,
 *   clientRefs,
 *   { localHead: "refs/heads/main" }
 * );
 *
 * if (result.success) {
 *   console.log("Fetched successfully");
 * }
 * ```
 */
export async function messagePortFetch(
  port: MessagePort,
  repository: RepositoryFacade,
  refStore: RefStore,
  options: MessagePortFetchOptions = {},
): Promise<FetchResult> {
  const state = new ProtocolState();
  const duplex = createMessagePortDuplex(port);
  const transport = createTransportApi(duplex, state);

  const config: ProcessConfiguration = {
    localHead: options.localHead ?? "refs/heads/main",
    maxHaves: options.maxHaves ?? 256,
    depth: options.depth,
    filter: options.filter,
  };

  const ctx: ProcessContext = {};
  setTransport(ctx, transport);
  setRepository(ctx, repository);
  setRefStore(ctx, refStore);
  setState(ctx, state);
  setOutput(ctx, new HandlerOutput());
  setConfig(ctx, config);

  const fsm = new Fsm(clientFetchTransitions, clientFetchHandlers);

  try {
    const success = await fsm.run(ctx);

    const output = getOutput(ctx);
    if (!success || output.error) {
      return {
        success: false,
        error: output.error ?? "FSM did not complete successfully",
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
      objectsImported: output.packResult?.objectsImported,
    };
  } catch (error) {
    return {
      success: false,
      error: error instanceof Error ? error.message : String(error),
    };
  } finally {
    await transport.close?.();
  }
}
