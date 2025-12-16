/**
 * HTTP server types.
 */

import type { ReceivePackOptions, RepositoryAccess, UploadPackOptions } from "../handlers/types.js";

/**
 * Git HTTP server interface.
 *
 * Provides a single `fetch` method compatible with:
 * - Cloudflare Workers
 * - Deno
 * - Node.js with undici or node-fetch
 * - Service Workers
 */
export interface GitHttpServer {
  /**
   * Handle an incoming HTTP request.
   *
   * Routes to appropriate handler based on URL path:
   * - GET /info/refs?service=... → ref advertisement
   * - POST /git-upload-pack → fetch pack
   * - POST /git-receive-pack → push pack
   *
   * @param request - Standard Web Request
   * @returns Standard Web Response
   */
  fetch(request: Request): Promise<Response>;
}

/**
 * Options for creating a Git HTTP server.
 */
export interface GitHttpServerOptions {
  /**
   * Resolve repository from request.
   * Returns null if repository not found.
   *
   * @param request - The HTTP request
   * @param repoPath - Repository path extracted from URL
   */
  resolveRepository: (request: Request, repoPath: string) => Promise<RepositoryAccess | null>;

  /**
   * Optional authentication handler.
   * Return true to allow access, false to deny.
   */
  authenticate?: (request: Request, repository: RepositoryAccess) => Promise<boolean>;

  /**
   * Optional authorization handler.
   * Check if user can perform operation (fetch/push).
   */
  authorize?: (
    request: Request,
    repository: RepositoryAccess,
    operation: "fetch" | "push",
  ) => Promise<boolean>;

  /**
   * Custom error handler.
   */
  onError?: (error: Error, request: Request) => Response;

  /**
   * Base path for Git endpoints (default: '/').
   * Used to strip prefix from URL paths.
   */
  basePath?: string;

  /**
   * Upload pack options factory.
   * Called for each upload-pack request.
   */
  uploadPackOptions?: (
    request: Request,
    repository: RepositoryAccess,
  ) => Partial<Omit<UploadPackOptions, "repository">>;

  /**
   * Receive pack options factory.
   * Called for each receive-pack request.
   */
  receivePackOptions?: (
    request: Request,
    repository: RepositoryAccess,
  ) => Partial<Omit<ReceivePackOptions, "repository">>;
}

/**
 * Parsed Git URL components.
 */
export interface ParsedGitUrl {
  /** Repository path (e.g., "user/repo.git") */
  repoPath: string;
  /** Git-specific path (e.g., "/info/refs", "/git-upload-pack") */
  gitPath: string;
  /** Service name from query param */
  service?: string;
}
