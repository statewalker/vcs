/**
 * Object storage module with delta compression
 *
 * Provides content-addressable storage with transparent delta compression,
 * following Fossil's architectural patterns.
 */

export * from "./create-default-object-storage.js";
export * from "./default-object-storage.js";
export * from "./delta-repository.js";
export * from "./intermediate-cache.js";
export * from "./lru-cache.js";
export * from "./mem/index.js";
export * from "./metadata-repository.js";
export * from "./object-repository.js";
export * from "./types.js";
