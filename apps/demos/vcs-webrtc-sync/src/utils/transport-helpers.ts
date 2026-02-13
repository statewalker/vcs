/**
 * Transport Helper Utilities
 *
 * Provides adapters and helpers for using the new VCS transport API
 * with WebRTC data channels.
 */

import { DefaultSerializationApi, type History, isSymbolicRef } from "@statewalker/vcs-core";
import { createDataChannelPort } from "@statewalker/vcs-port-webrtc";
import {
  createMessagePortDuplex,
  type Duplex,
  type FetchResult,
  fetchOverDuplex,
  type PushResult,
  pushOverDuplex,
  type RepositoryFacade,
  type ServeResult,
  serveOverDuplex,
  type RefStore as TransportRefStore,
} from "@statewalker/vcs-transport";
import { createVcsRepositoryFacade } from "@statewalker/vcs-transport-adapters";

/**
 * Create a transport RefStore adapter from History refs.
 *
 * Adapts the core History refs interface to the transport RefStore interface.
 */
export function createRefStoreAdapter(history: History): TransportRefStore {
  const refs = history.refs;

  return {
    async get(name: string): Promise<string | undefined> {
      const ref = await refs.resolve(name);
      return ref?.objectId;
    },

    async update(name: string, oid: string): Promise<void> {
      const ZERO_OID = "0".repeat(40);
      if (oid === ZERO_OID) {
        await refs.remove(name);
      } else {
        await refs.set(name, oid);
      }
    },

    async listAll(): Promise<Iterable<[string, string]>> {
      const result: Array<[string, string]> = [];
      for await (const ref of refs.list()) {
        if (!isSymbolicRef(ref) && ref.objectId) {
          result.push([ref.name, ref.objectId]);
        }
      }
      return result;
    },

    async getSymrefTarget(name: string): Promise<string | undefined> {
      const ref = await refs.get(name);
      if (ref && isSymbolicRef(ref)) {
        return ref.target;
      }
      return undefined;
    },

    async isRefTip(oid: string): Promise<boolean> {
      for await (const ref of refs.list()) {
        if (!isSymbolicRef(ref) && ref.objectId === oid) {
          return true;
        }
      }
      return false;
    },
  };
}

/**
 * Create a Duplex stream from a WebRTC data channel.
 *
 * Combines createDataChannelPort (RTCDataChannel -> MessagePort)
 * and createMessagePortDuplex (MessagePort -> Duplex).
 */
export function createDataChannelDuplex(channel: RTCDataChannel): Duplex {
  const port = createDataChannelPort(channel);
  return createMessagePortDuplex(port);
}

/**
 * Create a repository facade and ref store from a History instance.
 *
 * Returns both objects needed for transport operations.
 */
export function createRepositoryContext(history: History): {
  repository: RepositoryFacade;
  refStore: TransportRefStore;
} {
  const serialization = new DefaultSerializationApi({ history });
  const repository = createVcsRepositoryFacade({ history, serialization });
  const refStore = createRefStoreAdapter(history);
  return { repository, refStore };
}

/**
 * Fetch from a peer over a WebRTC data channel.
 *
 * @param channel - The RTCDataChannel connected to the peer
 * @param history - Local History instance to fetch into
 * @param refspecs - Optional refspecs to fetch
 * @returns Fetch result
 */
export async function fetchFromPeer(
  channel: RTCDataChannel,
  history: History,
  refspecs?: string[],
): Promise<FetchResult> {
  const duplex = createDataChannelDuplex(channel);
  const { repository, refStore } = createRepositoryContext(history);

  return fetchOverDuplex({
    duplex,
    repository,
    refStore,
    refspecs: refspecs ?? ["+refs/heads/*:refs/remotes/peer/*"],
  });
}

/**
 * Push to a peer over a WebRTC data channel.
 *
 * @param channel - The RTCDataChannel connected to the peer
 * @param history - Local History instance to push from
 * @param refspecs - Optional refspecs to push
 * @returns Push result
 */
export async function pushToPeer(
  channel: RTCDataChannel,
  history: History,
  refspecs?: string[],
): Promise<PushResult> {
  const duplex = createDataChannelDuplex(channel);
  const { repository, refStore } = createRepositoryContext(history);

  return pushOverDuplex({
    duplex,
    repository,
    refStore,
    refspecs: refspecs ?? ["refs/heads/main:refs/heads/main"],
  });
}

/**
 * Serve Git requests from a peer over a WebRTC data channel.
 *
 * This function should be called when acting as a server for
 * incoming fetch/push requests from a peer.
 *
 * @param channel - The RTCDataChannel connected to the peer
 * @param history - Local History instance to serve
 * @returns Serve result
 */
export async function servePeer(channel: RTCDataChannel, history: History): Promise<ServeResult> {
  const duplex = createDataChannelDuplex(channel);
  const { repository, refStore } = createRepositoryContext(history);

  return serveOverDuplex({
    duplex,
    repository,
    refStore,
  });
}
