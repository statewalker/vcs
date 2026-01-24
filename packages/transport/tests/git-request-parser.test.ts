/**
 * Git Protocol Request Parser Tests
 *
 * Tests for parsing git:// protocol initial request format.
 * Modeled after JGit's PacketLineInTest.java for request parsing.
 */

import { describe, expect, it } from "vitest";
import {
  encodeGitProtocolRequest,
  extraParamsToArray,
  GIT_PROTOCOL_DEFAULT_PORT,
  type GitProtocolRequest,
  type GitProtocolService,
  getProtocolVersion,
  isValidService,
  parseGitProtocolRequest,
} from "../src/protocol/git-request-parser.js";

// ─────────────────────────────────────────────────────────────────────────────
// parseGitProtocolRequest Tests
// ─────────────────────────────────────────────────────────────────────────────

describe("parseGitProtocolRequest", () => {
  describe("basic parsing", () => {
    it("should parse git-upload-pack request", () => {
      const data = new TextEncoder().encode("git-upload-pack /repo.git\0host=example.com\0");
      const result = parseGitProtocolRequest(data);

      expect(result.service).toBe("git-upload-pack");
      expect(result.path).toBe("/repo.git");
      expect(result.host).toBe("example.com");
    });

    it("should parse git-receive-pack request", () => {
      const data = new TextEncoder().encode("git-receive-pack /user/repo.git\0host=github.com\0");
      const result = parseGitProtocolRequest(data);

      expect(result.service).toBe("git-receive-pack");
      expect(result.path).toBe("/user/repo.git");
      expect(result.host).toBe("github.com");
    });

    it("should parse request with empty host", () => {
      const data = new TextEncoder().encode("git-upload-pack /local/repo.git\0host=\0");
      const result = parseGitProtocolRequest(data);

      expect(result.service).toBe("git-upload-pack");
      expect(result.path).toBe("/local/repo.git");
      expect(result.host).toBe("");
    });

    it("should parse request without host parameter", () => {
      const data = new TextEncoder().encode("git-upload-pack /repo.git\0");
      const result = parseGitProtocolRequest(data);

      expect(result.service).toBe("git-upload-pack");
      expect(result.path).toBe("/repo.git");
      expect(result.host).toBe("");
    });
  });

  describe("path parsing", () => {
    it("should handle paths without leading slash", () => {
      const data = new TextEncoder().encode("git-upload-pack repo.git\0host=example.com\0");
      const result = parseGitProtocolRequest(data);

      expect(result.path).toBe("repo.git");
    });

    it("should handle nested paths", () => {
      const data = new TextEncoder().encode(
        "git-upload-pack /org/team/repo.git\0host=github.com\0",
      );
      const result = parseGitProtocolRequest(data);

      expect(result.path).toBe("/org/team/repo.git");
    });

    it("should handle paths with special characters", () => {
      const data = new TextEncoder().encode(
        "git-upload-pack /user/my-repo_v2.git\0host=example.com\0",
      );
      const result = parseGitProtocolRequest(data);

      expect(result.path).toBe("/user/my-repo_v2.git");
    });

    it("should handle empty path", () => {
      const data = new TextEncoder().encode("git-upload-pack \0host=example.com\0");
      const result = parseGitProtocolRequest(data);

      expect(result.path).toBe("/");
    });
  });

  describe("extra parameters", () => {
    it("should parse version parameter", () => {
      const data = new TextEncoder().encode(
        "git-upload-pack /repo.git\0host=example.com\0version=2\0",
      );
      const result = parseGitProtocolRequest(data);

      expect(result.extraParams).toBeDefined();
      expect(result.extraParams?.get("version")).toBe("2");
    });

    it("should parse multiple extra parameters", () => {
      const data = new TextEncoder().encode(
        "git-upload-pack /repo.git\0host=example.com\0version=2\0object-format=sha256\0",
      );
      const result = parseGitProtocolRequest(data);

      expect(result.extraParams).toBeDefined();
      expect(result.extraParams?.get("version")).toBe("2");
      expect(result.extraParams?.get("object-format")).toBe("sha256");
    });

    it("should not have extraParams if none provided", () => {
      const data = new TextEncoder().encode("git-upload-pack /repo.git\0host=example.com\0");
      const result = parseGitProtocolRequest(data);

      expect(result.extraParams).toBeUndefined();
    });

    it("should ignore empty parameters", () => {
      const data = new TextEncoder().encode(
        "git-upload-pack /repo.git\0host=example.com\0\0version=2\0",
      );
      const result = parseGitProtocolRequest(data);

      expect(result.extraParams?.get("version")).toBe("2");
    });
  });

  describe("error handling", () => {
    it("should reject empty request", () => {
      const data = new TextEncoder().encode("");
      expect(() => parseGitProtocolRequest(data)).toThrow(
        "Invalid git protocol request: empty request",
      );
    });

    it("should reject request without space", () => {
      const data = new TextEncoder().encode("git-upload-pack\0");
      expect(() => parseGitProtocolRequest(data)).toThrow(
        "Invalid git protocol request: no space between service and path",
      );
    });

    it("should reject unknown service", () => {
      const data = new TextEncoder().encode("git-unknown /repo.git\0host=example.com\0");
      expect(() => parseGitProtocolRequest(data)).toThrow("Unknown git service: git-unknown");
    });

    it("should reject malformed service", () => {
      const data = new TextEncoder().encode("fetch /repo.git\0host=example.com\0");
      expect(() => parseGitProtocolRequest(data)).toThrow("Unknown git service: fetch");
    });
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// encodeGitProtocolRequest Tests
// ─────────────────────────────────────────────────────────────────────────────

describe("encodeGitProtocolRequest", () => {
  it("should encode basic request", () => {
    const request: GitProtocolRequest = {
      service: "git-upload-pack",
      path: "/repo.git",
      host: "example.com",
    };

    const encoded = encodeGitProtocolRequest(request);
    const text = new TextDecoder().decode(encoded);

    // Format: <4-digit hex length><content>
    expect(text).toMatch(/^[0-9a-f]{4}git-upload-pack \/repo\.git\0host=example\.com\0$/);
  });

  it("should encode request with empty host", () => {
    const request: GitProtocolRequest = {
      service: "git-upload-pack",
      path: "/repo.git",
      host: "",
    };

    const encoded = encodeGitProtocolRequest(request);
    const text = new TextDecoder().decode(encoded);

    expect(text).toContain("host=\0");
  });

  it("should encode request with extra parameters", () => {
    const request: GitProtocolRequest = {
      service: "git-upload-pack",
      path: "/repo.git",
      host: "example.com",
      extraParams: new Map([["version", "2"]]),
    };

    const encoded = encodeGitProtocolRequest(request);
    const text = new TextDecoder().decode(encoded);

    expect(text).toContain("version=2\0");
  });

  it("should calculate correct pkt-line length", () => {
    const request: GitProtocolRequest = {
      service: "git-upload-pack",
      path: "/repo.git",
      host: "example.com",
    };

    const encoded = encodeGitProtocolRequest(request);

    // Length prefix is first 4 bytes
    const lengthHex = new TextDecoder().decode(encoded.slice(0, 4));
    const expectedLength = parseInt(lengthHex, 16);

    expect(encoded.length).toBe(expectedLength);
  });

  describe("roundtrip", () => {
    it("should roundtrip basic request", () => {
      const original: GitProtocolRequest = {
        service: "git-upload-pack",
        path: "/user/repo.git",
        host: "github.com",
      };

      const encoded = encodeGitProtocolRequest(original);
      // Skip the 4-byte length prefix to get the content
      const parsed = parseGitProtocolRequest(encoded.slice(4));

      expect(parsed.service).toBe(original.service);
      expect(parsed.path).toBe(original.path);
      expect(parsed.host).toBe(original.host);
    });

    it("should roundtrip request with extra params", () => {
      const original: GitProtocolRequest = {
        service: "git-receive-pack",
        path: "/repo.git",
        host: "example.com",
        extraParams: new Map([
          ["version", "2"],
          ["object-format", "sha256"],
        ]),
      };

      const encoded = encodeGitProtocolRequest(original);
      const parsed = parseGitProtocolRequest(encoded.slice(4));

      expect(parsed.service).toBe(original.service);
      expect(parsed.path).toBe(original.path);
      expect(parsed.host).toBe(original.host);
      expect(parsed.extraParams?.get("version")).toBe("2");
      expect(parsed.extraParams?.get("object-format")).toBe("sha256");
    });
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Helper Function Tests
// ─────────────────────────────────────────────────────────────────────────────

describe("isValidService", () => {
  it("should validate git-upload-pack", () => {
    expect(isValidService("git-upload-pack")).toBe(true);
  });

  it("should validate git-receive-pack", () => {
    expect(isValidService("git-receive-pack")).toBe(true);
  });

  it("should reject invalid service", () => {
    expect(isValidService("git-fetch")).toBe(false);
    expect(isValidService("upload-pack")).toBe(false);
    expect(isValidService("receive-pack")).toBe(false);
    expect(isValidService("")).toBe(false);
  });
});

describe("extraParamsToArray", () => {
  it("should convert Map to array", () => {
    const params = new Map([
      ["version", "2"],
      ["filter", "blob:none"],
    ]);

    const array = extraParamsToArray(params);

    expect(array).toContain("version=2");
    expect(array).toContain("filter=blob:none");
    expect(array.length).toBe(2);
  });

  it("should return empty array for undefined", () => {
    expect(extraParamsToArray(undefined)).toEqual([]);
  });

  it("should return empty array for empty Map", () => {
    expect(extraParamsToArray(new Map())).toEqual([]);
  });
});

describe("getProtocolVersion", () => {
  it("should extract version 2", () => {
    const params = new Map([["version", "2"]]);
    expect(getProtocolVersion(params)).toBe("2");
  });

  it("should extract version 1", () => {
    const params = new Map([["version", "1"]]);
    expect(getProtocolVersion(params)).toBe("1");
  });

  it("should return undefined for no version", () => {
    const params = new Map([["filter", "blob:none"]]);
    expect(getProtocolVersion(params)).toBeUndefined();
  });

  it("should return undefined for undefined params", () => {
    expect(getProtocolVersion(undefined)).toBeUndefined();
  });

  it("should return undefined for unknown version", () => {
    const params = new Map([["version", "3"]]);
    expect(getProtocolVersion(params)).toBeUndefined();
  });
});

describe("GIT_PROTOCOL_DEFAULT_PORT", () => {
  it("should be 9418", () => {
    expect(GIT_PROTOCOL_DEFAULT_PORT).toBe(9418);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Service Type Tests
// ─────────────────────────────────────────────────────────────────────────────

describe("GitProtocolService type", () => {
  it("should allow git-upload-pack", () => {
    const service: GitProtocolService = "git-upload-pack";
    expect(service).toBe("git-upload-pack");
  });

  it("should allow git-receive-pack", () => {
    const service: GitProtocolService = "git-receive-pack";
    expect(service).toBe("git-receive-pack");
  });
});
