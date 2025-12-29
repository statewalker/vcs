/**
 * Comprehensive tests for GitRefStorage
 *
 * Based on JGit's RefDirectoryTest.java
 * Tests various ref management scenarios including edge cases.
 */

import { FilesApi, joinPath, MemFilesApi } from "@statewalker/webrun-files";
import { isSymbolicRef } from "@webrun-vcs/core";
import { beforeEach, describe, expect, it } from "vitest";
import { GitRefStorage } from "../../src/git-ref-storage.js";
import { isValidRefName, peelRef, shortenRefName } from "../../src/refs/ref-directory.js";
import { parseRefContent } from "../../src/refs/ref-reader.js";
import {
  createPeeledTagRef,
  createRef,
  isSymbolicRef as isGitSymbolicRef,
  RefStore,
} from "../../src/refs/ref-types.js";

// Helper to collect async iterable to array
async function collectRefs<T>(iterable: AsyncIterable<T>): Promise<T[]> {
  const result: T[] = [];
  for await (const item of iterable) {
    result.push(item);
  }
  return result;
}

describe("GitRefStorage", () => {
  let files: FilesApi;
  let refs: GitRefStorage;
  const gitDir = "/repo/.git";

  // Sample object IDs
  const commitId1 = "a".repeat(40);
  const commitId2 = "b".repeat(40);
  const commitId3 = "c".repeat(40);
  const tagId = "d".repeat(40);

  beforeEach(async () => {
    files = new FilesApi(new MemFilesApi());
    refs = new GitRefStorage(files, gitDir);
    await refs.initialize();
  });

  describe("HEAD states", () => {
    it("handles symbolic HEAD pointing to main", async () => {
      await files.write(joinPath(gitDir, "HEAD"), [
        new TextEncoder().encode("ref: refs/heads/main\n"),
      ]);
      await files.write(joinPath(gitDir, "refs/heads/main"), [
        new TextEncoder().encode(`${commitId1}\n`),
      ]);

      const head = await refs.get("HEAD");
      expect(head).toBeDefined();
      if (head) {
        expect(isSymbolicRef(head)).toBe(true);
        if (isSymbolicRef(head)) {
          expect(head.target).toBe("refs/heads/main");
        }
      }

      const resolved = await refs.resolve("HEAD");
      expect(resolved?.objectId).toBe(commitId1);
    });

    it("handles detached HEAD pointing to commit", async () => {
      await files.write(joinPath(gitDir, "HEAD"), [new TextEncoder().encode(`${commitId1}\n`)]);

      const head = await refs.get("HEAD");
      expect(head).toBeDefined();
      if (head) {
        expect(isSymbolicRef(head)).toBe(false);
        if (!isSymbolicRef(head)) {
          expect(head.objectId).toBe(commitId1);
        }
      }
    });

    it("handles detached HEAD with other branches", async () => {
      // HEAD is detached but branches exist
      await files.write(joinPath(gitDir, "HEAD"), [new TextEncoder().encode(`${commitId1}\n`)]);
      await files.write(joinPath(gitDir, "refs/heads/main"), [
        new TextEncoder().encode(`${commitId2}\n`),
      ]);
      await files.write(joinPath(gitDir, "refs/heads/feature"), [
        new TextEncoder().encode(`${commitId3}\n`),
      ]);

      const branches = await collectRefs(refs.list("refs/heads/"));
      expect(branches.filter((r) => !isSymbolicRef(r))).toHaveLength(2);
    });

    it("handles unborn branch (HEAD points to non-existent ref)", async () => {
      await files.write(joinPath(gitDir, "HEAD"), [
        new TextEncoder().encode("ref: refs/heads/main\n"),
      ]);
      // refs/heads/main does not exist

      const head = await refs.get("HEAD");
      expect(head).toBeDefined();
      if (head) {
        expect(isSymbolicRef(head)).toBe(true);
      }

      // Resolving should return undefined since target doesn't exist
      const resolved = await refs.resolve("HEAD");
      expect(resolved).toBeUndefined();
    });
  });

  describe("ref resolution", () => {
    it("resolves deeply nested refs", async () => {
      // Create a deep branch hierarchy
      const deepRef = "refs/heads/feature/team/project/task/subtask";
      await files.mkdir(joinPath(gitDir, "refs/heads/feature/team/project/task"));
      await files.write(joinPath(gitDir, deepRef), [new TextEncoder().encode(`${commitId1}\n`)]);

      const ref = await refs.get(deepRef);
      expect(ref).toBeDefined();
      if (ref && !isSymbolicRef(ref)) {
        expect(ref.objectId).toBe(commitId1);
      }
    });

    it("loose ref overrides packed ref", async () => {
      // Write packed ref first
      await files.write(joinPath(gitDir, "packed-refs"), [
        new TextEncoder().encode(
          `# pack-refs with: peeled fully-peeled sorted\n${commitId1} refs/heads/main\n`,
        ),
      ]);

      // Then write loose ref with different value
      await files.write(joinPath(gitDir, "refs/heads/main"), [
        new TextEncoder().encode(`${commitId2}\n`),
      ]);

      const ref = await refs.get("refs/heads/main");
      if (ref && !isSymbolicRef(ref)) {
        expect(ref.objectId).toBe(commitId2); // Loose takes precedence
      }
    });

    it("falls back to packed ref when loose missing", async () => {
      await files.write(joinPath(gitDir, "packed-refs"), [
        new TextEncoder().encode(
          `# pack-refs with: peeled fully-peeled sorted\n${commitId1} refs/heads/main\n`,
        ),
      ]);
      // No loose ref exists

      const ref = await refs.get("refs/heads/main");
      if (ref && !isSymbolicRef(ref)) {
        expect(ref.objectId).toBe(commitId1);
      }
    });

    it("resolves peeled refs from packed-refs", async () => {
      // Packed refs with peeled tag
      await files.write(joinPath(gitDir, "packed-refs"), [
        new TextEncoder().encode(
          `# pack-refs with: peeled fully-peeled sorted\n` +
            `${tagId} refs/tags/v1.0\n` +
            `^${commitId1}\n`,
        ),
      ]);

      const ref = await refs.get("refs/tags/v1.0");
      expect(ref).toBeDefined();
      if (ref && !isSymbolicRef(ref)) {
        expect(ref.objectId).toBe(tagId);
        expect(ref.peeledObjectId).toBe(commitId1);
      }
    });
  });

  describe("garbage and invalid refs", () => {
    it("ignores empty ref files", async () => {
      await files.write(joinPath(gitDir, "refs/heads/empty"), [new Uint8Array(0)]);

      const ref = await refs.get("refs/heads/empty");
      expect(ref).toBeUndefined();
    });

    it("handles whitespace in ref content", async () => {
      await files.write(joinPath(gitDir, "refs/heads/main"), [
        new TextEncoder().encode(`  ${commitId1}  \n`),
      ]);

      const ref = await refs.get("refs/heads/main");
      if (ref && !isSymbolicRef(ref)) {
        expect(ref.objectId).toBe(commitId1);
      }
    });

    it("handles ref with trailing newline", async () => {
      await files.write(joinPath(gitDir, "refs/heads/main"), [
        new TextEncoder().encode(`${commitId1}\n`),
      ]);

      const ref = await refs.get("refs/heads/main");
      if (ref && !isSymbolicRef(ref)) {
        expect(ref.objectId).toBe(commitId1);
      }
    });

    it("handles ref without trailing newline", async () => {
      await files.write(joinPath(gitDir, "refs/heads/main"), [new TextEncoder().encode(commitId1)]);

      const ref = await refs.get("refs/heads/main");
      if (ref && !isSymbolicRef(ref)) {
        expect(ref.objectId).toBe(commitId1);
      }
    });
  });

  describe("symbolic refs", () => {
    it("detects symbolic ref cycles", async () => {
      // Create a cycle: A -> B -> C -> A
      await files.write(joinPath(gitDir, "refs/heads/a"), [
        new TextEncoder().encode("ref: refs/heads/b\n"),
      ]);
      await files.write(joinPath(gitDir, "refs/heads/b"), [
        new TextEncoder().encode("ref: refs/heads/c\n"),
      ]);
      await files.write(joinPath(gitDir, "refs/heads/c"), [
        new TextEncoder().encode("ref: refs/heads/a\n"),
      ]);

      await expect(refs.resolve("refs/heads/a")).rejects.toThrow(/Symbolic ref depth exceeded/);
    });

    it("resolves chain of symbolic refs", async () => {
      // Create a chain: HEAD -> main -> feature
      await files.write(joinPath(gitDir, "HEAD"), [
        new TextEncoder().encode("ref: refs/heads/main\n"),
      ]);
      await files.write(joinPath(gitDir, "refs/heads/main"), [
        new TextEncoder().encode("ref: refs/heads/feature\n"),
      ]);
      await files.write(joinPath(gitDir, "refs/heads/feature"), [
        new TextEncoder().encode(`${commitId1}\n`),
      ]);

      const resolved = await refs.resolve("HEAD");
      expect(resolved?.objectId).toBe(commitId1);
    });

    it("handles symbolic ref with spaces", async () => {
      await files.write(joinPath(gitDir, "HEAD"), [
        new TextEncoder().encode("ref:  refs/heads/main  \n"),
      ]);
      await files.write(joinPath(gitDir, "refs/heads/main"), [
        new TextEncoder().encode(`${commitId1}\n`),
      ]);

      const head = await refs.get("HEAD");
      if (head) {
        expect(isSymbolicRef(head)).toBe(true);
        if (isSymbolicRef(head)) {
          expect(head.target.trim()).toBe("refs/heads/main");
        }
      }
    });
  });

  describe("ref enumeration", () => {
    beforeEach(async () => {
      // Set up some refs
      await files.write(joinPath(gitDir, "HEAD"), [
        new TextEncoder().encode("ref: refs/heads/main\n"),
      ]);
      await files.write(joinPath(gitDir, "refs/heads/main"), [
        new TextEncoder().encode(`${commitId1}\n`),
      ]);
      await files.write(joinPath(gitDir, "refs/heads/feature"), [
        new TextEncoder().encode(`${commitId2}\n`),
      ]);
      await files.write(joinPath(gitDir, "refs/tags/v1.0"), [
        new TextEncoder().encode(`${tagId}\n`),
      ]);
      await files.mkdir(joinPath(gitDir, "refs/remotes/origin"));
      await files.write(joinPath(gitDir, "refs/remotes/origin/main"), [
        new TextEncoder().encode(`${commitId3}\n`),
      ]);
    });

    it("lists all branches", async () => {
      const allRefs = await collectRefs(refs.list("refs/heads/"));
      const branches = allRefs.filter((r) => !isSymbolicRef(r));
      expect(branches).toHaveLength(2);
      const names = branches.map((b) => b.name);
      expect(names).toContain("refs/heads/main");
      expect(names).toContain("refs/heads/feature");
    });

    it("lists all tags", async () => {
      const allRefs = await collectRefs(refs.list("refs/tags/"));
      const tags = allRefs.filter((r) => !isSymbolicRef(r));
      expect(tags).toHaveLength(1);
      expect(tags[0].name).toBe("refs/tags/v1.0");
    });

    it("lists all remotes", async () => {
      const allRefs = await collectRefs(refs.list("refs/remotes/"));
      const remotes = allRefs.filter((r) => !isSymbolicRef(r));
      expect(remotes).toHaveLength(1);
      expect(remotes[0].name).toBe("refs/remotes/origin/main");
    });

    it("lists all refs", async () => {
      const allRefs = await collectRefs(refs.list("refs/"));
      // Should include refs under refs/ (not HEAD in this case)
      expect(allRefs.length).toBeGreaterThanOrEqual(4);
    });
  });

  describe("ref operations", () => {
    it("creates new ref", async () => {
      await refs.set("refs/heads/new-branch", commitId1);

      const ref = await refs.get("refs/heads/new-branch");
      if (ref && !isSymbolicRef(ref)) {
        expect(ref.objectId).toBe(commitId1);
      }
    });

    it("updates existing ref", async () => {
      await refs.set("refs/heads/main", commitId1);
      await refs.set("refs/heads/main", commitId2);

      const ref = await refs.get("refs/heads/main");
      if (ref && !isSymbolicRef(ref)) {
        expect(ref.objectId).toBe(commitId2);
      }
    });

    it("deletes loose ref", async () => {
      await refs.set("refs/heads/to-delete", commitId1);
      expect(await refs.has("refs/heads/to-delete")).toBe(true);

      const deleted = await refs.delete("refs/heads/to-delete");
      expect(deleted).toBe(true);
      expect(await refs.has("refs/heads/to-delete")).toBe(false);
    });

    it("checks ref existence", async () => {
      await refs.set("refs/heads/exists", commitId1);

      expect(await refs.has("refs/heads/exists")).toBe(true);
      expect(await refs.has("refs/heads/does-not-exist")).toBe(false);
    });

    it("sets symbolic ref", async () => {
      await refs.set("refs/heads/main", commitId1);
      await refs.setSymbolic("HEAD", "refs/heads/main");

      const head = await refs.get("HEAD");
      if (head) {
        expect(isSymbolicRef(head)).toBe(true);
        if (isSymbolicRef(head)) {
          expect(head.target).toBe("refs/heads/main");
        }
      }
    });

    it("sets ref to detached state", async () => {
      await refs.set("HEAD", commitId1);

      const head = await refs.get("HEAD");
      if (head) {
        expect(isSymbolicRef(head)).toBe(false);
        if (!isSymbolicRef(head)) {
          expect(head.objectId).toBe(commitId1);
        }
      }
    });

    it("compare-and-swap succeeds with correct expected value", async () => {
      await refs.set("refs/heads/main", commitId1);

      const result = await refs.compareAndSwap("refs/heads/main", commitId1, commitId2);
      expect(result.success).toBe(true);

      const ref = await refs.get("refs/heads/main");
      if (ref && !isSymbolicRef(ref)) {
        expect(ref.objectId).toBe(commitId2);
      }
    });

    it("compare-and-swap fails with wrong expected value", async () => {
      await refs.set("refs/heads/main", commitId1);

      const result = await refs.compareAndSwap("refs/heads/main", commitId3, commitId2);
      expect(result.success).toBe(false);

      // Value should not have changed
      const ref = await refs.get("refs/heads/main");
      if (ref && !isSymbolicRef(ref)) {
        expect(ref.objectId).toBe(commitId1);
      }
    });
  });
});

describe("isValidRefName", () => {
  it("accepts valid ref names", () => {
    expect(isValidRefName("refs/heads/main")).toBe(true);
    expect(isValidRefName("refs/heads/feature/branch")).toBe(true);
    expect(isValidRefName("refs/tags/v1.0.0")).toBe(true);
    expect(isValidRefName("HEAD")).toBe(true);
    expect(isValidRefName("refs/remotes/origin/main")).toBe(true);
  });

  it("rejects empty name", () => {
    expect(isValidRefName("")).toBe(false);
  });

  it("rejects leading slash", () => {
    expect(isValidRefName("/refs/heads/main")).toBe(false);
  });

  it("rejects trailing slash", () => {
    expect(isValidRefName("refs/heads/main/")).toBe(false);
  });

  it("rejects double slashes", () => {
    expect(isValidRefName("refs//heads/main")).toBe(false);
  });

  it("rejects double dots", () => {
    expect(isValidRefName("refs/heads/main..branch")).toBe(false);
  });

  it("rejects @{ sequence", () => {
    expect(isValidRefName("refs/heads/main@{0}")).toBe(false);
  });

  it("rejects .lock suffix", () => {
    expect(isValidRefName("refs/heads/main.lock")).toBe(false);
  });

  it("rejects control characters", () => {
    expect(isValidRefName("refs/heads/main\x00")).toBe(false);
    expect(isValidRefName("refs/heads/main\n")).toBe(false);
  });

  it("rejects special characters", () => {
    expect(isValidRefName("refs/heads/main~1")).toBe(false);
    expect(isValidRefName("refs/heads/main^2")).toBe(false);
    expect(isValidRefName("refs/heads/main:path")).toBe(false);
    expect(isValidRefName("refs/heads/main?")).toBe(false);
    expect(isValidRefName("refs/heads/main*")).toBe(false);
    expect(isValidRefName("refs/heads/main[0]")).toBe(false);
    expect(isValidRefName("refs/heads/main\\branch")).toBe(false);
  });

  it("rejects space", () => {
    expect(isValidRefName("refs/heads/my branch")).toBe(false);
  });
});

describe("shortenRefName", () => {
  it("shortens branch refs", () => {
    expect(shortenRefName("refs/heads/main")).toBe("main");
    expect(shortenRefName("refs/heads/feature/branch")).toBe("feature/branch");
  });

  it("shortens tag refs", () => {
    expect(shortenRefName("refs/tags/v1.0")).toBe("v1.0");
  });

  it("shortens remote refs", () => {
    expect(shortenRefName("refs/remotes/origin/main")).toBe("origin/main");
  });

  it("keeps other refs unchanged", () => {
    expect(shortenRefName("HEAD")).toBe("HEAD");
    expect(shortenRefName("FETCH_HEAD")).toBe("FETCH_HEAD");
    expect(shortenRefName("refs/stash")).toBe("refs/stash");
  });
});

describe("peelRef", () => {
  it("returns peeled object ID when available", () => {
    const ref = createPeeledTagRef(
      "refs/tags/v1.0",
      "a".repeat(40),
      "b".repeat(40),
      RefStore.LOOSE,
    );
    expect(peelRef(ref)).toBe("b".repeat(40));
  });

  it("returns object ID when not peeled", () => {
    const ref = createRef("refs/heads/main", "a".repeat(40), RefStore.LOOSE);
    expect(peelRef(ref)).toBe("a".repeat(40));
  });
});

describe("parseRefContent", () => {
  it("parses object ID ref", () => {
    const content = new TextEncoder().encode(`${"a".repeat(40)}\n`);
    const ref = parseRefContent("refs/heads/main", content);

    expect(isGitSymbolicRef(ref)).toBe(false);
    if (!isGitSymbolicRef(ref)) {
      expect(ref.objectId).toBe("a".repeat(40));
    }
  });

  it("parses symbolic ref", () => {
    const content = new TextEncoder().encode("ref: refs/heads/main\n");
    const ref = parseRefContent("HEAD", content);

    expect(isGitSymbolicRef(ref)).toBe(true);
    if (isGitSymbolicRef(ref)) {
      expect(ref.target).toBe("refs/heads/main");
    }
  });

  it("handles uppercase object ID", () => {
    const content = new TextEncoder().encode(`${"A".repeat(40)}\n`);
    const ref = parseRefContent("refs/heads/main", content);

    if (!isGitSymbolicRef(ref)) {
      expect(ref.objectId).toBe("a".repeat(40)); // Should be lowercase
    }
  });

  it("throws on too short object ID", () => {
    const content = new TextEncoder().encode("abc123\n");
    expect(() => parseRefContent("refs/heads/main", content)).toThrow(/too short/);
  });
});

describe("special refs", () => {
  let files: FilesApi;
  let refs: GitRefStorage;
  const gitDir = "/repo/.git";
  const commitId1 = "a".repeat(40);
  const commitId2 = "b".repeat(40);

  beforeEach(async () => {
    files = new FilesApi(new MemFilesApi());
    refs = new GitRefStorage(files, gitDir);
    await refs.initialize();
  });

  describe("FETCH_HEAD", () => {
    it("reads simple FETCH_HEAD", async () => {
      // Simple FETCH_HEAD with just an object ID
      await files.write(joinPath(gitDir, "FETCH_HEAD"), [
        new TextEncoder().encode(`${commitId1}\n`),
      ]);

      const ref = await refs.get("FETCH_HEAD");
      expect(ref).toBeDefined();
      if (ref && !isSymbolicRef(ref)) {
        expect(ref.objectId).toBe(commitId1);
      }
    });

    it("reads FETCH_HEAD with branch metadata", async () => {
      // FETCH_HEAD with additional metadata (first 40 chars is the object ID)
      const content = `${commitId1}\tbranch 'main' of https://github.com/user/repo\n`;
      await files.write(joinPath(gitDir, "FETCH_HEAD"), [new TextEncoder().encode(content)]);

      const ref = await refs.get("FETCH_HEAD");
      expect(ref).toBeDefined();
      if (ref && !isSymbolicRef(ref)) {
        expect(ref.objectId).toBe(commitId1);
      }
    });

    it("reads first entry from multi-line FETCH_HEAD", async () => {
      // FETCH_HEAD can contain multiple entries, first is "for merge"
      const content =
        `${commitId1}\t\tbranch 'main' of https://github.com/user/repo\n` +
        `${commitId2}\tnot-for-merge\tbranch 'feature' of https://github.com/user/repo\n`;
      await files.write(joinPath(gitDir, "FETCH_HEAD"), [new TextEncoder().encode(content)]);

      const ref = await refs.get("FETCH_HEAD");
      expect(ref).toBeDefined();
      if (ref && !isSymbolicRef(ref)) {
        expect(ref.objectId).toBe(commitId1);
      }
    });

    it("handles missing FETCH_HEAD", async () => {
      const ref = await refs.get("FETCH_HEAD");
      expect(ref).toBeUndefined();
    });
  });

  describe("ORIG_HEAD", () => {
    it("reads ORIG_HEAD", async () => {
      await files.write(joinPath(gitDir, "ORIG_HEAD"), [
        new TextEncoder().encode(`${commitId1}\n`),
      ]);

      const ref = await refs.get("ORIG_HEAD");
      expect(ref).toBeDefined();
      if (ref && !isSymbolicRef(ref)) {
        expect(ref.objectId).toBe(commitId1);
      }
    });

    it("handles missing ORIG_HEAD", async () => {
      const ref = await refs.get("ORIG_HEAD");
      expect(ref).toBeUndefined();
    });

    it("resolves ORIG_HEAD directly (not symbolic)", async () => {
      await files.write(joinPath(gitDir, "ORIG_HEAD"), [
        new TextEncoder().encode(`${commitId1}\n`),
      ]);

      const ref = await refs.get("ORIG_HEAD");
      expect(ref).toBeDefined();
      if (ref) {
        expect(isSymbolicRef(ref)).toBe(false);
      }
    });
  });

  describe("MERGE_HEAD", () => {
    it("reads MERGE_HEAD", async () => {
      await files.write(joinPath(gitDir, "MERGE_HEAD"), [
        new TextEncoder().encode(`${commitId1}\n`),
      ]);

      const ref = await refs.get("MERGE_HEAD");
      expect(ref).toBeDefined();
      if (ref && !isSymbolicRef(ref)) {
        expect(ref.objectId).toBe(commitId1);
      }
    });

    it("reads multi-parent MERGE_HEAD (octopus)", async () => {
      // MERGE_HEAD can contain multiple commit IDs for octopus merges
      const content = `${commitId1}\n${commitId2}\n`;
      await files.write(joinPath(gitDir, "MERGE_HEAD"), [new TextEncoder().encode(content)]);

      const ref = await refs.get("MERGE_HEAD");
      expect(ref).toBeDefined();
      // First parent is the ref target
      if (ref && !isSymbolicRef(ref)) {
        expect(ref.objectId).toBe(commitId1);
      }
    });

    it("handles missing MERGE_HEAD", async () => {
      const ref = await refs.get("MERGE_HEAD");
      expect(ref).toBeUndefined();
    });
  });

  describe("CHERRY_PICK_HEAD", () => {
    it("reads CHERRY_PICK_HEAD", async () => {
      await files.write(joinPath(gitDir, "CHERRY_PICK_HEAD"), [
        new TextEncoder().encode(`${commitId1}\n`),
      ]);

      const ref = await refs.get("CHERRY_PICK_HEAD");
      expect(ref).toBeDefined();
      if (ref && !isSymbolicRef(ref)) {
        expect(ref.objectId).toBe(commitId1);
      }
    });

    it("handles missing CHERRY_PICK_HEAD", async () => {
      const ref = await refs.get("CHERRY_PICK_HEAD");
      expect(ref).toBeUndefined();
    });
  });
});
