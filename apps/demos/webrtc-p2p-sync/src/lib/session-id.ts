/**
 * Session ID generation and URL handling utilities.
 */

/**
 * Generate a random session ID.
 * Creates a 12-byte (96-bit) base64url-encoded string.
 *
 * @returns A 16-character base64url string
 */
export function generateSessionId(): string {
  const bytes = new Uint8Array(12);
  crypto.getRandomValues(bytes);
  return base64urlEncode(bytes);
}

/**
 * Parse a session ID from a URL's hash fragment.
 * Expects format: `#session=<id>` or `#s=<id>`
 *
 * @param url The full URL to parse
 * @returns The session ID, or null if not found
 */
export function parseSessionIdFromUrl(url: string): string | null {
  try {
    const hash = new URL(url).hash;
    if (!hash) return null;

    // Support both #session=xxx and #s=xxx formats
    const params = new URLSearchParams(hash.slice(1));
    return params.get("session") ?? params.get("s") ?? null;
  } catch {
    return null;
  }
}

/**
 * Build a shareable URL with the session ID.
 *
 * @param sessionId The session ID to include
 * @returns Full URL with session ID in hash fragment
 */
export function buildShareUrl(sessionId: string): string {
  const base = window.location.origin + window.location.pathname;
  return `${base}#session=${sessionId}`;
}

/**
 * Validate that a string is a valid session ID format.
 *
 * @param id The string to validate
 * @returns True if valid session ID format
 */
export function isValidSessionId(id: string): boolean {
  // Session IDs are 16-character base64url strings
  return /^[A-Za-z0-9_-]{16}$/.test(id);
}

/**
 * Encode bytes as base64url (URL-safe base64 without padding).
 */
function base64urlEncode(bytes: Uint8Array): string {
  const base64 = btoa(String.fromCharCode(...bytes));
  return base64.replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}
