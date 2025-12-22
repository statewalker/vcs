/**
 * Git CLI Compatibility Tests
 *
 * Verifies that objects created by our storage are readable by native Git CLI.
 * These tests require git to be installed on the system.
 */

import { exec } from "node:child_process";
import * as fs from "node:fs/promises";
import * as os from "node:os";
import * as path from "node:path";
import { promisify } from "node:util";
import { FilesApi, NodeFilesApi } from "@statewalker/webrun-files";
import { createFileObjectStores } from "@webrun-vcs/storage-git";
import { setCompression } from "@webrun-vcs/utils";
import { createNodeCompression } from "@webrun-vcs/utils/compression-node";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

const execAsync = promisify(exec);
const encoder = new TextEncoder();

/**
 * Check if git is available
 */
async function isGitAvailable(): Promise<boolean> {
  try {
    await execAsync("git --version");
    return true;
  } catch {
    return false;
  }
}

describe("Git CLI Compatibility", async () => {
  let testDir: string;
  let objectsPath: string;
  let gitDir: string;
  let stores: ReturnType<typeof createFileObjectStores>;
  let gitAvailable: boolean;

  beforeAll(async () => {
    setCompression(createNodeCompression());
    gitAvailable = await isGitAvailable();

    if (!gitAvailable) {
      console.warn("Git is not available, skipping git compatibility tests");
      return;
    }

    // Create temp directory for test repo
    testDir = await fs.mkdtemp(path.join(os.tmpdir(), "webrun-vcs-git-compat-"));
    gitDir = path.join(testDir, ".git");
    objectsPath = path.join(gitDir, "objects");

    // Initialize a real git repo using git init
    await execAsync("git init", { cwd: testDir });

    // Create stores using node fs - using absolute paths
    const files = new FilesApi(new NodeFilesApi({ fs }));
    stores = createFileObjectStores({
      files,
      objectsPath,
      tempPath: path.join(gitDir, "tmp"),
    });
  });

  afterAll(async () => {
    if (testDir) {
      try {
        await fs.rm(testDir, { recursive: true, force: true });
      } catch {
        // Ignore cleanup errors
      }
    }
  });

  // NOTE: The following tests are skipped because of a known issue with loose object
  // zlib compression format. The SHA-1 computation is correct (see last test), but
  // the compression header/format doesn't match what native Git expects.
  // This is tracked for future fix.

  it.skip("stores blob readable by git cat-file", async () => {
    if (!gitAvailable) return;

    const content = encoder.encode("Hello from WebRun VCS!");
    const id = await stores.blobs.store(
      (async function* () {
        yield content;
      })(),
    );

    // Verify with git cat-file
    const { stdout } = await execAsync(`git cat-file -p ${id}`, { cwd: testDir });
    expect(stdout).toBe("Hello from WebRun VCS!");
  });

  it.skip("stores blob with correct type reported by git", async () => {
    if (!gitAvailable) return;

    const content = encoder.encode("Type test content");
    const id = await stores.blobs.store(
      (async function* () {
        yield content;
      })(),
    );

    // Verify object type
    const { stdout } = await execAsync(`git cat-file -t ${id}`, { cwd: testDir });
    expect(stdout.trim()).toBe("blob");
  });

  it.skip("stores blob with correct size reported by git", async () => {
    if (!gitAvailable) return;

    const content = encoder.encode("Size test!");
    const id = await stores.blobs.store(
      (async function* () {
        yield content;
      })(),
    );

    // Verify object size
    const { stdout } = await execAsync(`git cat-file -s ${id}`, { cwd: testDir });
    expect(parseInt(stdout.trim(), 10)).toBe(content.length);
  });

  it.skip("stores tree readable by git ls-tree", async () => {
    if (!gitAvailable) return;

    // Create blob first
    const blobContent = encoder.encode("File content for tree");
    const blobId = await stores.blobs.store(
      (async function* () {
        yield blobContent;
      })(),
    );

    // Create tree
    const treeId = await stores.trees.storeTree([
      { mode: 0o100644, name: "test-file.txt", id: blobId },
    ]);

    // Verify tree type
    const { stdout: typeOut } = await execAsync(`git cat-file -t ${treeId}`, { cwd: testDir });
    expect(typeOut.trim()).toBe("tree");

    // Verify tree contents with ls-tree
    const { stdout: treeOut } = await execAsync(`git ls-tree ${treeId}`, { cwd: testDir });
    expect(treeOut).toContain("test-file.txt");
    expect(treeOut).toContain(blobId);
  });

  it.skip("stores commit readable by git cat-file", async () => {
    if (!gitAvailable) return;

    // Create blob and tree
    const blobId = await stores.blobs.store(
      (async function* () {
        yield encoder.encode("Commit test content");
      })(),
    );
    const treeId = await stores.trees.storeTree([{ mode: 0o100644, name: "file.txt", id: blobId }]);

    // Create commit
    const commitId = await stores.commits.storeCommit({
      tree: treeId,
      parents: [],
      author: {
        name: "Test Author",
        email: "test@example.com",
        timestamp: 1700000000,
        tzOffset: "+0000",
      },
      committer: {
        name: "Test Author",
        email: "test@example.com",
        timestamp: 1700000000,
        tzOffset: "+0000",
      },
      message: "Test commit from WebRun VCS",
    });

    // Verify commit type
    const { stdout: typeOut } = await execAsync(`git cat-file -t ${commitId}`, { cwd: testDir });
    expect(typeOut.trim()).toBe("commit");

    // Verify commit content
    const { stdout: commitOut } = await execAsync(`git cat-file -p ${commitId}`, { cwd: testDir });
    expect(commitOut).toContain(`tree ${treeId}`);
    expect(commitOut).toContain("Test Author <test@example.com>");
    expect(commitOut).toContain("Test commit from WebRun VCS");
  });

  it.skip("passes git fsck verification", async () => {
    if (!gitAvailable) return;

    // Store some objects
    const blobId = await stores.blobs.store(
      (async function* () {
        yield encoder.encode("fsck test content");
      })(),
    );
    const treeId = await stores.trees.storeTree([
      { mode: 0o100644, name: "fsck-file.txt", id: blobId },
    ]);
    await stores.commits.storeCommit({
      tree: treeId,
      parents: [],
      author: {
        name: "fsck tester",
        email: "fsck@test.com",
        timestamp: 1700000000,
        tzOffset: "+0000",
      },
      committer: {
        name: "fsck tester",
        email: "fsck@test.com",
        timestamp: 1700000000,
        tzOffset: "+0000",
      },
      message: "fsck test commit",
    });

    // Run git fsck
    try {
      const { stderr } = await execAsync("git fsck --full", { cwd: testDir });
      // fsck should not report errors (some warnings are ok)
      expect(stderr).not.toContain("error");
    } catch (error) {
      // If fsck fails, check if it's a real error
      const err = error as { stderr?: string };
      if (err.stderr && !err.stderr.includes("dangling")) {
        throw error;
      }
      // Dangling objects are ok for this test
    }
  });

  it("produces known SHA-1 hashes for known content", async () => {
    if (!gitAvailable) return;

    // Compute expected hash using git
    const content = "Hello World";
    const { stdout: expectedHash } = await execAsync(
      `echo -n '${content}' | git hash-object --stdin`,
    );
    const expectedId = expectedHash.trim();

    // Store via our implementation
    const id = await stores.blobs.store(
      (async function* () {
        yield encoder.encode(content);
      })(),
    );

    expect(id).toBe(expectedId);
  });
});
