import { encodeObjectHeader } from "../../format";
import type { GitObjectStore, ObjectId, ObjectTypeString } from "../interfaces";

const _encoder = new TextEncoder();
/**_encoder
 * Store content with known size (optimized path)
 *
 * Computes hash while streaming content to storage.
 * Use this when content size is known upfront (e.g., commits, trees, tags).
 */
export async function storeWithSize(
  storage: GitObjectStore,
  type: ObjectTypeString,
  size: number,
  content: AsyncIterable<Uint8Array>,
): Promise<ObjectId> {
  const header = encodeObjectHeader(type, size);
  const fullContent = prependStream(header, content);
  return await storage.store(type, fullContent);

  async function* prependStream(
    header: Uint8Array,
    content: AsyncIterable<Uint8Array>,
  ): AsyncIterable<Uint8Array> {
    yield header;
    yield* content;
  }
}
