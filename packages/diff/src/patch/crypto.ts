/**
 * Cryptographic operations interface for Git patch operations
 *
 * Provides an abstraction layer for hashing operations needed for:
 * - Object ID verification
 * - Binary patch integrity checks
 * - Content addressing
 *
 * Default implementation uses Web Crypto API (available in browsers and modern Node.js)
 */

/**
 * Hash algorithm identifier
 */
export type HashAlgorithm = "SHA-1" | "SHA-256";

/**
 * Cryptographic operations interface
 *
 * This interface allows custom implementations for environments
 * where WebCrypto is not available or when alternative implementations are needed.
 */
export interface CryptoProvider {
	/**
	 * Compute hash of data
	 *
	 * @param algorithm Hash algorithm to use
	 * @param data Data to hash
	 * @returns Promise resolving to hex-encoded hash
	 */
	hash(algorithm: HashAlgorithm, data: Uint8Array): Promise<string>;

	/**
	 * Compute hash of data (synchronous version if available)
	 *
	 * @param algorithm Hash algorithm to use
	 * @param data Data to hash
	 * @returns Hex-encoded hash
	 * @throws Error if synchronous hashing not supported
	 */
	hashSync(algorithm: HashAlgorithm, data: Uint8Array): string;
}

/**
 * WebCrypto-based implementation (default)
 *
 * Compatible with:
 * - Modern browsers
 * - Node.js 15+ (globalThis.crypto)
 * - Deno
 * - Cloudflare Workers
 */
export class WebCryptoProvider implements CryptoProvider {
	private crypto: Crypto;

	constructor(crypto?: Crypto) {
		this.crypto = crypto ?? globalThis.crypto;
		if (!this.crypto) {
			throw new Error(
				"WebCrypto API not available. Please provide a CryptoProvider implementation.",
			);
		}
	}

	async hash(algorithm: HashAlgorithm, data: Uint8Array): Promise<string> {
		const hashBuffer = await this.crypto.subtle.digest(
			algorithm,
			data as BufferSource,
		);
		return this.bufferToHex(new Uint8Array(hashBuffer));
	}

	hashSync(algorithm: HashAlgorithm, data: Uint8Array): string {
		throw new Error(
			"WebCrypto does not support synchronous hashing. Use hash() instead or provide a synchronous CryptoProvider.",
		);
	}

	private bufferToHex(buffer: Uint8Array): string {
		return Array.from(buffer)
			.map((b) => b.toString(16).padStart(2, "0"))
			.join("");
	}
}

/**
 * Node.js crypto module adapter (for older Node versions or when sync is needed)
 *
 * Usage:
 * ```typescript
 * import crypto from 'node:crypto';
 * const provider = new NodeCryptoProvider(crypto);
 * ```
 */
export class NodeCryptoProvider implements CryptoProvider {
	constructor(private nodeCrypto: typeof import("node:crypto")) {}

	async hash(algorithm: HashAlgorithm, data: Uint8Array): Promise<string> {
		return this.hashSync(algorithm, data);
	}

	hashSync(algorithm: HashAlgorithm, data: Uint8Array): string {
		const algoName = algorithm === "SHA-1" ? "sha1" : "sha256";
		const hash = this.nodeCrypto.createHash(algoName);
		hash.update(data);
		return hash.digest("hex");
	}
}

/**
 * Default crypto provider singleton
 */
let defaultProvider: CryptoProvider | null = null;

/**
 * Get the default crypto provider
 *
 * @returns Default crypto provider (WebCrypto if available)
 * @throws Error if no crypto provider available
 */
export function getDefaultCryptoProvider(): CryptoProvider {
	if (defaultProvider) {
		return defaultProvider;
	}

	try {
		defaultProvider = new WebCryptoProvider();
		return defaultProvider;
	} catch {
		throw new Error(
			"No default crypto provider available. Please set one using setDefaultCryptoProvider().",
		);
	}
}

/**
 * Set the default crypto provider
 *
 * @param provider Crypto provider to use as default
 */
export function setDefaultCryptoProvider(provider: CryptoProvider): void {
	defaultProvider = provider;
}

/**
 * Compute SHA-1 hash (Git's default object hash)
 *
 * @param data Data to hash
 * @param provider Optional crypto provider (uses default if not specified)
 * @returns Promise resolving to hex-encoded SHA-1 hash
 */
export async function sha1(
	data: Uint8Array,
	provider?: CryptoProvider,
): Promise<string> {
	const p = provider ?? getDefaultCryptoProvider();
	return p.hash("SHA-1", data);
}

/**
 * Compute SHA-256 hash
 *
 * @param data Data to hash
 * @param provider Optional crypto provider (uses default if not specified)
 * @returns Promise resolving to hex-encoded SHA-256 hash
 */
export async function sha256(
	data: Uint8Array,
	provider?: CryptoProvider,
): Promise<string> {
	const p = provider ?? getDefaultCryptoProvider();
	return p.hash("SHA-256", data);
}

/**
 * Compute Git object hash
 *
 * Git objects are hashed with a header: "type size\0content"
 *
 * @param type Object type ('blob', 'tree', 'commit', 'tag')
 * @param data Object content
 * @param provider Optional crypto provider
 * @returns Promise resolving to Git object ID (hex SHA-1)
 */
export async function gitObjectHash(
	type: "blob" | "tree" | "commit" | "tag",
	data: Uint8Array,
	provider?: CryptoProvider,
): Promise<string> {
	// Create Git object header: "type size\0"
	const header = new TextEncoder().encode(`${type} ${data.length}\0`);

	// Concatenate header + data
	const full = new Uint8Array(header.length + data.length);
	full.set(header, 0);
	full.set(data, header.length);

	return sha1(full, provider);
}
