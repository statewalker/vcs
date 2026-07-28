/**
 * Transport adapters for different communication channels.
 *
 * - messageport: For Web Workers and in-browser communication
 * - http: For HTTP smart protocol (git-upload-pack, git-receive-pack)
 * - webrun: For @statewalker/webrun-streams functional-duplex channels
 */

export * from "./http/index.js";
export * from "./messageport/index.js";
export * from "./webrun/index.js";
