/**
 * Git object format utilities
 *
 * Provides encoding/decoding of Git object headers following the format:
 * "<type> <size>\0<content>"
 *
 * Where type is one of: commit, tree, blob, tag
 */

/**
 * Git object type codes matching JGit Constants
 */
export const ObjectType = {
  COMMIT: 1,
  TREE: 2,
  BLOB: 3,
  TAG: 4,
} as const;

export type ObjectTypeCode = (typeof ObjectType)[keyof typeof ObjectType];

/**
 * Type string to code mapping
 */
const STRING_TO_TYPE: Record<string, ObjectTypeCode> = {
  commit: ObjectType.COMMIT,
  tree: ObjectType.TREE,
  blob: ObjectType.BLOB,
  tag: ObjectType.TAG,
};

/**
 * Type code to string mapping
 */
const TYPE_TO_STRING: Record<ObjectTypeCode, string> = {
  [ObjectType.COMMIT]: "commit",
  [ObjectType.TREE]: "tree",
  [ObjectType.BLOB]: "blob",
  [ObjectType.TAG]: "tag",
};

/**
 * Convert type code to string representation
 */
export function typeToString(type: ObjectTypeCode): string {
  const str = TYPE_TO_STRING[type];
  if (!str) {
    throw new Error(`Invalid Git object type code: ${type}`);
  }
  return str;
}

/**
 * Convert type string to code
 */
export function stringToType(str: string): ObjectTypeCode {
  const type = STRING_TO_TYPE[str];
  if (type === undefined) {
    throw new Error(`Invalid Git object type: ${str}`);
  }
  return type;
}

/**
 * Parsed Git object header
 */
export interface ParsedHeader {
  /** Object type code */
  type: ObjectTypeCode;
  /** Content size in bytes */
  size: number;
  /** Byte offset where content begins (after null terminator) */
  contentOffset: number;
}

/**
 * Encode Git object header: "<type> <size>\0"
 *
 * @param type Object type code
 * @param size Content size in bytes
 * @returns Encoded header as Uint8Array
 */
export function encodeHeader(type: ObjectTypeCode, size: number): Uint8Array {
  const typeStr = typeToString(type);
  const header = `${typeStr} ${size}\0`;
  return new TextEncoder().encode(header);
}

/**
 * Parse Git object header from data
 *
 * @param data Raw object data starting with header
 * @returns Parsed header with type, size, and content offset
 * @throws Error if header is invalid
 */
export function parseHeader(data: Uint8Array): ParsedHeader {
  // Find the null terminator
  const nullIndex = data.indexOf(0);
  if (nullIndex === -1) {
    throw new Error("Invalid Git object: no header terminator found");
  }

  const headerStr = new TextDecoder().decode(data.subarray(0, nullIndex));
  const spaceIndex = headerStr.indexOf(" ");

  if (spaceIndex === -1) {
    throw new Error("Invalid Git object header: missing space separator");
  }

  const typeStr = headerStr.substring(0, spaceIndex);
  const sizeStr = headerStr.substring(spaceIndex + 1);

  const type = STRING_TO_TYPE[typeStr];
  if (type === undefined) {
    throw new Error(`Invalid Git object type: ${typeStr}`);
  }

  const size = parseInt(sizeStr, 10);
  if (Number.isNaN(size) || size < 0) {
    throw new Error(`Invalid Git object size: ${sizeStr}`);
  }

  return {
    type,
    size,
    contentOffset: nullIndex + 1,
  };
}

/**
 * Concatenate multiple Uint8Arrays
 */
export function concatArrays(arrays: Uint8Array[]): Uint8Array {
  const totalSize = arrays.reduce((sum, arr) => sum + arr.length, 0);
  const result = new Uint8Array(totalSize);
  let offset = 0;
  for (const arr of arrays) {
    result.set(arr, offset);
    offset += arr.length;
  }
  return result;
}

/**
 * Async generator that prepends a chunk to an async iterable
 */
export async function* prependChunk(
  chunk: Uint8Array,
  stream: AsyncIterable<Uint8Array>,
): AsyncIterable<Uint8Array> {
  if (chunk.length > 0) {
    yield chunk;
  }
  yield* stream;
}

/**
 * Parse header from async stream, return typed object with remaining content
 *
 * @param stream Async iterable of data chunks
 * @returns Object with type, size, and content stream
 */
export async function parseHeaderFromStream(stream: AsyncIterable<Uint8Array>): Promise<{
  type: ObjectTypeCode;
  size: number;
  content: AsyncIterable<Uint8Array>;
}> {
  const chunks: Uint8Array[] = [];
  const iterator = stream[Symbol.asyncIterator]();

  // Read chunks until we find the null terminator
  while (true) {
    const { value, done } = await iterator.next();

    if (done) {
      throw new Error("Invalid Git object: header not found before end of stream");
    }

    chunks.push(value);
    const combined = concatArrays(chunks);
    const nullIndex = combined.indexOf(0);

    if (nullIndex !== -1) {
      const header = parseHeader(combined);

      // Get remaining content after header
      const remaining = combined.subarray(header.contentOffset);

      // Create async iterable for remaining content
      const contentStream = (async function* () {
        if (remaining.length > 0) {
          yield remaining;
        }
        // Continue with rest of original stream
        while (true) {
          const next = await iterator.next();
          if (next.done) break;
          yield next.value;
        }
      })();

      return {
        type: header.type,
        size: header.size,
        content: contentStream,
      };
    }

    // Safety check: headers should be small (< 32 bytes typically)
    if (combined.length > 1024) {
      throw new Error("Invalid Git object: header too large");
    }
  }
}
