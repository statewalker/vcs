/**
 * First Command and First Want Parsing Tests
 *
 * Tests for parsing the first line in Git protocol exchanges which
 * includes capability negotiation.
 *
 * Modeled after JGit's:
 * - FirstCommandTest.java
 * - FirstWantTest.java
 */

import { describe, expect, it } from "vitest";

// ─────────────────────────────────────────────────────────────────────────────
// First Want Parsing
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Parse a "want" line from Git protocol.
 *
 * Format:
 * - First want: `want <oid> <cap1> <cap2> ...`
 * - Subsequent wants: `want <oid>`
 */
interface WantLine {
  oid: string;
  capabilities?: string[];
}

function parseWantLine(line: string): WantLine {
  if (!line.startsWith("want ")) {
    throw new Error(`Invalid want line: does not start with "want "`);
  }

  const rest = line.slice(5);
  const parts = rest.split(" ");

  if (parts.length === 0 || !parts[0]) {
    throw new Error("Invalid want line: missing object ID");
  }

  const oid = parts[0];

  // Validate OID format (40 hex chars)
  if (!/^[0-9a-f]{40}$/.test(oid)) {
    throw new Error(`Invalid want line: malformed object ID: ${oid}`);
  }

  const capabilities = parts.length > 1 ? parts.slice(1) : undefined;

  return { oid, capabilities };
}

describe("FirstWant", () => {
  describe("basic parsing", () => {
    it("should parse want without capabilities", () => {
      const result = parseWantLine("want fcfcfb1fd94829c1a1704f894fc111d14770d34e");

      expect(result.oid).toBe("fcfcfb1fd94829c1a1704f894fc111d14770d34e");
      expect(result.capabilities).toBeUndefined();
    });

    it("should parse want with single capability", () => {
      const result = parseWantLine("want fcfcfb1fd94829c1a1704f894fc111d14770d34e multi_ack");

      expect(result.oid).toBe("fcfcfb1fd94829c1a1704f894fc111d14770d34e");
      expect(result.capabilities).toEqual(["multi_ack"]);
    });

    it("should parse want with multiple capabilities", () => {
      const result = parseWantLine(
        "want fcfcfb1fd94829c1a1704f894fc111d14770d34e multi_ack thin-pack side-band-64k",
      );

      expect(result.oid).toBe("fcfcfb1fd94829c1a1704f894fc111d14770d34e");
      expect(result.capabilities).toEqual(["multi_ack", "thin-pack", "side-band-64k"]);
    });

    it("should extract object ID correctly", () => {
      const oid = "0123456789abcdef0123456789abcdef01234567";
      const result = parseWantLine(`want ${oid}`);

      expect(result.oid).toBe(oid);
      expect(result.oid.length).toBe(40);
    });
  });

  describe("capability extraction", () => {
    it("should handle capability with value (agent)", () => {
      const result = parseWantLine(
        "want fcfcfb1fd94829c1a1704f894fc111d14770d34e agent=git/2.32.0",
      );

      expect(result.capabilities).toContain("agent=git/2.32.0");
    });

    it("should handle ofs-delta capability", () => {
      const result = parseWantLine("want fcfcfb1fd94829c1a1704f894fc111d14770d34e ofs-delta");

      expect(result.capabilities).toContain("ofs-delta");
    });

    it("should handle no-progress capability", () => {
      const result = parseWantLine("want fcfcfb1fd94829c1a1704f894fc111d14770d34e no-progress");

      expect(result.capabilities).toContain("no-progress");
    });

    it("should handle include-tag capability", () => {
      const result = parseWantLine("want fcfcfb1fd94829c1a1704f894fc111d14770d34e include-tag");

      expect(result.capabilities).toContain("include-tag");
    });

    it("should handle all common fetch capabilities", () => {
      const caps = "multi_ack_detailed thin-pack side-band-64k ofs-delta no-progress include-tag";
      const result = parseWantLine(`want fcfcfb1fd94829c1a1704f894fc111d14770d34e ${caps}`);

      expect(result.capabilities).toContain("multi_ack_detailed");
      expect(result.capabilities).toContain("thin-pack");
      expect(result.capabilities).toContain("side-band-64k");
      expect(result.capabilities).toContain("ofs-delta");
      expect(result.capabilities).toContain("no-progress");
      expect(result.capabilities).toContain("include-tag");
    });
  });

  describe("error handling", () => {
    it("should reject line without want prefix", () => {
      expect(() => parseWantLine("have fcfcfb1fd94829c1a1704f894fc111d14770d34e")).toThrow(
        'does not start with "want "',
      );
    });

    it("should reject malformed object ID (too short)", () => {
      expect(() => parseWantLine("want abcd1234")).toThrow("malformed object ID");
    });

    it("should reject malformed object ID (too long)", () => {
      expect(() => parseWantLine("want fcfcfb1fd94829c1a1704f894fc111d14770d34eaaaa")).toThrow(
        "malformed object ID",
      );
    });

    it("should reject malformed object ID (invalid chars)", () => {
      expect(() => parseWantLine("want ggggfb1fd94829c1a1704f894fc111d14770d34e")).toThrow(
        "malformed object ID",
      );
    });

    it("should reject empty want line", () => {
      expect(() => parseWantLine("want ")).toThrow("missing object ID");
    });
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// First Command Parsing (receive-pack)
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Parse a command line from Git receive-pack protocol.
 *
 * Format:
 * - First command: `<old-oid> <new-oid> <refname>\0<cap1> <cap2> ...`
 * - Subsequent commands: `<old-oid> <new-oid> <refname>`
 */
interface CommandLine {
  oldOid: string;
  newOid: string;
  refName: string;
  capabilities?: string[];
}

function parseCommandLine(line: string): CommandLine {
  // Check for capabilities separator (NUL byte)
  const nulIndex = line.indexOf("\0");
  let commandPart: string;
  let capPart: string | undefined;

  if (nulIndex !== -1) {
    commandPart = line.slice(0, nulIndex);
    capPart = line.slice(nulIndex + 1);
  } else {
    commandPart = line;
  }

  const parts = commandPart.split(" ");

  if (parts.length < 3) {
    throw new Error("Invalid command line: expected <old> <new> <refname>");
  }

  const oldOid = parts[0];
  const newOid = parts[1];
  const refName = parts.slice(2).join(" ");

  // Validate OIDs (40 hex chars)
  if (!/^[0-9a-f]{40}$/.test(oldOid)) {
    throw new Error(`Invalid command line: malformed old object ID: ${oldOid}`);
  }
  if (!/^[0-9a-f]{40}$/.test(newOid)) {
    throw new Error(`Invalid command line: malformed new object ID: ${newOid}`);
  }

  const capabilities = capPart ? capPart.split(" ").filter((c) => c.length > 0) : undefined;

  return { oldOid, newOid, refName, capabilities };
}

const ZERO_OID = "0000000000000000000000000000000000000000";
const TEST_OID = "fcfcfb1fd94829c1a1704f894fc111d14770d34e";
const TEST_OID2 = "0123456789abcdef0123456789abcdef01234567";

describe("FirstCommand", () => {
  describe("basic parsing", () => {
    it("should parse command without capabilities", () => {
      const result = parseCommandLine(`${ZERO_OID} ${TEST_OID} refs/heads/main`);

      expect(result.oldOid).toBe(ZERO_OID);
      expect(result.newOid).toBe(TEST_OID);
      expect(result.refName).toBe("refs/heads/main");
      expect(result.capabilities).toBeUndefined();
    });

    it("should parse command with single capability", () => {
      const result = parseCommandLine(`${ZERO_OID} ${TEST_OID} refs/heads/main\0report-status`);

      expect(result.oldOid).toBe(ZERO_OID);
      expect(result.newOid).toBe(TEST_OID);
      expect(result.refName).toBe("refs/heads/main");
      expect(result.capabilities).toEqual(["report-status"]);
    });

    it("should parse command with multiple capabilities", () => {
      const result = parseCommandLine(
        `${ZERO_OID} ${TEST_OID} refs/heads/main\0report-status delete-refs side-band-64k`,
      );

      expect(result.refName).toBe("refs/heads/main");
      expect(result.capabilities).toEqual(["report-status", "delete-refs", "side-band-64k"]);
    });
  });

  describe("ref update scenarios", () => {
    it("should handle create (zero old OID)", () => {
      const result = parseCommandLine(`${ZERO_OID} ${TEST_OID} refs/heads/new-branch`);

      expect(result.oldOid).toBe(ZERO_OID);
      expect(result.refName).toBe("refs/heads/new-branch");
    });

    it("should handle delete (zero new OID)", () => {
      const result = parseCommandLine(`${TEST_OID} ${ZERO_OID} refs/heads/to-delete`);

      expect(result.newOid).toBe(ZERO_OID);
      expect(result.refName).toBe("refs/heads/to-delete");
    });

    it("should handle update (both non-zero OIDs)", () => {
      const result = parseCommandLine(`${TEST_OID} ${TEST_OID2} refs/heads/main`);

      expect(result.oldOid).toBe(TEST_OID);
      expect(result.newOid).toBe(TEST_OID2);
    });
  });

  describe("ref name handling", () => {
    it("should handle refs/heads/ prefix", () => {
      const result = parseCommandLine(`${ZERO_OID} ${TEST_OID} refs/heads/feature/my-branch`);
      expect(result.refName).toBe("refs/heads/feature/my-branch");
    });

    it("should handle refs/tags/ prefix", () => {
      const result = parseCommandLine(`${ZERO_OID} ${TEST_OID} refs/tags/v1.0.0`);
      expect(result.refName).toBe("refs/tags/v1.0.0");
    });

    it("should handle refs/for/ prefix (Gerrit)", () => {
      const result = parseCommandLine(`${ZERO_OID} ${TEST_OID} refs/for/main`);
      expect(result.refName).toBe("refs/for/main");
    });

    it("should handle HEAD", () => {
      const result = parseCommandLine(`${ZERO_OID} ${TEST_OID} HEAD`);
      expect(result.refName).toBe("HEAD");
    });
  });

  describe("capability handling", () => {
    it("should handle capability values (e.g., agent=git/2.0)", () => {
      const result = parseCommandLine(`${ZERO_OID} ${TEST_OID} refs/heads/main\0agent=git/2.32.0`);
      expect(result.capabilities).toContain("agent=git/2.32.0");
    });

    it("should handle report-status capability", () => {
      const result = parseCommandLine(`${ZERO_OID} ${TEST_OID} refs/heads/main\0report-status`);
      expect(result.capabilities).toContain("report-status");
    });

    it("should handle delete-refs capability", () => {
      const result = parseCommandLine(`${ZERO_OID} ${TEST_OID} refs/heads/main\0delete-refs`);
      expect(result.capabilities).toContain("delete-refs");
    });

    it("should handle push-options capability", () => {
      const result = parseCommandLine(`${ZERO_OID} ${TEST_OID} refs/heads/main\0push-options`);
      expect(result.capabilities).toContain("push-options");
    });

    it("should handle all common push capabilities", () => {
      const caps = "report-status delete-refs side-band-64k quiet atomic push-options";
      const result = parseCommandLine(`${ZERO_OID} ${TEST_OID} refs/heads/main\0${caps}`);

      expect(result.capabilities).toContain("report-status");
      expect(result.capabilities).toContain("delete-refs");
      expect(result.capabilities).toContain("side-band-64k");
      expect(result.capabilities).toContain("quiet");
      expect(result.capabilities).toContain("atomic");
      expect(result.capabilities).toContain("push-options");
    });
  });

  describe("error handling", () => {
    it("should reject malformed commands (missing parts)", () => {
      expect(() => parseCommandLine(`${TEST_OID} ${TEST_OID2}`)).toThrow(
        "expected <old> <new> <refname>",
      );
    });

    it("should reject malformed old OID", () => {
      expect(() => parseCommandLine(`invalid ${TEST_OID} refs/heads/main`)).toThrow(
        "malformed old object ID",
      );
    });

    it("should reject malformed new OID", () => {
      expect(() => parseCommandLine(`${TEST_OID} invalid refs/heads/main`)).toThrow(
        "malformed new object ID",
      );
    });

    it("should reject empty command", () => {
      expect(() => parseCommandLine("")).toThrow("expected <old> <new> <refname>");
    });
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Have Line Parsing
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Parse a "have" line from Git protocol.
 *
 * Format: `have <oid>`
 */
interface HaveLine {
  oid: string;
}

function parseHaveLine(line: string): HaveLine {
  if (!line.startsWith("have ")) {
    throw new Error(`Invalid have line: does not start with "have "`);
  }

  const oid = line.slice(5).trim();

  if (!oid) {
    throw new Error("Invalid have line: missing object ID");
  }

  if (!/^[0-9a-f]{40}$/.test(oid)) {
    throw new Error(`Invalid have line: malformed object ID: ${oid}`);
  }

  return { oid };
}

describe("HaveLine", () => {
  it("should parse have line", () => {
    const result = parseHaveLine("have fcfcfb1fd94829c1a1704f894fc111d14770d34e");
    expect(result.oid).toBe("fcfcfb1fd94829c1a1704f894fc111d14770d34e");
  });

  it("should reject line without have prefix", () => {
    expect(() => parseHaveLine("want fcfcfb1fd94829c1a1704f894fc111d14770d34e")).toThrow(
      'does not start with "have "',
    );
  });

  it("should reject malformed OID", () => {
    expect(() => parseHaveLine("have abcd")).toThrow("malformed object ID");
  });

  it("should reject empty have line", () => {
    expect(() => parseHaveLine("have ")).toThrow("missing object ID");
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Capability Set Utilities
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Parse capabilities into a Set and Map for key=value pairs.
 */
interface ParsedCapabilities {
  set: Set<string>;
  values: Map<string, string>;
}

function parseCapabilities(caps: string[] | undefined): ParsedCapabilities {
  const set = new Set<string>();
  const values = new Map<string, string>();

  if (!caps) {
    return { set, values };
  }

  for (const cap of caps) {
    const eqIndex = cap.indexOf("=");
    if (eqIndex !== -1) {
      const key = cap.slice(0, eqIndex);
      const value = cap.slice(eqIndex + 1);
      set.add(key);
      values.set(key, value);
    } else {
      set.add(cap);
    }
  }

  return { set, values };
}

describe("parseCapabilities", () => {
  it("should parse simple capabilities", () => {
    const result = parseCapabilities(["multi_ack", "thin-pack", "side-band-64k"]);

    expect(result.set.has("multi_ack")).toBe(true);
    expect(result.set.has("thin-pack")).toBe(true);
    expect(result.set.has("side-band-64k")).toBe(true);
  });

  it("should extract capability values", () => {
    const result = parseCapabilities(["agent=git/2.32.0", "multi_ack"]);

    expect(result.set.has("agent")).toBe(true);
    expect(result.values.get("agent")).toBe("git/2.32.0");
  });

  it("should handle empty array", () => {
    const result = parseCapabilities([]);

    expect(result.set.size).toBe(0);
    expect(result.values.size).toBe(0);
  });

  it("should handle undefined", () => {
    const result = parseCapabilities(undefined);

    expect(result.set.size).toBe(0);
    expect(result.values.size).toBe(0);
  });
});
