/**
 * Git Peer Session - manages fetch/push operations over a MessagePort.
 */

import type { History, SerializationApi } from "@statewalker/vcs-core";
import type { RefStore, RepositoryFacade } from "@statewalker/vcs-transport";
import { fetchOverDuplex, pushOverDuplex } from "@statewalker/vcs-transport";
import { createVcsRepositoryFacade } from "@statewalker/vcs-transport-adapters";
import { createMessagePortClientDuplex, createRefStoreAdapter } from "../adapters/index.js";

export interface GitPeerSessionOptions {
  port: MessagePort;
  history: History;
  serialization: SerializationApi;
  log?: (msg: string) => void;
}

export interface GitFetchResult {
  ok: boolean;
  refs: Map<string, string>;
  objectsReceived: number;
  error?: string;
}

export interface GitPushResult {
  ok: boolean;
  error?: string;
}

export interface GitPeerSession {
  fetch(refspecs?: string[]): Promise<GitFetchResult>;
  push(refspecs?: string[]): Promise<GitPushResult>;
}

export function createGitPeerSession(options: GitPeerSessionOptions): GitPeerSession {
  const { port, history, serialization, log } = options;

  const repository: RepositoryFacade = createVcsRepositoryFacade({ history, serialization });
  const refStore: RefStore = createRefStoreAdapter(history.refs);

  return {
    async fetch(refspecs?: string[]): Promise<GitFetchResult> {
      const specs = refspecs ?? ["+refs/heads/*:refs/remotes/peer/*"];
      try {
        log?.("Fetching from peer...");
        const duplex = createMessagePortClientDuplex(port, "git-upload-pack");
        const result = await fetchOverDuplex({ duplex, repository, refStore, refspecs: specs });

        if (!result.success) {
          throw new Error(result.error ?? "Fetch failed");
        }

        log?.(`Fetch complete: ${result.objectsImported ?? 0} objects`);
        return {
          ok: true,
          refs: result.updatedRefs ?? new Map(),
          objectsReceived: result.objectsImported ?? 0,
        };
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        log?.(`Fetch error: ${message}`);
        return { ok: false, refs: new Map(), objectsReceived: 0, error: message };
      }
    },

    async push(refspecs?: string[]): Promise<GitPushResult> {
      const specs = refspecs ?? ["refs/heads/main:refs/heads/main"];
      try {
        log?.("Pushing to peer...");
        const duplex = createMessagePortClientDuplex(port, "git-receive-pack");
        const result = await pushOverDuplex({ duplex, repository, refStore, refspecs: specs });

        if (!result.success) {
          throw new Error(result.error ?? "Push failed");
        }

        log?.("Push complete");
        return { ok: true };
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        log?.(`Push error: ${message}`);
        return { ok: false, error: message };
      }
    },
  };
}
