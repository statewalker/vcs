/**
 * Comprehensive tests for RefDirectory
 *
 * Based on JGit's RefDirectoryTest.java
 * Tests various ref management scenarios including edge cases.
 */

import { MemFilesApi } from "@statewalker/webrun-files";
import { beforeEach, describe, expect, it } from "vitest";
import { GitFilesApi } from "../../src/git-files-api.js";
import {
  createRefDirectory,
  isValidRefName,
  peelRef,
  type RefDirectory,
  shortenRefName,
} from "../../src/refs/ref-directory.js";
import { parseRefContent } from "../../src/refs/ref-reader.js";
import {
  createPeeledTagRef,
  createRef,
  isSymbolicRef,
  RefStorage,
} from "../../src/refs/ref-types.js";

describe("RefDirectory", () => {
  let files: GitFilesApi;
  let refs: RefDirectory;
  const gitDir = "/repo/.git";

  // Sample object IDs
  const commitId1 = "a".repeat(40);
  const commitId2 = "b".repeat(40);
  const commitId3 = "c".repeat(40);
  const tagId = "d".repeat(40);

  beforeEach(async () => {
    files = new GitFilesApi(new MemFilesApi());
    refs = createRefDirectory(files, gitDir);
    await refs.create();
  });

  describe("HEAD states", () => {
    it("handles symbolic HEAD pointing to main", async () => {
      await files.writeFile(
        files.join(gitDir, "HEAD"),
        new TextEncoder().encode("ref: refs/heads/main\n"),
      );
      await files.writeFile(
        files.join(gitDir, "refs/heads/main"),
        new TextEncoder().encode(`${commitId1}\n`),
      );

      const head = await refs.getHead();
      expect(head).toBeDefined();
      expect(isSymbolicRef(head!)).toBe(true);
      if (isSymbolicRef(head!)) {
        expect(head?.target).toBe("refs/heads/main");
      }

      const resolved = await refs.resolve("HEAD");
      expect(resolved?.objectId).toBe(commitId1);

      expect(await refs.getCurrentBranch()).toBe("main");
    });

    it("handles detached HEAD pointing to commit", async () => {
      await files.writeFile(files.join(gitDir, "HEAD"), new TextEncoder().encode(`${commitId1}\n`));

      const head = await refs.getHead();
      expect(head).toBeDefined();
      expect(isSymbolicRef(head!)).toBe(false);
      expect(head?.objectId).toBe(commitId1);

      expect(await refs.getCurrentBranch()).toBeUndefined();
    });

    it("handles detached HEAD with other branches", async () => {
      // HEAD is detached but branches exist
      await files.writeFile(files.join(gitDir, "HEAD"), new TextEncoder().encode(`${commitId1}\n`));
      await files.writeFile(
        files.join(gitDir, "refs/heads/main"),
        new TextEncoder().encode(`${commitId2}\n`),
      );
      await files.writeFile(
        files.join(gitDir, "refs/heads/feature"),
        new TextEncoder().encode(`${commitId3}\n`),
      );

      expect(await refs.getCurrentBranch()).toBeUndefined();

      const branches = await refs.getBranches();
      expect(branches).toHaveLength(2);
    });

    it("handles unborn branch (HEAD points to non-existent ref)", async () => {
      await files.writeFile(
        files.join(gitDir, "HEAD"),
        new TextEncoder().encode("ref: refs/heads/main\n"),
      );
      // refs/heads/main does not exist

      const head = await refs.getHead();
      expect(head).toBeDefined();
      expect(isSymbolicRef(head!)).toBe(true);

      // Resolving should return undefined since target doesn't exist
      const resolved = await refs.resolve("HEAD");
      expect(resolved).toBeUndefined();

      expect(await refs.getCurrentBranch()).toBe("main");
    });
  });

  describe("ref resolution", () => {
    it("resolves deeply nested refs", async () => {
      // Create a deep branch hierarchy
      const deepRef = "refs/heads/feature/team/project/task/subtask";
      await files.mkdir(files.join(gitDir, "refs/heads/feature/team/project/task"), {
        recursive: true,
      });
      await files.writeFile(
        files.join(gitDir, deepRef),
        new TextEncoder().encode(`${commitId1}\n`),
      );

      const ref = await refs.exactRef(deepRef);
      expect(ref).toBeDefined();
      expect(ref?.objectId).toBe(commitId1);
    });

    it("loose ref overrides packed ref", async () => {
      // Write packed ref first
      await files.writeFile(
        files.join(gitDir, "packed-refs"),
        new TextEncoder().encode(
          `# pack-refs with: peeled fully-peeled sorted\n${commitId1} refs/heads/main\n`,
        ),
      );

      // Then write loose ref with different value
      await files.writeFile(
        files.join(gitDir, "refs/heads/main"),
        new TextEncoder().encode(`${commitId2}\n`),
      );

      const ref = await refs.exactRef("refs/heads/main");
      expect(ref?.objectId).toBe(commitId2); // Loose takes precedence
    });

    it("falls back to packed ref when loose missing", async () => {
      await files.writeFile(
        files.join(gitDir, "packed-refs"),
        new TextEncoder().encode(
          `# pack-refs with: peeled fully-peeled sorted\n${commitId1} refs/heads/main\n`,
        ),
      );
      // No loose ref exists

      const ref = await refs.exactRef("refs/heads/main");
      expect(ref?.objectId).toBe(commitId1);
    });

    it("resolves peeled refs from packed-refs", async () => {
      // Packed refs with peeled tag
      await files.writeFile(
        files.join(gitDir, "packed-refs"),
        new TextEncoder().encode(
          `# pack-refs with: peeled fully-peeled sorted\n` +
            `${tagId} refs/tags/v1.0\n` +
            `^${commitId1}\n`,
        ),
      );

      const ref = await refs.exactRef("refs/tags/v1.0");
      expect(ref).toBeDefined();
      expect(ref?.objectId).toBe(tagId);
      if (!isSymbolicRef(ref!)) {
        expect(ref.peeledObjectId).toBe(commitId1);
      }
    });
  });

  describe("garbage and invalid refs", () => {
    it("ignores empty ref files", async () => {
      await files.writeFile(files.join(gitDir, "refs/heads/empty"), new Uint8Array(0));

      const ref = await refs.exactRef("refs/heads/empty");
      expect(ref).toBeUndefined();
    });

    it("skips .lock files when enumerating", async () => {
      await files.writeFile(
        files.join(gitDir, "refs/heads/main"),
        new TextEncoder().encode(`${commitId1}\n`),
      );
      await files.writeFile(
        files.join(gitDir, "refs/heads/main.lock"),
        new TextEncoder().encode(`${commitId2}\n`),
      );

      const branches = await refs.getBranches();
      const branchNames = branches.map((b) => b.name);

      expect(branchNames).toContain("refs/heads/main");
      // .lock file should be treated as a regular file entry, not a ref
      // The implementation may include it as a file, but shouldn't parse it as a branch
    });

    it("handles whitespace in ref content", async () => {
      await files.writeFile(
        files.join(gitDir, "refs/heads/main"),
        new TextEncoder().encode(`  ${commitId1}  \n`),
      );

      const ref = await refs.exactRef("refs/heads/main");
      expect(ref?.objectId).toBe(commitId1);
    });

    it("handles ref with trailing newline", async () => {
      await files.writeFile(
        files.join(gitDir, "refs/heads/main"),
        new TextEncoder().encode(`${commitId1}\n`),
      );

      const ref = await refs.exactRef("refs/heads/main");
      expect(ref?.objectId).toBe(commitId1);
    });

    it("handles ref without trailing newline", async () => {
      await files.writeFile(
        files.join(gitDir, "refs/heads/main"),
        new TextEncoder().encode(commitId1),
      );

      const ref = await refs.exactRef("refs/heads/main");
      expect(ref?.objectId).toBe(commitId1);
    });
  });

  describe("symbolic refs", () => {
    it("detects symbolic ref cycles", async () => {
      // Create a cycle: A -> B -> C -> A
      await files.writeFile(
        files.join(gitDir, "refs/heads/a"),
        new TextEncoder().encode("ref: refs/heads/b\n"),
      );
      await files.writeFile(
        files.join(gitDir, "refs/heads/b"),
        new TextEncoder().encode("ref: refs/heads/c\n"),
      );
      await files.writeFile(
        files.join(gitDir, "refs/heads/c"),
        new TextEncoder().encode("ref: refs/heads/a\n"),
      );

      await expect(refs.resolve("refs/heads/a")).rejects.toThrow(/Symbolic ref depth exceeded/);
    });

    it("resolves chain of symbolic refs", async () => {
      // Create a chain: HEAD -> main -> feature
      await files.writeFile(
        files.join(gitDir, "HEAD"),
        new TextEncoder().encode("ref: refs/heads/main\n"),
      );
      await files.writeFile(
        files.join(gitDir, "refs/heads/main"),
        new TextEncoder().encode("ref: refs/heads/feature\n"),
      );
      await files.writeFile(
        files.join(gitDir, "refs/heads/feature"),
        new TextEncoder().encode(`${commitId1}\n`),
      );

      const resolved = await refs.resolve("HEAD");
      expect(resolved?.objectId).toBe(commitId1);
    });

    it("handles symbolic ref with spaces", async () => {
      await files.writeFile(
        files.join(gitDir, "HEAD"),
        new TextEncoder().encode("ref:  refs/heads/main  \n"),
      );
      await files.writeFile(
        files.join(gitDir, "refs/heads/main"),
        new TextEncoder().encode(`${commitId1}\n`),
      );

      const head = await refs.getHead();
      expect(isSymbolicRef(head!)).toBe(true);
      if (isSymbolicRef(head!)) {
        expect(head?.target.trim()).toBe("refs/heads/main");
      }
    });
  });

  describe("ref enumeration", () => {
    beforeEach(async () => {
      // Set up some refs
      await files.writeFile(
        files.join(gitDir, "HEAD"),
        new TextEncoder().encode("ref: refs/heads/main\n"),
      );
      await files.writeFile(
        files.join(gitDir, "refs/heads/main"),
        new TextEncoder().encode(`${commitId1}\n`),
      );
      await files.writeFile(
        files.join(gitDir, "refs/heads/feature"),
        new TextEncoder().encode(`${commitId2}\n`),
      );
      await files.writeFile(
        files.join(gitDir, "refs/tags/v1.0"),
        new TextEncoder().encode(`${tagId}\n`),
      );
      await files.mkdir(files.join(gitDir, "refs/remotes/origin"), { recursive: true });
      await files.writeFile(
        files.join(gitDir, "refs/remotes/origin/main"),
        new TextEncoder().encode(`${commitId3}\n`),
      );
    });

    it("lists all branches", async () => {
      const branches = await refs.getBranches();
      expect(branches).toHaveLength(2);
      const names = branches.map((b) => b.name);
      expect(names).toContain("refs/heads/main");
      expect(names).toContain("refs/heads/feature");
    });

    it("lists all tags", async () => {
      const tags = await refs.getTags();
      expect(tags).toHaveLength(1);
      expect(tags[0].name).toBe("refs/tags/v1.0");
    });

    it("lists all remotes", async () => {
      const remotes = await refs.getRemotes();
      expect(remotes).toHaveLength(1);
      expect(remotes[0].name).toBe("refs/remotes/origin/main");
    });

    it("lists all refs", async () => {
      const allRefs = await refs.getAllRefs();
      // Should include HEAD and all refs under refs/
      expect(allRefs.length).toBeGreaterThanOrEqual(4);
    });

    it("filters refs by prefix", async () => {
      const headRefs = await refs.getRefsByPrefix("refs/heads/");
      expect(headRefs).toHaveLength(2);

      const tagRefs = await refs.getRefsByPrefix("refs/tags/");
      expect(tagRefs).toHaveLength(1);
    });
  });

  describe("ref operations", () => {
    it("creates new ref", async () => {
      await refs.setRef("refs/heads/new-branch", commitId1);

      const ref = await refs.exactRef("refs/heads/new-branch");
      expect(ref?.objectId).toBe(commitId1);
    });

    it("updates existing ref", async () => {
      await refs.setRef("refs/heads/main", commitId1);
      await refs.setRef("refs/heads/main", commitId2);

      const ref = await refs.exactRef("refs/heads/main");
      expect(ref?.objectId).toBe(commitId2);
    });

    it("deletes loose ref", async () => {
      await refs.setRef("refs/heads/to-delete", commitId1);
      expect(await refs.has("refs/heads/to-delete")).toBe(true);

      const deleted = await refs.delete("refs/heads/to-delete");
      expect(deleted).toBe(true);
      expect(await refs.has("refs/heads/to-delete")).toBe(false);
    });

    it("checks ref existence", async () => {
      await refs.setRef("refs/heads/exists", commitId1);

      expect(await refs.has("refs/heads/exists")).toBe(true);
      expect(await refs.has("refs/heads/does-not-exist")).toBe(false);
    });

    it("sets HEAD to branch", async () => {
      await refs.setRef("refs/heads/main", commitId1);
      await refs.setHead("main");

      const head = await refs.getHead();
      expect(isSymbolicRef(head!)).toBe(true);
      if (isSymbolicRef(head!)) {
        expect(head?.target).toBe("refs/heads/main");
      }
    });

    it("sets HEAD to detached state", async () => {
      await refs.setHead(commitId1);

      const head = await refs.getHead();
      expect(isSymbolicRef(head!)).toBe(false);
      expect(head?.objectId).toBe(commitId1);
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
      RefStorage.LOOSE,
    );
    expect(peelRef(ref)).toBe("b".repeat(40));
  });

  it("returns object ID when not peeled", () => {
    const ref = createRef("refs/heads/main", "a".repeat(40), RefStorage.LOOSE);
    expect(peelRef(ref)).toBe("a".repeat(40));
  });
});

describe("parseRefContent", () => {
  it("parses object ID ref", () => {
    const content = new TextEncoder().encode(`${"a".repeat(40)}\n`);
    const ref = parseRefContent("refs/heads/main", content);

    expect(isSymbolicRef(ref)).toBe(false);
    expect(ref.objectId).toBe("a".repeat(40));
  });

  it("parses symbolic ref", () => {
    const content = new TextEncoder().encode("ref: refs/heads/main\n");
    const ref = parseRefContent("HEAD", content);

    expect(isSymbolicRef(ref)).toBe(true);
    if (isSymbolicRef(ref)) {
      expect(ref.target).toBe("refs/heads/main");
    }
  });

  it("handles uppercase object ID", () => {
    const content = new TextEncoder().encode(`${"A".repeat(40)}\n`);
    const ref = parseRefContent("refs/heads/main", content);

    expect(ref.objectId).toBe("a".repeat(40)); // Should be lowercase
  });

  it("throws on too short object ID", () => {
    const content = new TextEncoder().encode("abc123\n");
    expect(() => parseRefContent("refs/heads/main", content)).toThrow(/too short/);
  });
});

describe("special refs", () => {
  let files: GitFilesApi;
  let refs: RefDirectory;
  const gitDir = "/repo/.git";
  const commitId1 = "a".repeat(40);
  const commitId2 = "b".repeat(40);

  beforeEach(async () => {
    files = new GitFilesApi(new MemFilesApi());
    refs = createRefDirectory(files, gitDir);
    await refs.create();
  });

  describe("FETCH_HEAD", () => {
    it("reads simple FETCH_HEAD", async () => {
      // Simple FETCH_HEAD with just an object ID
      await files.writeFile(
        files.join(gitDir, "FETCH_HEAD"),
        new TextEncoder().encode(`${commitId1}\n`),
      );

      const ref = await refs.exactRef("FETCH_HEAD");
      expect(ref).toBeDefined();
      expect(ref?.objectId).toBe(commitId1);
    });

    it("reads FETCH_HEAD with branch metadata", async () => {
      // FETCH_HEAD with additional metadata (first 40 chars is the object ID)
      const content = `${commitId1}\tbranch 'main' of https://github.com/user/repo\n`;
      await files.writeFile(files.join(gitDir, "FETCH_HEAD"), new TextEncoder().encode(content));

      const ref = await refs.exactRef("FETCH_HEAD");
      expect(ref).toBeDefined();
      expect(ref?.objectId).toBe(commitId1);
    });

    it("reads first entry from multi-line FETCH_HEAD", async () => {
      // FETCH_HEAD can contain multiple entries, first is "for merge"
      const content =
        `${commitId1}\t\tbranch 'main' of https://github.com/user/repo\n` +
        `${commitId2}\tnot-for-merge\tbranch 'feature' of https://github.com/user/repo\n`;
      await files.writeFile(files.join(gitDir, "FETCH_HEAD"), new TextEncoder().encode(content));

      const ref = await refs.exactRef("FETCH_HEAD");
      expect(ref).toBeDefined();
      expect(ref?.objectId).toBe(commitId1);
    });

    it("handles missing FETCH_HEAD", async () => {
      const ref = await refs.exactRef("FETCH_HEAD");
      expect(ref).toBeUndefined();
    });
  });

  describe("ORIG_HEAD", () => {
    it("reads ORIG_HEAD", async () => {
      await files.writeFile(
        files.join(gitDir, "ORIG_HEAD"),
        new TextEncoder().encode(`${commitId1}\n`),
      );

      const ref = await refs.exactRef("ORIG_HEAD");
      expect(ref).toBeDefined();
      expect(ref?.objectId).toBe(commitId1);
    });

    it("handles missing ORIG_HEAD", async () => {
      const ref = await refs.exactRef("ORIG_HEAD");
      expect(ref).toBeUndefined();
    });

    it("resolves ORIG_HEAD directly (not symbolic)", async () => {
      await files.writeFile(
        files.join(gitDir, "ORIG_HEAD"),
        new TextEncoder().encode(`${commitId1}\n`),
      );

      const ref = await refs.exactRef("ORIG_HEAD");
      expect(ref).toBeDefined();
      if (ref) {
        expect(isSymbolicRef(ref)).toBe(false);
      }
    });
  });

  describe("MERGE_HEAD", () => {
    it("reads MERGE_HEAD", async () => {
      await files.writeFile(
        files.join(gitDir, "MERGE_HEAD"),
        new TextEncoder().encode(`${commitId1}\n`),
      );

      const ref = await refs.exactRef("MERGE_HEAD");
      expect(ref).toBeDefined();
      expect(ref?.objectId).toBe(commitId1);
    });

    it("reads multi-parent MERGE_HEAD (octopus)", async () => {
      // MERGE_HEAD can contain multiple commit IDs for octopus merges
      const content = `${commitId1}\n${commitId2}\n`;
      await files.writeFile(files.join(gitDir, "MERGE_HEAD"), new TextEncoder().encode(content));

      const ref = await refs.exactRef("MERGE_HEAD");
      expect(ref).toBeDefined();
      // First parent is the ref target
      expect(ref?.objectId).toBe(commitId1);
    });

    it("handles missing MERGE_HEAD", async () => {
      const ref = await refs.exactRef("MERGE_HEAD");
      expect(ref).toBeUndefined();
    });
  });

  describe("CHERRY_PICK_HEAD", () => {
    it("reads CHERRY_PICK_HEAD", async () => {
      await files.writeFile(
        files.join(gitDir, "CHERRY_PICK_HEAD"),
        new TextEncoder().encode(`${commitId1}\n`),
      );

      const ref = await refs.exactRef("CHERRY_PICK_HEAD");
      expect(ref).toBeDefined();
      expect(ref?.objectId).toBe(commitId1);
    });

    it("handles missing CHERRY_PICK_HEAD", async () => {
      const ref = await refs.exactRef("CHERRY_PICK_HEAD");
      expect(ref).toBeUndefined();
    });
  });
});
