/**
 * Git Peer Server - handles incoming Git protocol requests over a MessagePort.
 *
 * Waits for client service-type handshake, serves the requested operation,
 * then loops to serve the next request.
 */

import type { History, SerializationApi } from "@statewalker/vcs-core";
import type { RefStore, RepositoryFacade } from "@statewalker/vcs-transport";
import { serveOverDuplex } from "@statewalker/vcs-transport";
import { createVcsRepositoryFacade } from "@statewalker/vcs-transport-adapters";
import { createRefStoreAdapter, waitForMessagePortClientService } from "../adapters/index.js";

export interface GitPeerServerOptions {
  port: MessagePort;
  history: History;
  serialization: SerializationApi;
  onPushReceived?: () => void;
  log?: (msg: string) => void;
}

export function setupGitPeerServer(options: GitPeerServerOptions): () => void {
  const { port, history, serialization, onPushReceived, log } = options;

  const repository: RepositoryFacade = createVcsRepositoryFacade({ history, serialization });
  const refStore: RefStore = createRefStoreAdapter(history.refs);

  let stopped = false;

  async function serveLoop(): Promise<void> {
    while (!stopped) {
      try {
        const { duplex, service } = await waitForMessagePortClientService(port);
        if (stopped) {
          await duplex.close?.();
          break;
        }

        log?.(`Serving ${service}`);

        const result = await serveOverDuplex({ duplex, repository, refStore, service });

        if (!result.success) {
          log?.(`${service} error: ${result.error}`);
        } else {
          log?.(`${service} complete`);
          if (service === "git-receive-pack" && onPushReceived) {
            onPushReceived();
          }
        }
      } catch (error) {
        if (!stopped) {
          log?.(`Server error: ${error instanceof Error ? error.message : String(error)}`);
        }
        await new Promise((resolve) => setTimeout(resolve, 100));
      }
    }
  }

  serveLoop().catch((error) => {
    if (!stopped) {
      log?.(`Server loop error: ${error instanceof Error ? error.message : String(error)}`);
    }
  });

  return () => {
    stopped = true;
  };
}
