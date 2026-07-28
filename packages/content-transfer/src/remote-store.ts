/**
 * Client half of the wire protocol: wraps a {@link Duplex} as a
 * {@link ContentStore}-shaped proxy. Each method opens one call, frames the
 * request, and reads the framed response. The proxy exposes exactly the
 * chunk-transfer surface a {@link transfer} needs from a remote peer —
 * `capabilities` / `getManifest` / `hasChunks` / `getChunk` / `putChunk`, plus
 * `putManifest` for the server-side assemble. Whole-object operations that would
 * need the store's chunker (`put`) or have no transfer meaning (`has` / `read` /
 * `remove` / `gc`) are not carried over the wire and throw.
 */

import type { ByteStream, ChunkId, ObjectDescriptor, ObjectId } from "@statewalker/content-store";
import type { Duplex } from "@statewalker/webrun-streams";
import { frameMessage, readFrame } from "./protocol.js";
import type { AssemblingStore, Capabilities } from "./types.js";

interface Ok {
  ok: true;
  manifest?: ObjectDescriptor | null;
  missing?: ChunkId[];
  capabilities?: Capabilities;
}
interface Err {
  ok: false;
  error?: string;
}
type Response = Ok | Err;

const unsupported = (name: string): never => {
  throw new Error(`content-transfer: remote proxy does not support "${name}"`);
};

export function remoteStore(call: Duplex): AssemblingStore {
  async function request(
    header: unknown,
    body?: ByteStream,
  ): Promise<{ header: Ok; body: AsyncGenerator<Uint8Array> }> {
    const response = call(frameMessage(header, body));
    const { header: resp, body: respBody } = await readFrame<Response>(response);
    if (!resp.ok) throw new Error(resp.error ?? "content-transfer: remote error");
    return { header: resp, body: respBody };
  }

  const store: AssemblingStore = {
    async capabilities(): Promise<Capabilities> {
      const { header } = await request({ op: "capabilities" });
      if (!header.capabilities) throw new Error("content-transfer: no capabilities in response");
      return header.capabilities;
    },

    async getManifest(id: ObjectId): Promise<ObjectDescriptor | undefined> {
      const { header } = await request({ op: "getManifest", id });
      return header.manifest ?? undefined;
    },

    async hasChunks(ids: ChunkId[]): Promise<ChunkId[]> {
      const { header } = await request({ op: "hasChunks", ids });
      return header.missing ?? [];
    },

    getChunk(id: ChunkId): ByteStream {
      return (async function* (): ByteStream {
        const { body } = await request({ op: "getChunk", id });
        yield* body;
      })();
    },

    async putChunk(id: ChunkId, bytes: ByteStream): Promise<void> {
      await request({ op: "putChunk", id }, bytes);
    },

    async putManifest(manifest: ObjectDescriptor): Promise<void> {
      await request({ op: "putManifest", manifest });
    },

    put: () => unsupported("put"),
    has: () => unsupported("has"),
    read: () => unsupported("read"),
    remove: () => unsupported("remove"),
    gc: () => unsupported("gc"),
  };

  return store;
}
