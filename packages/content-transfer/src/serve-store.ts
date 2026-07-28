/**
 * Server half of the wire protocol: turns a {@link ContentStore} into a
 * {@link Duplex} handler. Each incoming call is one framed request; the handler
 * dispatches it to the store and frames the response. Symmetric with
 * {@link remoteStore} — an in-process test wires this Duplex straight into
 * `remoteStore(...)` with no transport.
 */

import type { ContentStore } from "@statewalker/content-store";
import type { Duplex } from "@statewalker/webrun-streams";
import { frameMessage, readFrame, type Request } from "./protocol.js";
import { registerManifest } from "./transfer.js";

const PROTOCOL = "content-transfer/1";

export function serveStore(store: ContentStore): Duplex {
  return async function* handler(input): AsyncGenerator<Uint8Array> {
    const { header, body } = await readFrame<Request>(input);
    switch (header.op) {
      case "capabilities":
        yield* frameMessage({ ok: true, capabilities: { protocol: PROTOCOL } });
        return;
      case "getManifest": {
        const manifest = (await store.getManifest(header.id)) ?? null;
        yield* frameMessage({ ok: true, manifest });
        return;
      }
      case "hasChunks": {
        const missing = await store.hasChunks(header.ids);
        yield* frameMessage({ ok: true, missing });
        return;
      }
      case "getChunk":
        yield* frameMessage({ ok: true }, store.getChunk(header.id));
        return;
      case "putChunk": {
        await store.putChunk(header.id, body);
        yield* frameMessage({ ok: true });
        return;
      }
      case "putManifest": {
        await registerManifest(store, header.manifest);
        yield* frameMessage({ ok: true });
        return;
      }
      default:
        yield* frameMessage({ ok: false, error: `unknown op ${(header as { op: string }).op}` });
        return;
    }
  };
}
