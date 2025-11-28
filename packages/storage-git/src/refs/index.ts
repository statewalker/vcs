/**
 * Reference handling
 *
 * Manages Git refs (branches, tags, HEAD) stored in .git/refs/
 * and .git/packed-refs.
 */

export * from "./ref-types.js";
export * from "./ref-reader.js";
export * from "./ref-writer.js";
export * from "./packed-refs-reader.js";
export * from "./packed-refs-writer.js";
export * from "./ref-directory.js";
