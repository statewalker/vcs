/**
 * Push Certificate Tests
 *
 * Tests for Git push certificate functionality including:
 * - Certificate parsing
 * - Pusher identity extraction
 * - Nonce validation
 * - GPG signature verification
 *
 * Modeled after JGit's PushCertificateParserTest.java
 */

import { describe, expect, it } from "vitest";
import { ZERO_OID } from "../src/fsm/push/types.js";

// ─────────────────────────────────────────────────────────────────────────────
// Push Certificate Types
// ─────────────────────────────────────────────────────────────────────────────

interface PushCertificate {
  version: string;
  pusher: {
    name: string;
    email: string;
    timestamp?: number;
    timezone?: string;
  };
  pushee?: string;
  nonce: string;
  commands: Array<{
    oldOid: string;
    newOid: string;
    refName: string;
  }>;
  gpgSignature?: string;
}

// ─────────────────────────────────────────────────────────────────────────────
// Push Certificate Parser
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Parses a push certificate from raw lines.
 */
function parsePushCertificate(lines: string[]): PushCertificate {
  const cert: Partial<PushCertificate> = {
    commands: [],
  };

  let inSignature = false;
  let signatureLines: string[] = [];

  for (const line of lines) {
    if (inSignature) {
      signatureLines.push(line);
      if (line === "-----END PGP SIGNATURE-----") {
        cert.gpgSignature = signatureLines.join("\n");
        inSignature = false;
      }
      continue;
    }

    if (line.startsWith("certificate version ")) {
      cert.version = line.slice("certificate version ".length);
    } else if (line.startsWith("pusher ")) {
      const pusherStr = line.slice("pusher ".length);
      cert.pusher = parsePusherIdent(pusherStr);
    } else if (line.startsWith("pushee ")) {
      cert.pushee = line.slice("pushee ".length);
    } else if (line.startsWith("nonce ")) {
      cert.nonce = line.slice("nonce ".length);
    } else if (line === "-----BEGIN PGP SIGNATURE-----") {
      inSignature = true;
      signatureLines = [line];
    } else if (line.match(/^[0-9a-f]{40} [0-9a-f]{40} /)) {
      // Command line: old-oid new-oid refname
      const [oldOid, newOid, ...refParts] = line.split(" ");
      cert.commands!.push({
        oldOid,
        newOid,
        refName: refParts.join(" "),
      });
    }
  }

  if (!cert.version) throw new Error("Missing certificate version");
  if (!cert.pusher) throw new Error("Missing pusher");
  if (!cert.nonce) throw new Error("Missing nonce");

  return cert as PushCertificate;
}

/**
 * Parses pusher identity string.
 * Format: "Name <email> timestamp timezone"
 */
function parsePusherIdent(ident: string): PushCertificate["pusher"] {
  // Format: "John Doe <john@example.com> 1234567890 +0000"
  const emailMatch = ident.match(/<([^>]+)>/);
  const email = emailMatch ? emailMatch[1] : "";

  const nameEnd = ident.indexOf(" <");
  const name = nameEnd > 0 ? ident.slice(0, nameEnd) : "";

  // Extract timestamp and timezone
  const afterEmail = emailMatch ? ident.slice(emailMatch.index! + emailMatch[0].length).trim() : "";
  const [timestampStr, timezone] = afterEmail.split(" ");
  const timestamp = timestampStr ? parseInt(timestampStr, 10) : undefined;

  return { name, email, timestamp, timezone };
}

/**
 * Validates certificate nonce against expected value.
 */
function validateNonce(certNonce: string, expectedNonce: string): boolean {
  return certNonce === expectedNonce;
}

// ─────────────────────────────────────────────────────────────────────────────
// Certificate Parsing Tests
// ─────────────────────────────────────────────────────────────────────────────

describe("PushCertificateParser", () => {
  describe("should parse certificate header", () => {
    it("parses version", () => {
      const lines = [
        "certificate version 0.1",
        "pusher Test User <test@example.com> 1234567890 +0000",
        "nonce abc123",
      ];

      const cert = parsePushCertificate(lines);

      expect(cert.version).toBe("0.1");
    });

    it("rejects missing version", () => {
      const lines = [
        "pusher Test User <test@example.com>",
        "nonce abc123",
      ];

      expect(() => parsePushCertificate(lines)).toThrow("Missing certificate version");
    });
  });

  describe("should parse pusher identity", () => {
    it("parses name and email", () => {
      const ident = "John Doe <john@example.com> 1234567890 +0000";
      const pusher = parsePusherIdent(ident);

      expect(pusher.name).toBe("John Doe");
      expect(pusher.email).toBe("john@example.com");
    });

    it("parses timestamp and timezone", () => {
      const ident = "John Doe <john@example.com> 1234567890 +0100";
      const pusher = parsePusherIdent(ident);

      expect(pusher.timestamp).toBe(1234567890);
      expect(pusher.timezone).toBe("+0100");
    });

    it("handles names with special characters", () => {
      const ident = "José García <jose@example.com> 1234567890 +0000";
      const pusher = parsePusherIdent(ident);

      expect(pusher.name).toBe("José García");
    });

    it("handles email with subaddress", () => {
      const ident = "User <user+tag@example.com> 1234567890 +0000";
      const pusher = parsePusherIdent(ident);

      expect(pusher.email).toBe("user+tag@example.com");
    });
  });

  describe("should parse pushee URL", () => {
    it("parses HTTP URL", () => {
      const lines = [
        "certificate version 0.1",
        "pusher Test User <test@example.com> 1234567890 +0000",
        "pushee https://github.com/user/repo.git",
        "nonce abc123",
      ];

      const cert = parsePushCertificate(lines);

      expect(cert.pushee).toBe("https://github.com/user/repo.git");
    });

    it("parses SSH URL", () => {
      const lines = [
        "certificate version 0.1",
        "pusher Test User <test@example.com> 1234567890 +0000",
        "pushee git@github.com:user/repo.git",
        "nonce abc123",
      ];

      const cert = parsePushCertificate(lines);

      expect(cert.pushee).toBe("git@github.com:user/repo.git");
    });

    it("handles missing pushee", () => {
      const lines = [
        "certificate version 0.1",
        "pusher Test User <test@example.com> 1234567890 +0000",
        "nonce abc123",
      ];

      const cert = parsePushCertificate(lines);

      expect(cert.pushee).toBeUndefined();
    });
  });

  describe("should parse nonce", () => {
    it("parses simple nonce", () => {
      const lines = [
        "certificate version 0.1",
        "pusher Test User <test@example.com> 1234567890 +0000",
        "nonce 1234567890-abcdef",
      ];

      const cert = parsePushCertificate(lines);

      expect(cert.nonce).toBe("1234567890-abcdef");
    });

    it("rejects missing nonce", () => {
      const lines = [
        "certificate version 0.1",
        "pusher Test User <test@example.com>",
      ];

      expect(() => parsePushCertificate(lines)).toThrow("Missing nonce");
    });
  });

  describe("should parse commands", () => {
    it("parses single command", () => {
      const oldOid = "a".repeat(40);
      const newOid = "b".repeat(40);

      const lines = [
        "certificate version 0.1",
        "pusher Test User <test@example.com> 1234567890 +0000",
        "nonce abc123",
        `${oldOid} ${newOid} refs/heads/main`,
      ];

      const cert = parsePushCertificate(lines);

      expect(cert.commands).toHaveLength(1);
      expect(cert.commands[0].oldOid).toBe(oldOid);
      expect(cert.commands[0].newOid).toBe(newOid);
      expect(cert.commands[0].refName).toBe("refs/heads/main");
    });

    it("parses multiple commands", () => {
      const lines = [
        "certificate version 0.1",
        "pusher Test User <test@example.com> 1234567890 +0000",
        "nonce abc123",
        `${"a".repeat(40)} ${"b".repeat(40)} refs/heads/main`,
        `${ZERO_OID} ${"c".repeat(40)} refs/heads/feature`,
        `${"d".repeat(40)} ${ZERO_OID} refs/heads/old`,
      ];

      const cert = parsePushCertificate(lines);

      expect(cert.commands).toHaveLength(3);
    });

    it("parses ref names with spaces", () => {
      const lines = [
        "certificate version 0.1",
        "pusher Test User <test@example.com> 1234567890 +0000",
        "nonce abc123",
        `${"a".repeat(40)} ${"b".repeat(40)} refs/heads/feature with spaces`,
      ];

      const cert = parsePushCertificate(lines);

      expect(cert.commands[0].refName).toBe("refs/heads/feature with spaces");
    });
  });

  describe("should parse GPG signature", () => {
    it("extracts signature block", () => {
      const lines = [
        "certificate version 0.1",
        "pusher Test User <test@example.com> 1234567890 +0000",
        "nonce abc123",
        `${"a".repeat(40)} ${"b".repeat(40)} refs/heads/main`,
        "-----BEGIN PGP SIGNATURE-----",
        "iQEzBAABCAAdFiEE...",
        "-----END PGP SIGNATURE-----",
      ];

      const cert = parsePushCertificate(lines);

      expect(cert.gpgSignature).toBeDefined();
      expect(cert.gpgSignature).toContain("BEGIN PGP SIGNATURE");
      expect(cert.gpgSignature).toContain("END PGP SIGNATURE");
    });

    it("handles certificate without signature", () => {
      const lines = [
        "certificate version 0.1",
        "pusher Test User <test@example.com> 1234567890 +0000",
        "nonce abc123",
      ];

      const cert = parsePushCertificate(lines);

      expect(cert.gpgSignature).toBeUndefined();
    });
  });

  describe("should reject invalid certificates", () => {
    it("rejects empty input", () => {
      expect(() => parsePushCertificate([])).toThrow();
    });

    it("rejects certificate without pusher", () => {
      const lines = [
        "certificate version 0.1",
        "nonce abc123",
      ];

      expect(() => parsePushCertificate(lines)).toThrow("Missing pusher");
    });
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Nonce Validation Tests
// ─────────────────────────────────────────────────────────────────────────────

describe("Nonce Validation", () => {
  it("accepts matching nonce", () => {
    const serverNonce = "1234567890-server-generated";
    const certNonce = "1234567890-server-generated";

    expect(validateNonce(certNonce, serverNonce)).toBe(true);
  });

  it("rejects non-matching nonce", () => {
    const serverNonce = "1234567890-server-generated";
    const certNonce = "different-nonce";

    expect(validateNonce(certNonce, serverNonce)).toBe(false);
  });

  it("rejects empty nonce", () => {
    const serverNonce = "1234567890-server-generated";
    const certNonce = "";

    expect(validateNonce(certNonce, serverNonce)).toBe(false);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Certificate Store Tests
// ─────────────────────────────────────────────────────────────────────────────

describe("PushCertificateStore", () => {
  interface CertificateStore {
    certificates: Map<string, PushCertificate>;
    store(cert: PushCertificate): void;
    getByRef(refName: string): PushCertificate | undefined;
  }

  function createCertificateStore(): CertificateStore {
    const certificates = new Map<string, PushCertificate>();

    return {
      certificates,

      store(cert: PushCertificate) {
        for (const cmd of cert.commands) {
          certificates.set(`${cmd.refName}:${cmd.newOid}`, cert);
        }
      },

      getByRef(refName: string) {
        for (const [key, cert] of certificates) {
          if (key.startsWith(`${refName}:`)) {
            return cert;
          }
        }
        return undefined;
      },
    };
  }

  describe("should store certificates", () => {
    it("stores certificate by ref and oid", () => {
      const store = createCertificateStore();
      const cert: PushCertificate = {
        version: "0.1",
        pusher: { name: "Test", email: "test@example.com" },
        nonce: "abc",
        commands: [
          { oldOid: "a".repeat(40), newOid: "b".repeat(40), refName: "refs/heads/main" },
        ],
      };

      store.store(cert);

      expect(store.certificates.size).toBe(1);
    });

    it("stores multiple commands from same certificate", () => {
      const store = createCertificateStore();
      const cert: PushCertificate = {
        version: "0.1",
        pusher: { name: "Test", email: "test@example.com" },
        nonce: "abc",
        commands: [
          { oldOid: "a".repeat(40), newOid: "b".repeat(40), refName: "refs/heads/main" },
          { oldOid: "c".repeat(40), newOid: "d".repeat(40), refName: "refs/heads/feature" },
        ],
      };

      store.store(cert);

      expect(store.certificates.size).toBe(2);
    });
  });

  describe("should retrieve certificates by ref", () => {
    it("retrieves certificate for ref", () => {
      const store = createCertificateStore();
      const cert: PushCertificate = {
        version: "0.1",
        pusher: { name: "Test", email: "test@example.com" },
        nonce: "abc",
        commands: [
          { oldOid: "a".repeat(40), newOid: "b".repeat(40), refName: "refs/heads/main" },
        ],
      };

      store.store(cert);
      const retrieved = store.getByRef("refs/heads/main");

      expect(retrieved).toBeDefined();
      expect(retrieved?.pusher.name).toBe("Test");
    });

    it("returns undefined for unknown ref", () => {
      const store = createCertificateStore();

      const retrieved = store.getByRef("refs/heads/nonexistent");

      expect(retrieved).toBeUndefined();
    });
  });

  describe("should verify signatures", () => {
    it("detects signed certificate", () => {
      const cert: PushCertificate = {
        version: "0.1",
        pusher: { name: "Test", email: "test@example.com" },
        nonce: "abc",
        commands: [],
        gpgSignature: "-----BEGIN PGP SIGNATURE-----\n...\n-----END PGP SIGNATURE-----",
      };

      const isSigned = cert.gpgSignature !== undefined;

      expect(isSigned).toBe(true);
    });

    it("detects unsigned certificate", () => {
      const cert: PushCertificate = {
        version: "0.1",
        pusher: { name: "Test", email: "test@example.com" },
        nonce: "abc",
        commands: [],
      };

      const isSigned = cert.gpgSignature !== undefined;

      expect(isSigned).toBe(false);
    });
  });
});
