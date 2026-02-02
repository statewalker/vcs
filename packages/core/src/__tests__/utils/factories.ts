import type { Blob } from "../../history/blobs/types.js";
import type { Commit, Person } from "../../history/commits/types.js";
import type { History } from "../../history/history.js";
import type { Tag } from "../../history/tags/types.js";
import type { Tree, TreeEntry } from "../../history/trees/types.js";

/**
 * Create a test blob with optional customization.
 */
export function createTestBlob(options?: { content?: string | Uint8Array; size?: number }): Blob {
  if (options?.content) {
    const content =
      typeof options.content === "string"
        ? new TextEncoder().encode(options.content)
        : options.content;
    return { content };
  }
  if (options?.size) {
    return { content: new Uint8Array(options.size).fill(0x41) };
  }
  return { content: new TextEncoder().encode(`Test blob ${Date.now()}`) };
}

/**
 * Create a test tree with optional entries.
 */
export function createTestTree(options?: { entries?: TreeEntry[]; fileCount?: number }): Tree {
  if (options?.entries) {
    return { entries: options.entries };
  }
  if (options?.fileCount) {
    const entries: TreeEntry[] = [];
    for (let i = 0; i < options.fileCount; i++) {
      entries.push({
        mode: "100644",
        name: `file-${i}.txt`,
        hash: "0".repeat(40),
      });
    }
    return { entries };
  }
  return {
    entries: [{ mode: "100644", name: "test.txt", hash: "0".repeat(40) }],
  };
}

/**
 * Create a test person (author/committer).
 */
export function createTestPerson(options?: {
  name?: string;
  email?: string;
  timestamp?: number;
  timezone?: string;
}): Person {
  return {
    name: options?.name ?? "Test Author",
    email: options?.email ?? "test@example.com",
    timestamp: options?.timestamp ?? Math.floor(Date.now() / 1000),
    timezone: options?.timezone ?? "+0000",
  };
}

/**
 * Create a test commit with optional customization.
 */
export function createTestCommit(options?: {
  tree?: string;
  parents?: string[];
  author?: Person;
  committer?: Person;
  message?: string;
}): Commit {
  return {
    tree: options?.tree ?? "0".repeat(40),
    parents: options?.parents ?? [],
    author: options?.author ?? createTestPerson(),
    committer: options?.committer ?? options?.author ?? createTestPerson(),
    message: options?.message ?? "Test commit",
  };
}

/**
 * Create a test tag with optional customization.
 */
export function createTestTag(options?: {
  object?: string;
  type?: string;
  tag?: string;
  tagger?: Person;
  message?: string;
}): Tag {
  return {
    object: options?.object ?? "0".repeat(40),
    type: options?.type ?? "commit",
    tag: options?.tag ?? "v1.0.0",
    tagger: options?.tagger ?? createTestPerson(),
    message: options?.message ?? "Release",
  };
}

/**
 * Create a complete commit chain in a history store.
 */
export async function createCommitChain(
  history: History,
  length: number,
  options?: {
    startingParent?: string;
    fileChanges?: boolean;
  },
): Promise<string[]> {
  const commits: string[] = [];
  let parent = options?.startingParent;

  for (let i = 0; i < length; i++) {
    const blobId = await history.blobs.store(createTestBlob({ content: `Content ${i}` }));
    const treeId = await history.trees.store({
      entries: [{ mode: "100644", name: "file.txt", hash: blobId }],
    });
    const commitId = await history.commits.store({
      tree: treeId,
      parents: parent ? [parent] : [],
      author: createTestPerson({ timestamp: 1700000000 + i * 1000 }),
      committer: createTestPerson({ timestamp: 1700000000 + i * 1000 }),
      message: `Commit ${i}`,
    });
    commits.push(commitId);
    parent = commitId;
  }

  return commits;
}

/**
 * Create a branching history structure.
 */
export async function createBranchingHistory(
  history: History,
  spec: {
    base: number; // Commits before branch
    branches: Array<{
      name: string;
      commits: number;
    }>;
  },
): Promise<{
  base: string[];
  branches: Record<string, string[]>;
}> {
  // Create base commits
  const base = await createCommitChain(history, spec.base);

  // Create branches from last base commit
  const branches: Record<string, string[]> = {};
  const branchPoint = base[base.length - 1];

  for (const branch of spec.branches) {
    branches[branch.name] = await createCommitChain(history, branch.commits, {
      startingParent: branchPoint,
    });
  }

  return { base, branches };
}
