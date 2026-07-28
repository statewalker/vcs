import type { KvStore, RefStore } from "./types.js";

/**
 * Build a {@link RefStore} over a {@link KvStore}: string ids are stored as
 * UTF-8 bytes and `compareAndSet` maps directly onto {@link KvStore.cas}, so the
 * facade reuses the primitive's atomicity rather than re-implementing storage.
 */
export function refStore(kv: KvStore): RefStore {
  const encoder = new TextEncoder();
  const decoder = new TextDecoder();
  const encode = (s: string | undefined): Uint8Array | undefined =>
    s === undefined ? undefined : encoder.encode(s);

  return {
    async read(name) {
      const value = await kv.get(name);
      return value === undefined ? undefined : decoder.decode(value);
    },
    compareAndSet(name, expected, next) {
      return kv.cas(name, encode(expected), encode(next));
    },
    async *list(prefix) {
      for await (const { key, value } of kv.list(prefix)) {
        yield { name: key, id: decoder.decode(value) };
      }
    },
  };
}
