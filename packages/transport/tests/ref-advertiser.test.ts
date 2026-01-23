/**
 * Tests for ref advertisement parsing.
 * Ported from JGit's RefAdvertiserTest.java
 */

import { bytesToHex, hexToBytes } from "@statewalker/vcs-utils/hash/utils";
import { describe, expect, it } from "vitest";
import {
  filterRefs,
  getDefaultBranch,
  parseRefAdvertisement,
  refMatchesPrefix,
} from "../src/negotiation/ref-advertiser.js";
import { pktLineReader } from "../src/protocol/pkt-line-codec.js";

// Helper to create packet stream from string
async function* stringToPackets(s: string): AsyncGenerator<Uint8Array> {
  yield new TextEncoder().encode(s);
}

// Helper to create ref advertisement packets
function makeRefLine(idHex: string, refName: string, caps?: string): string {
  const content = caps ? `${idHex} ${refName}\0${caps}\n` : `${idHex} ${refName}\n`;
  const length = content.length + 4;
  return length.toString(16).padStart(4, "0") + content;
}

describe("parseRefAdvertisement", () => {
  const TEST_ID = "fcfcfb1fd94829c1a1704f894fc111d14770d34e";
  const TEST_ID2 = "1234567890123456789012345678901234567890";

  it("should parse single ref with capabilities", async () => {
    const input = `${makeRefLine(TEST_ID, "refs/heads/master", "multi_ack thin-pack")}0000`;

    const packets = pktLineReader(stringToPackets(input));
    const result = await parseRefAdvertisement(packets);

    expect(result.refs.size).toBe(1);
    const masterRef = result.refs.get("refs/heads/master");
    expect(masterRef).toBeDefined();
    expect(bytesToHex(masterRef as Uint8Array)).toBe(TEST_ID);
    expect(result.capabilities).toContain("multi_ack");
    expect(result.capabilities).toContain("thin-pack");
  });

  it("should parse multiple refs", async () => {
    const input =
      makeRefLine(TEST_ID, "refs/heads/master", "multi_ack") +
      makeRefLine(TEST_ID2, "refs/heads/develop") +
      "0000";

    const packets = pktLineReader(stringToPackets(input));
    const result = await parseRefAdvertisement(packets);

    expect(result.refs.size).toBe(2);
    expect(result.refs.has("refs/heads/master")).toBe(true);
    expect(result.refs.has("refs/heads/develop")).toBe(true);
  });

  it("should parse symrefs", async () => {
    const input =
      makeRefLine(TEST_ID, "HEAD", "multi_ack symref=HEAD:refs/heads/main") +
      makeRefLine(TEST_ID, "refs/heads/main") +
      "0000";

    const packets = pktLineReader(stringToPackets(input));
    const result = await parseRefAdvertisement(packets);

    expect(result.symrefs.get("HEAD")).toBe("refs/heads/main");
  });

  it("should parse agent", async () => {
    const input = `${makeRefLine(TEST_ID, "refs/heads/master", "agent=git/2.30.0")}0000`;

    const packets = pktLineReader(stringToPackets(input));
    const result = await parseRefAdvertisement(packets);

    expect(result.agent).toBe("git/2.30.0");
  });

  it("should skip peeled refs", async () => {
    const input =
      makeRefLine(TEST_ID, "refs/tags/v1.0", "multi_ack") +
      makeRefLine(TEST_ID2, "refs/tags/v1.0^{}") +
      "0000";

    const packets = pktLineReader(stringToPackets(input));
    const result = await parseRefAdvertisement(packets);

    expect(result.refs.size).toBe(1);
    expect(result.refs.has("refs/tags/v1.0")).toBe(true);
    expect(result.refs.has("refs/tags/v1.0^{}")).toBe(false);
  });

  it("should skip zero ID", async () => {
    const zeroId = "0000000000000000000000000000000000000000";
    const input =
      makeRefLine(zeroId, "capabilities^{}", "multi_ack") +
      makeRefLine(TEST_ID, "refs/heads/master") +
      "0000";

    const packets = pktLineReader(stringToPackets(input));
    const result = await parseRefAdvertisement(packets);

    expect(result.refs.has("capabilities^{}")).toBe(false);
    expect(result.refs.has("refs/heads/master")).toBe(true);
  });

  it("should handle empty repository", async () => {
    const zeroId = "0000000000000000000000000000000000000000";
    const input = `${makeRefLine(zeroId, "capabilities^{}", "multi_ack")}0000`;

    const packets = pktLineReader(stringToPackets(input));
    const result = await parseRefAdvertisement(packets);

    expect(result.refs.size).toBe(0);
    expect(result.capabilities).toContain("multi_ack");
  });
});

describe("refMatchesPrefix", () => {
  it("should match exact ref", () => {
    expect(refMatchesPrefix("refs/heads/master", "refs/heads/master")).toBe(true);
  });

  it("should not match different ref", () => {
    expect(refMatchesPrefix("refs/heads/master", "refs/heads/develop")).toBe(false);
  });

  it("should match wildcard prefix", () => {
    expect(refMatchesPrefix("refs/heads/master", "refs/heads/*")).toBe(true);
    expect(refMatchesPrefix("refs/heads/feature/foo", "refs/heads/*")).toBe(true);
  });

  it("should not match non-matching prefix", () => {
    expect(refMatchesPrefix("refs/tags/v1.0", "refs/heads/*")).toBe(false);
  });
});

describe("filterRefs", () => {
  const refs = new Map<string, Uint8Array>([
    ["refs/heads/master", hexToBytes("a".repeat(40))],
    ["refs/heads/develop", hexToBytes("b".repeat(40))],
    ["refs/tags/v1.0", hexToBytes("c".repeat(40))],
    ["refs/tags/v2.0", hexToBytes("d".repeat(40))],
  ]);

  it("should return all refs without patterns", () => {
    const result = filterRefs(refs);
    expect(result.size).toBe(4);
  });

  it("should return all refs with empty patterns", () => {
    const result = filterRefs(refs, []);
    expect(result.size).toBe(4);
  });

  it("should filter by exact pattern", () => {
    const result = filterRefs(refs, ["refs/heads/master"]);
    expect(result.size).toBe(1);
    expect(result.has("refs/heads/master")).toBe(true);
  });

  it("should filter by wildcard pattern", () => {
    const result = filterRefs(refs, ["refs/heads/*"]);
    expect(result.size).toBe(2);
    expect(result.has("refs/heads/master")).toBe(true);
    expect(result.has("refs/heads/develop")).toBe(true);
  });

  it("should filter by multiple patterns", () => {
    const result = filterRefs(refs, ["refs/heads/master", "refs/tags/*"]);
    expect(result.size).toBe(3);
    expect(result.has("refs/heads/master")).toBe(true);
    expect(result.has("refs/tags/v1.0")).toBe(true);
    expect(result.has("refs/tags/v2.0")).toBe(true);
  });
});

describe("getDefaultBranch", () => {
  it("should extract branch from HEAD symref", () => {
    const symrefs = new Map([["HEAD", "refs/heads/main"]]);
    expect(getDefaultBranch(symrefs)).toBe("main");
  });

  it("should extract branch with nested name", () => {
    const symrefs = new Map([["HEAD", "refs/heads/feature/foo"]]);
    expect(getDefaultBranch(symrefs)).toBe("feature/foo");
  });

  it("should return undefined for no HEAD symref", () => {
    const symrefs = new Map<string, string>();
    expect(getDefaultBranch(symrefs)).toBeUndefined();
  });

  it("should return undefined for non-branch HEAD", () => {
    const symrefs = new Map([["HEAD", "refs/tags/v1.0"]]);
    expect(getDefaultBranch(symrefs)).toBeUndefined();
  });
});
