import type { ObjectDescriptor } from "./types.js";

/** Serialize a descriptor to JSON bytes for the manifests BlobStore. */
export function serializeManifest(descriptor: ObjectDescriptor): Uint8Array {
  return new TextEncoder().encode(JSON.stringify(descriptor));
}

/** Parse manifest bytes back into a descriptor. */
export function parseManifest(bytes: Uint8Array): ObjectDescriptor {
  return JSON.parse(new TextDecoder().decode(bytes)) as ObjectDescriptor;
}
