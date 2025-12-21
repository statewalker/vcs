/**
 * Tests for person identity formatting and parsing
 */

import { describe, expect, it } from "vitest";
import {
  createPersonIdent,
  formatPersonIdent,
  parsePersonIdent,
} from "../../src/format/person-ident.js";

describe("person-ident", () => {
  describe("formatPersonIdent", () => {
    it("formats identity correctly", () => {
      const ident = {
        name: "John Doe",
        email: "john@example.com",
        timestamp: 1234567890,
        tzOffset: "+0100",
      };

      const result = formatPersonIdent(ident);
      expect(result).toBe("John Doe <john@example.com> 1234567890 +0100");
    });

    it("handles negative timezone", () => {
      const ident = {
        name: "Jane",
        email: "jane@test.com",
        timestamp: 1000000000,
        tzOffset: "-0500",
      };

      const result = formatPersonIdent(ident);
      expect(result).toBe("Jane <jane@test.com> 1000000000 -0500");
    });

    it("handles UTC timezone", () => {
      const ident = {
        name: "User",
        email: "user@host.com",
        timestamp: 0,
        tzOffset: "+0000",
      };

      const result = formatPersonIdent(ident);
      expect(result).toBe("User <user@host.com> 0 +0000");
    });
  });

  describe("parsePersonIdent", () => {
    it("parses basic identity", () => {
      const str = "John Doe <john@example.com> 1234567890 +0100";
      const result = parsePersonIdent(str);

      expect(result.name).toBe("John Doe");
      expect(result.email).toBe("john@example.com");
      expect(result.timestamp).toBe(1234567890);
      expect(result.tzOffset).toBe("+0100");
    });

    it("parses negative timezone", () => {
      const str = "Jane <jane@test.com> 1000000000 -0500";
      const result = parsePersonIdent(str);

      expect(result.tzOffset).toBe("-0500");
    });

    it("handles name with special characters", () => {
      const str = "O'Reilly, Bob Jr. <bob@test.com> 1111111111 +0000";
      const result = parsePersonIdent(str);

      expect(result.name).toBe("O'Reilly, Bob Jr.");
    });

    it("handles email with plus sign", () => {
      const str = "User <user+tag@example.com> 1234567890 +0000";
      const result = parsePersonIdent(str);

      expect(result.email).toBe("user+tag@example.com");
    });

    it("throws for missing email brackets", () => {
      const str = "John Doe john@example.com 1234567890 +0100";
      expect(() => parsePersonIdent(str)).toThrow("no email");
    });

    it("throws for missing timestamp", () => {
      const str = "John Doe <john@example.com>";
      expect(() => parsePersonIdent(str)).toThrow("missing timestamp");
    });

    it("throws for invalid timestamp", () => {
      const str = "John Doe <john@example.com> notanumber +0100";
      expect(() => parsePersonIdent(str)).toThrow("Invalid timestamp");
    });

    it("throws for invalid timezone format", () => {
      const str = "John Doe <john@example.com> 1234567890 EST";
      expect(() => parsePersonIdent(str)).toThrow("Invalid timezone");
    });

    it("throws for timezone without sign", () => {
      const str = "John Doe <john@example.com> 1234567890 0100";
      expect(() => parsePersonIdent(str)).toThrow("Invalid timezone");
    });
  });

  describe("createPersonIdent", () => {
    it("creates identity with current time", () => {
      const before = Math.floor(Date.now() / 1000);
      const result = createPersonIdent("Test User", "test@example.com");
      const after = Math.floor(Date.now() / 1000);

      expect(result.name).toBe("Test User");
      expect(result.email).toBe("test@example.com");
      expect(result.timestamp).toBeGreaterThanOrEqual(before);
      expect(result.timestamp).toBeLessThanOrEqual(after);
      expect(result.tzOffset).toMatch(/^[+-]\d{4}$/);
    });
  });

  describe("roundtrip", () => {
    it("roundtrips identity", () => {
      const original = {
        name: "John Doe",
        email: "john@example.com",
        timestamp: 1234567890,
        tzOffset: "+0100",
      };

      const formatted = formatPersonIdent(original);
      const parsed = parsePersonIdent(formatted);

      expect(parsed).toEqual(original);
    });

    it("roundtrips identity with special characters", () => {
      const original = {
        name: "François Müller",
        email: "francois@münchen.de",
        timestamp: 9999999999,
        tzOffset: "-1200",
      };

      const formatted = formatPersonIdent(original);
      const parsed = parsePersonIdent(formatted);

      expect(parsed).toEqual(original);
    });
  });
});
