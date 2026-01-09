/**
 * Node.js filesystem-backed FilesApi implementation
 *
 * Provides a FilesApi backed by the Node.js filesystem.
 * Uses the @statewalker/webrun-files-node package directly.
 */

import { NodeFilesApi } from "@statewalker/webrun-files-node";
import type { FilesApi } from "./files-api.js";

/**
 * Create a Node.js filesystem-backed FilesApi instance.
 *
 * @param options.rootDir - Root directory for all operations
 * @returns FilesApi instance
 *
 * @example
 * ```typescript
 * const files = createNodeFilesApi({
 *   rootDir: "/path/to/repo",
 * });
 * ```
 */
export function createNodeFilesApi(options: { rootDir: string }): FilesApi {
  return new NodeFilesApi(options);
}

// Re-export for direct access if needed
export { NodeFilesApi };
