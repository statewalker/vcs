/**
 * Transport adapters for different communication channels.
 *
 * - messageport: For Web Workers and in-browser communication
 * - http: For HTTP smart protocol (git-upload-pack, git-receive-pack)
 */

export * from "./http/index.js";
export * from "./messageport/index.js";
