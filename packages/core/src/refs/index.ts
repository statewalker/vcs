/**
 * Reference handling
 *
 * Manages Git refs (branches, tags, HEAD) stored in .git/refs/
 * and .git/packed-refs.
 */

export * from "./packed-refs-reader.js";
export * from "./packed-refs-writer.js";
export * from "./ref-directory.js";
export * from "./ref-reader.js";
export * from "./ref-store.files.js";
export * from "./ref-store.js";
export * from "./ref-store.memory.js";
export * from "./ref-types.js";
export * from "./ref-writer.js";
export * from "./reflog-reader.js";
export * from "./reflog-types.js";
export * from "./reflog-writer.js";
