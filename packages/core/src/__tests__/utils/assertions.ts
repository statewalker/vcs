import { expect } from "vitest";
import type { Blob } from "../../history/blobs/types.js";
import type { Commits } from "../../history/commits/commits.js";
import type { Commit } from "../../history/commits/types.js";
import type { Refs } from "../../history/refs/refs.js";
import type { Tree } from "../../history/trees/types.js";

/**
 * Assert that a value is a valid SHA-1 hash.
 */
export function expectValidObjectId(id: unknown): asserts id is string {
  expect(typeof id).toBe("string");
  expect(id).toMatch(/^[0-9a-f]{40}$/);
}

/**
 * Assert that two blobs have identical content.
 */
export async function expectBlobsEqual(
  blob1: Blob | undefined,
  blob2: Blob | undefined,
): Promise<void> {
  expect(blob1).toBeDefined();
  expect(blob2).toBeDefined();
  expect(blob1?.content).toEqual(blob2?.content);
}

/**
 * Assert that a tree contains expected entries.
 */
export function expectTreeContains(
  tree: Tree | undefined,
  expected: Array<{ name: string; mode?: string }>,
): void {
  expect(tree).toBeDefined();

  for (const exp of expected) {
    const entry = tree?.entries.find((e) => e.name === exp.name);
    expect(entry).toBeDefined();
    if (exp.mode) {
      expect(entry?.mode).toBe(exp.mode);
    }
  }
}

/**
 * Assert that a commit has expected parent count.
 */
export function expectCommitParents(commit: Commit | undefined, count: number): void {
  expect(commit).toBeDefined();
  expect(commit?.parents).toHaveLength(count);
}

/**
 * Assert that a ref points to expected commit.
 */
export async function expectRefEquals(
  refs: Refs,
  refName: string,
  expectedCommit: string,
): Promise<void> {
  const value = await refs.getRef(refName);
  expect(value).toBe(expectedCommit);
}

/**
 * Assert history is linear (each commit has at most 1 parent).
 */
export async function expectLinearHistory(
  commits: Commits,
  tip: string,
  length: number,
): Promise<void> {
  let current = tip;
  let count = 0;

  while (current) {
    const commit = await commits.load(current);
    expect(commit).toBeDefined();
    expect(commit?.parents.length).toBeLessThanOrEqual(1);

    count++;
    current = commit?.parents[0] ?? "";
  }

  expect(count).toBe(length);
}

/**
 * Assert pack file is valid.
 */
export function expectValidPack(pack: Uint8Array): void {
  // Check header
  const header = new TextDecoder().decode(pack.slice(0, 4));
  expect(header).toBe("PACK");

  // Check version
  const version = new DataView(pack.buffer).getUint32(4, false);
  expect([2, 3]).toContain(version);

  // Check has checksum
  expect(pack.length).toBeGreaterThan(32);
}
