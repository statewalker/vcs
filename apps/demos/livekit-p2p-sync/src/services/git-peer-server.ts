/**
 * Git Peer Server - handles incoming Git protocol requests over a webrun mux.
 *
 * Registers a service-dispatching handler on the mux: each inbound call carries
 * a 1-byte service marker, and `serveGitDispatch` serves the matching
 * upload-pack (fetch) or receive-pack (push) request.
 */

import type { History, SerializationApi } from "@statewalker/vcs-core";
import type { RefStore, RepositoryFacade, WebrunDuplex } from "@statewalker/vcs-transport";
import { createVcsRepositoryFacade } from "@statewalker/vcs-transport-adapters";
import { createRefStoreAdapter, serveGitDispatch } from "../adapters/index.js";

export interface GitPeerServerOptions {
  /** Registers a handler on the participant mux (`mux.serve`). */
  serve: (handler: WebrunDuplex) => () => Promise<void>;
  history: History;
  serialization: SerializationApi;
  onPushReceived?: () => void;
  log?: (msg: string) => void;
}

export function setupGitPeerServer(options: GitPeerServerOptions): () => void {
  const { serve, history, serialization, onPushReceived, log } = options;

  const repository: RepositoryFacade = createVcsRepositoryFacade({ history, serialization });
  const refStore: RefStore = createRefStoreAdapter(history.refs);

  const off = serve(
    serveGitDispatch({
      repository,
      refStore,
      onServed: (service) => {
        log?.(`${service} complete`);
        if (service === "git-receive-pack") onPushReceived?.();
      },
    }),
  );

  return () => {
    void off();
  };
}
