/**
 * High-level push operation over any Duplex stream.
 *
 * Composes FSM, TransportApi, and RepositoryFacade to perform
 * a Git push operation over any bidirectional stream.
 */

import type { Duplex } from "../api/duplex.js";
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
import { Fsm } from "../fsm/fsm.js";
import { clientPushHandlers, clientPushTransitions } from "../fsm/push/client-push-fsm.js";

/**
 * Result of a push operation.
 */
export interface PushResult {
  /** Whether the push was successful */
  success: boolean;
  /** Error message if push failed */
  error?: string;
  /** Map of ref names to their push status */
  refStatus?: Map<string, RefPushStatus>;
}

/**
 * Status of a single ref push.
 */
export interface RefPushStatus {
  /** Whether this ref was successfully pushed */
  success: boolean;
  /** Error message if this ref failed */
  error?: string;
  /** Old object ID (before push) */
  oldOid?: string;
  /** New object ID (after push) */
  newOid?: string;
}

/**
 * Options for push-over-duplex operation.
 */
export interface PushOverDuplexOptions {
  /** Bidirectional stream to use for transport */
  duplex: Duplex;
  /** Repository facade for pack export */
  repository: RepositoryFacade;
  /** Ref store for reading refs to push */
  refStore: RefStore;
  /** Refspecs to push (source:destination format) */
  refspecs?: string[];
  /** Use atomic push (all-or-nothing) */
  atomic?: boolean;
  /** Force push even if not fast-forward */
  force?: boolean;
  /** Delete refs instead of pushing */
  delete?: boolean;
}

/**
 * Performs a Git push over a Duplex stream.
 *
 * This is the transport-agnostic push operation that works with any
 * bidirectional stream (MessagePort, WebSocket, WebRTC, HTTP, etc.).
 *
 * @param options - Push options including duplex, repository, and refStore
 * @returns Push result with success status and ref statuses
 *
 * @example
 * ```ts
 * // Using with MessagePort
 * const channel = new MessageChannel();
 * const duplex = createMessagePortDuplex(channel.port1);
 *
 * const result = await pushOverDuplex({
 *   duplex,
 *   repository: myRepo,
 *   refStore: myRefStore,
 *   refspecs: ["refs/heads/main:refs/heads/main"],
 * });
 *
 * if (result.success) {
 *   console.log("Pushed successfully");
 * }
 * ```
 */
export async function pushOverDuplex(options: PushOverDuplexOptions): Promise<PushResult> {
  const { duplex, repository, refStore } = options;

  const state = new ProtocolState();
  const transport = createTransportApi(duplex, state);

  // Force is handled at refspec level (+ prefix)
  const refspecs = options.refspecs?.map((r) =>
    options.force && !r.startsWith("+") ? `+${r}` : r,
  );

  const config: ProcessConfiguration = {
    localHead: "refs/heads/main",
    maxHaves: 256,
    atomic: options.atomic,
    pushRefspecs: refspecs,
  };

  const output = new HandlerOutput();

  const ctx: ProcessContext = {};
  setTransport(ctx, transport);
  setRepository(ctx, repository);
  setRefStore(ctx, refStore);
  setState(ctx, state);
  setOutput(ctx, output);
  setConfig(ctx, config);

  const fsm = new Fsm(clientPushTransitions, clientPushHandlers);

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
