/**
 * Git HTTP server implementation.
 *
 * Uses Web-standard Request/Response for maximum portability.
 *
 * Based on JGit's GitServlet and associated classes.
 */

import { createReceivePackHandler } from "../handlers/receive-pack-handler.js";
import type { RepositoryAccess } from "../handlers/types.js";
import { createUploadPackHandler } from "../handlers/upload-pack-handler.js";
import {
  CONTENT_TYPE_RECEIVE_PACK_ADVERTISEMENT,
  CONTENT_TYPE_RECEIVE_PACK_REQUEST,
  CONTENT_TYPE_RECEIVE_PACK_RESULT,
  CONTENT_TYPE_UPLOAD_PACK_ADVERTISEMENT,
  CONTENT_TYPE_UPLOAD_PACK_REQUEST,
  CONTENT_TYPE_UPLOAD_PACK_RESULT,
  SERVICE_RECEIVE_PACK,
  SERVICE_UPLOAD_PACK,
} from "../protocol/constants.js";
import type { GitHttpServer, GitHttpServerOptions, ParsedGitUrl } from "./types.js";

/**
 * Create a Git HTTP server.
 *
 * @param options - Server options
 * @returns Git HTTP server with fetch method
 */
export function createGitHttpServer(options: GitHttpServerOptions): GitHttpServer {
  const { resolveRepository, authenticate, authorize, onError, basePath = "" } = options;

  return {
    async fetch(request: Request): Promise<Response> {
      try {
        // Parse URL
        const url = new URL(request.url);
        const parsed = parseGitUrl(url.pathname, basePath);

        if (!parsed) {
          return createErrorResponse(404, "Not Found");
        }

        const { repoPath, gitPath } = parsed;
        const service = url.searchParams.get("service") || undefined;

        // Resolve repository
        const repository = await resolveRepository(request, repoPath);
        if (!repository) {
          return createErrorResponse(404, "Repository not found");
        }

        // Authentication
        if (authenticate) {
          const isAuthenticated = await authenticate(request, repository);
          if (!isAuthenticated) {
            return createErrorResponse(401, "Unauthorized", {
              "WWW-Authenticate": 'Basic realm="Git"',
            });
          }
        }

        // Route request
        if (gitPath === "/info/refs" && request.method === "GET") {
          return handleInfoRefs(request, repository, service, options);
        }

        if (gitPath === "/git-upload-pack" && request.method === "POST") {
          // Authorization check for fetch
          if (authorize) {
            const isAuthorized = await authorize(request, repository, "fetch");
            if (!isAuthorized) {
              return createErrorResponse(403, "Forbidden");
            }
          }
          return handleUploadPack(request, repository, options);
        }

        if (gitPath === "/git-receive-pack" && request.method === "POST") {
          // Authorization check for push
          if (authorize) {
            const isAuthorized = await authorize(request, repository, "push");
            if (!isAuthorized) {
              return createErrorResponse(403, "Forbidden");
            }
          }
          return handleReceivePack(request, repository, options);
        }

        return createErrorResponse(404, "Not Found");
      } catch (error) {
        console.error("Git HTTP server error:", error);

        if (onError) {
          return onError(error as Error, request);
        }

        return createErrorResponse(500, "Internal Server Error");
      }
    },
  };
}

/**
 * Parse Git URL path.
 *
 * Expected formats:
 * - /repo.git/info/refs
 * - /repo.git/git-upload-pack
 * - /user/repo.git/info/refs
 * - etc.
 */
function parseGitUrl(pathname: string, basePath: string): ParsedGitUrl | null {
  // Remove base path prefix
  let path = pathname;
  if (basePath && path.startsWith(basePath)) {
    path = path.slice(basePath.length);
  }

  // Ensure path starts with /
  if (!path.startsWith("/")) {
    path = `/${path}`;
  }

  // Match patterns like /repo.git/... or /user/repo.git/...
  // The repo path ends at .git, followed by Git-specific path
  const gitMatch = path.match(/^(\/.*?\.git)(\/.*)?$/);
  if (gitMatch) {
    const repoPath = gitMatch[1].slice(1); // Remove leading /
    const gitPath = gitMatch[2] || "/";
    return { repoPath, gitPath };
  }

  // Try matching without .git suffix
  // Pattern: /path/info/refs or /path/git-upload-pack
  const serviceMatch = path.match(/^(\/.*?)(\/info\/refs|\/git-upload-pack|\/git-receive-pack)$/);
  if (serviceMatch) {
    const repoPath = serviceMatch[1].slice(1); // Remove leading /
    const gitPath = serviceMatch[2];
    return { repoPath, gitPath };
  }

  return null;
}

/**
 * Handle GET /info/refs endpoint.
 */
async function handleInfoRefs(
  request: Request,
  repository: RepositoryAccess,
  service: string | undefined,
  options: GitHttpServerOptions,
): Promise<Response> {
  // Validate service parameter
  if (!service || (service !== SERVICE_UPLOAD_PACK && service !== SERVICE_RECEIVE_PACK)) {
    return createErrorResponse(403, "Forbidden - service parameter required");
  }

  // Determine content type
  const contentType =
    service === SERVICE_UPLOAD_PACK
      ? CONTENT_TYPE_UPLOAD_PACK_ADVERTISEMENT
      : CONTENT_TYPE_RECEIVE_PACK_ADVERTISEMENT;

  // Create handler
  const handler =
    service === SERVICE_UPLOAD_PACK
      ? createUploadPackHandler({
          repository,
          ...options.uploadPackOptions?.(request, repository),
        })
      : createReceivePackHandler({
          repository,
          ...options.receivePackOptions?.(request, repository),
        });

  // Generate response
  const body = handler.advertise({
    includeServiceAnnouncement: true,
    serviceName: service,
  });

  return new Response(iterableToReadableStream(body), {
    status: 200,
    headers: {
      "Content-Type": contentType,
      "Cache-Control": "no-cache",
      Expires: "Fri, 01 Jan 1980 00:00:00 GMT",
      Pragma: "no-cache",
    },
  });
}

/**
 * Handle POST /git-upload-pack endpoint.
 */
async function handleUploadPack(
  request: Request,
  repository: RepositoryAccess,
  options: GitHttpServerOptions,
): Promise<Response> {
  // Validate content type
  const contentType = request.headers.get("Content-Type");
  if (contentType !== CONTENT_TYPE_UPLOAD_PACK_REQUEST) {
    return createErrorResponse(
      415,
      `Unsupported Media Type: expected ${CONTENT_TYPE_UPLOAD_PACK_REQUEST}`,
    );
  }

  // Create handler
  const handler = createUploadPackHandler({
    repository,
    ...options.uploadPackOptions?.(request, repository),
  });

  // Get request body as stream
  const input = request.body ? readableStreamToAsyncIterable(request.body) : emptyAsyncIterable();

  // Process request
  const output = handler.process(input);

  return new Response(iterableToReadableStream(output), {
    status: 200,
    headers: {
      "Content-Type": CONTENT_TYPE_UPLOAD_PACK_RESULT,
      "Cache-Control": "no-cache",
    },
  });
}

/**
 * Handle POST /git-receive-pack endpoint.
 */
async function handleReceivePack(
  request: Request,
  repository: RepositoryAccess,
  options: GitHttpServerOptions,
): Promise<Response> {
  // Validate content type
  const contentType = request.headers.get("Content-Type");
  if (contentType !== CONTENT_TYPE_RECEIVE_PACK_REQUEST) {
    return createErrorResponse(
      415,
      `Unsupported Media Type: expected ${CONTENT_TYPE_RECEIVE_PACK_REQUEST}`,
    );
  }

  // Create handler
  const handler = createReceivePackHandler({
    repository,
    ...options.receivePackOptions?.(request, repository),
  });

  // Get request body as stream
  const input = request.body ? readableStreamToAsyncIterable(request.body) : emptyAsyncIterable();

  // Process request
  const output = handler.process(input);

  return new Response(iterableToReadableStream(output), {
    status: 200,
    headers: {
      "Content-Type": CONTENT_TYPE_RECEIVE_PACK_RESULT,
      "Cache-Control": "no-cache",
    },
  });
}

/**
 * Create an error response.
 */
function createErrorResponse(
  status: number,
  message: string,
  headers?: Record<string, string>,
): Response {
  return new Response(message, {
    status,
    headers: {
      "Content-Type": "text/plain",
      ...headers,
    },
  });
}

/**
 * Convert AsyncIterable to ReadableStream.
 */
function iterableToReadableStream(iterable: AsyncIterable<Uint8Array>): ReadableStream<Uint8Array> {
  const iterator = iterable[Symbol.asyncIterator]();

  return new ReadableStream<Uint8Array>({
    async pull(controller) {
      try {
        const { value, done } = await iterator.next();
        if (done) {
          controller.close();
        } else {
          controller.enqueue(value);
        }
      } catch (error) {
        controller.error(error);
      }
    },
    cancel() {
      iterator.return?.();
    },
  });
}

/**
 * Convert ReadableStream to AsyncIterable.
 */
async function* readableStreamToAsyncIterable(
  stream: ReadableStream<Uint8Array>,
): AsyncIterable<Uint8Array> {
  const reader = stream.getReader();
  try {
    while (true) {
      const { value, done } = await reader.read();
      if (done) break;
      yield value;
    }
  } finally {
    reader.releaseLock();
  }
}

/**
 * Create an empty async iterable.
 */
async function* emptyAsyncIterable(): AsyncIterable<Uint8Array> {
  // Empty
}
