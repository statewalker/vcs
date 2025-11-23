/**
 * Compression provider abstraction
 *
 * Provides a unified interface for compression/decompression operations
 * with support for multiple backends (Node.js zlib, Web Compression Streams, etc.)
 */

export * from "./node-compression-provider.js";
export * from "./types.js";
export * from "./web-compression-provider.js";

// Auto-detect and export a default provider
let defaultProvider: import("./types.js").CompressionProvider | null = null;

/**
 * Get the default compression provider for the current environment
 */
export async function getDefaultCompressionProvider(): Promise<
  import("./types.js").CompressionProvider
> {
  if (defaultProvider) {
    return defaultProvider;
  }

  // Try Node.js first
  if (typeof process !== "undefined" && process.versions?.node) {
    const { NodeCompressionProvider } = await import("./node-compression-provider.js");
    defaultProvider = new NodeCompressionProvider();
    return defaultProvider;
  }

  // Try Web Compression Streams API
  if (typeof CompressionStream !== "undefined") {
    const { WebCompressionProvider } = await import("./web-compression-provider.js");
    defaultProvider = new WebCompressionProvider();
    return defaultProvider;
  }

  throw new Error(
    "No compression provider available. Please provide a custom CompressionProvider.",
  );
}

/**
 * Set the default compression provider
 */
export function setDefaultCompressionProvider(
  provider: import("./types.js").CompressionProvider,
): void {
  defaultProvider = provider;
}
