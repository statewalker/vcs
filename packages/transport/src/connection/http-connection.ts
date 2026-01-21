/**
 * Smart HTTP git connection.
 *
 * Smart HTTP uses two HTTP requests per operation:
 * 1. GET /info/refs?service=git-upload-pack (or git-receive-pack) - ref discovery
 * 2. POST /git-upload-pack (or git-receive-pack) - pack negotiation and transfer
 *
 * This is a stateless protocol - each request is independent.
 *
 * Based on JGit's TransportHttp.java
 */

import { parseRefAdvertisement } from "../negotiation/ref-advertiser.js";
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
import {
  AuthenticationError,
  ConnectionError,
  RepositoryNotFoundError,
  TransportError,
} from "../protocol/errors.js";
import { collectPackets, pktLineReader, pktLineWriter } from "../protocol/pkt-line-codec.js";
import type { Packet, RefAdvertisement, ServiceType } from "../protocol/types.js";
import type { ConnectionOptions, Credentials, DiscoverableConnection } from "./types.js";

const DEFAULT_USER_AGENT = "statewalker-vcs/1.0";
const DEFAULT_TIMEOUT = 30000;

/**
 * Create authorization header from credentials.
 */
function createAuthHeader(credentials: Credentials): string {
  if (credentials.token) {
    return `Bearer ${credentials.token}`;
  }
  if (credentials.password) {
    const encoded = btoa(`${credentials.username}:${credentials.password}`);
    return `Basic ${encoded}`;
  }
  throw new Error("Credentials must have either password or token");
}

/**
 * Get content types for a service.
 */
function getContentTypes(service: ServiceType): {
  advertisement: string;
  request: string;
  result: string;
} {
  if (service === SERVICE_UPLOAD_PACK) {
    return {
      advertisement: CONTENT_TYPE_UPLOAD_PACK_ADVERTISEMENT,
      request: CONTENT_TYPE_UPLOAD_PACK_REQUEST,
      result: CONTENT_TYPE_UPLOAD_PACK_RESULT,
    };
  }
  return {
    advertisement: CONTENT_TYPE_RECEIVE_PACK_ADVERTISEMENT,
    request: CONTENT_TYPE_RECEIVE_PACK_REQUEST,
    result: CONTENT_TYPE_RECEIVE_PACK_RESULT,
  };
}

/**
 * HTTP-based git connection.
 */
export class HttpConnection implements DiscoverableConnection {
  private url: string;
  private service: ServiceType;
  private credentials?: Credentials;
  private customHeaders: Record<string, string>;
  private timeout: number;
  private userAgent: string;
  private responseStream: ReadableStream<Uint8Array> | null = null;
  private contentTypes: ReturnType<typeof getContentTypes>;

  constructor(options: ConnectionOptions) {
    this.url = options.url.replace(/\/$/, "");
    this.service = options.service;
    this.credentials = options.auth;
    this.customHeaders = options.headers || {};
    this.timeout = options.timeout ?? DEFAULT_TIMEOUT;
    this.userAgent = options.userAgent ?? DEFAULT_USER_AGENT;
    this.contentTypes = getContentTypes(options.service);
  }

  /**
   * Build headers for a request.
   */
  private buildHeaders(contentType?: string): Headers {
    const headers = new Headers({
      "User-Agent": this.userAgent,
      ...this.customHeaders,
    });

    if (contentType) {
      headers.set("Content-Type", contentType);
    }

    if (this.credentials) {
      headers.set("Authorization", createAuthHeader(this.credentials));
    }

    // Request protocol v2 if available
    headers.set("Git-Protocol", "version=2");

    return headers;
  }

  /**
   * Handle HTTP response errors.
   */
  private async handleResponseError(response: Response): Promise<never> {
    const status = response.status;

    if (status === 401 || status === 403) {
      throw new AuthenticationError(`Authentication failed: ${status} ${response.statusText}`);
    }

    if (status === 404) {
      throw new RepositoryNotFoundError(this.url);
    }

    const body = await response.text().catch(() => "");
    throw new ConnectionError(`HTTP ${status} ${response.statusText}: ${body}`);
  }

  /**
   * Discover refs from server (GET /info/refs).
   */
  async discoverRefs(): Promise<RefAdvertisement> {
    const infoRefsUrl = `${this.url}/info/refs?service=${this.service}`;
    const headers = this.buildHeaders();
    headers.set("Accept", this.contentTypes.advertisement);

    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), this.timeout);

    try {
      const response = await fetch(infoRefsUrl, {
        method: "GET",
        headers,
        signal: controller.signal,
      });

      if (!response.ok) {
        await this.handleResponseError(response);
      }

      // Check content type for smart HTTP
      const contentType = response.headers.get("Content-Type") || "";
      if (!contentType.includes(this.service)) {
        // Server might not support smart HTTP
        throw new TransportError(
          `Server does not support smart HTTP protocol (Content-Type: ${contentType})`,
        );
      }

      // Parse pkt-line response
      if (!response.body) {
        throw new ConnectionError("Response has no body");
      }

      const packetGenerator = pktLineReader(streamFromReadable(response.body));
      // Get iterator from the generator to avoid closing it with early returns
      const iterator = packetGenerator[Symbol.asyncIterator]();

      // Skip first packet if it's the service announcement
      // Format: "# service=git-upload-pack\n"
      const firstPacket = await readFirstPacket(iterator);
      if (firstPacket?.type === "data" && firstPacket.data) {
        const text = new TextDecoder().decode(firstPacket.data);
        if (text.startsWith("# service=")) {
          // Skip this packet and the following flush packet
          // Smart HTTP protocol: announcement + flush + ref advertisement
          const nextPacket = await readFirstPacket(iterator);
          if (nextPacket?.type === "flush") {
            // Good, flush packet skipped, continue with ref advertisement
            return parseRefAdvertisement(iteratorToAsyncIterable(iterator));
          }
          // Next packet was not a flush, include it in the advertisement
          return parseRefAdvertisement(
            prependPacket(nextPacket, iteratorToAsyncIterable(iterator)),
          );
        }
      }

      // First packet was part of the advertisement
      return parseRefAdvertisement(prependPacket(firstPacket, iteratorToAsyncIterable(iterator)));
    } catch (error) {
      if (error instanceof Error && error.name === "AbortError") {
        throw new ConnectionError(`Request timeout after ${this.timeout}ms`);
      }
      throw error;
    } finally {
      clearTimeout(timeoutId);
    }
  }

  /**
   * Send request packets (POST /service).
   */
  async send(packets: AsyncIterable<Packet>): Promise<void> {
    const serviceUrl = `${this.url}/${this.service}`;
    const headers = this.buildHeaders(this.contentTypes.request);
    headers.set("Accept", this.contentTypes.result);

    // Collect request body
    const body = await collectPackets(pktLineWriter(packets));

    await this.sendRawBody(serviceUrl, headers, body);
  }

  /**
   * Send raw bytes as request body (POST /service).
   * Use this when you have pre-built pkt-line encoded data.
   */
  async sendRaw(body: Uint8Array): Promise<void> {
    const serviceUrl = `${this.url}/${this.service}`;
    const headers = this.buildHeaders(this.contentTypes.request);
    headers.set("Accept", this.contentTypes.result);

    await this.sendRawBody(serviceUrl, headers, body);
  }

  /**
   * Internal method to send raw body.
   */
  private async sendRawBody(serviceUrl: string, headers: Headers, body: Uint8Array): Promise<void> {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), this.timeout);

    try {
      // Create a copy to ensure we have a proper ArrayBuffer (not SharedArrayBuffer)
      const bodyCopy = new Uint8Array(body);
      const response = await fetch(serviceUrl, {
        method: "POST",
        headers,
        body: new Blob([bodyCopy]),
        signal: controller.signal,
      });

      if (!response.ok) {
        await this.handleResponseError(response);
      }

      // Check content type
      const contentType = response.headers.get("Content-Type") || "";
      if (!contentType.includes(this.service)) {
        throw new TransportError(`Unexpected response Content-Type: ${contentType}`);
      }

      if (!response.body) {
        throw new ConnectionError("Response has no body");
      }

      this.responseStream = response.body;
    } catch (error) {
      if (error instanceof Error && error.name === "AbortError") {
        throw new ConnectionError(`Request timeout after ${this.timeout}ms`);
      }
      throw error;
    } finally {
      clearTimeout(timeoutId);
    }
  }

  /**
   * Receive response packets.
   */
  async *receive(): AsyncIterable<Packet> {
    if (!this.responseStream) {
      throw new Error("Must call send() before receive()");
    }

    yield* pktLineReader(streamFromReadable(this.responseStream));
  }

  /**
   * Close connection.
   */
  async close(): Promise<void> {
    if (this.responseStream) {
      try {
        await this.responseStream.cancel();
      } catch {
        // Ignore cancel errors
      }
      this.responseStream = null;
    }
  }
}

/**
 * Convert ReadableStream to async iterable.
 */
async function* streamFromReadable(stream: ReadableStream<Uint8Array>): AsyncGenerator<Uint8Array> {
  const reader = stream.getReader();
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      yield value;
    }
  } finally {
    reader.releaseLock();
  }
}

/**
 * Read first packet from an async iterator.
 * NOTE: Uses iterator.next() directly to avoid closing the iterator
 * (for await with early return calls iterator.return() which closes generators)
 */
async function readFirstPacket(iterator: AsyncIterator<Packet>): Promise<Packet | undefined> {
  const result = await iterator.next();
  if (result.done) return undefined;
  return result.value;
}

/**
 * Convert an async iterator back to an async iterable.
 * Allows the iterator to be used with for-await loops.
 */
function iteratorToAsyncIterable<T>(iterator: AsyncIterator<T>): AsyncIterable<T> {
  return {
    [Symbol.asyncIterator]() {
      return iterator;
    },
  };
}

/**
 * Prepend a packet to an async iterable.
 */
async function* prependPacket(
  first: Packet | undefined,
  rest: AsyncIterable<Packet>,
): AsyncGenerator<Packet> {
  if (first) {
    yield first;
  }
  yield* rest;
}

/**
 * Create an HTTP connection for upload-pack (fetch).
 */
export function createUploadPackConnection(
  url: string,
  options: Partial<ConnectionOptions> = {},
): HttpConnection {
  return new HttpConnection({
    url,
    service: SERVICE_UPLOAD_PACK,
    ...options,
  });
}

/**
 * Create an HTTP connection for receive-pack (push).
 */
export function createReceivePackConnection(
  url: string,
  options: Partial<ConnectionOptions> = {},
): HttpConnection {
  return new HttpConnection({
    url,
    service: SERVICE_RECEIVE_PACK,
    ...options,
  });
}
