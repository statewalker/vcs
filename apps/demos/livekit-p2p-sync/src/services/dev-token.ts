/**
 * Development-mode JWT token generator for LiveKit.
 *
 * When running `livekit-server --dev`, the server uses:
 * - API Key: "devkey"
 * - API Secret: "secret"
 *
 * This generates tokens client-side using Web Crypto API.
 * DO NOT use in production — tokens should come from a server.
 */

const DEV_API_KEY = "devkey";
const DEV_API_SECRET = "secret";

function base64UrlEncode(data: Uint8Array): string {
  const binStr = Array.from(data, (b) => String.fromCharCode(b)).join("");
  return btoa(binStr).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

function encodeText(text: string): ArrayBuffer {
  const bytes = new TextEncoder().encode(text);
  // Return a proper ArrayBuffer (not SharedArrayBuffer) for Web Crypto API
  return bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer;
}

function encodeTextAsUint8Array(text: string): Uint8Array {
  return new Uint8Array(encodeText(text));
}

/**
 * Generate a development-mode LiveKit JWT token.
 *
 * @param identity - Participant identity (unique per participant)
 * @param roomName - Room name to join
 * @param ttl - Token time-to-live in seconds (default: 3600)
 * @returns JWT token string
 */
export async function generateDevToken(
  identity: string,
  roomName: string,
  ttl = 3600,
): Promise<string> {
  const header = { alg: "HS256", typ: "JWT" };

  const now = Math.floor(Date.now() / 1000);
  const payload = {
    iss: DEV_API_KEY,
    sub: identity,
    iat: now,
    nbf: now,
    exp: now + ttl,
    jti: `${identity}-${now}`,
    video: {
      room: roomName,
      roomJoin: true,
      canPublish: true,
      canSubscribe: true,
      canPublishData: true,
    },
  };

  const headerB64 = base64UrlEncode(encodeTextAsUint8Array(JSON.stringify(header)));
  const payloadB64 = base64UrlEncode(encodeTextAsUint8Array(JSON.stringify(payload)));
  const signingInput = `${headerB64}.${payloadB64}`;

  const key = await crypto.subtle.importKey(
    "raw",
    encodeText(DEV_API_SECRET),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );

  const signature = await crypto.subtle.sign("HMAC", key, encodeText(signingInput));
  const signatureB64 = base64UrlEncode(new Uint8Array(signature));

  return `${signingInput}.${signatureB64}`;
}
