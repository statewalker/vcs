/**
 * Integration tests for FileTreeIterator.
 *
 * Tests working tree iteration, gitignore integration, and content hashing.
 */

import { beforeEach, describe, expect, it } from "vitest";
import { FileTreeIterator, createFileTreeIterator } from "../src/file-tree-iterator.js";
import { createIgnoreManager } from "../src/ignore/ignore-manager.js";
import { FileMode } from "@webrun-vcs/vcs";

/**
 * Mock file system structure for testing.
 */
interface MockFile {
  kind: "file";
  content: Uint8Array;
  lastModified?: number;
}

interface MockDirectory {
  kind: "directory";
  children: Map<string, MockFile | MockDirectory>;
}

type MockEntry = MockFile | MockDirectory;

/**
 * Create a mock FilesApi for testing.
 */
function createMockFilesApi(root: MockDirectory) {
  const textEncoder = new TextEncoder();

  function getEntry(path: string): MockEntry | undefined {
    if (path === "" || path === "/") {
      return root;
    }

    const parts = path.split("/").filter((p) => p !== "");
    let current: MockEntry = root;

    for (const part of parts) {
      if (current.kind !== "directory") {
        return undefined;
      }
      const child = current.children.get(part);
      if (!child) {
        return undefined;
      }
      current = child;
    }

    return current;
  }

  return {
    async exists(path: string): Promise<boolean> {
      return getEntry(path) !== undefined;
    },

    async *list(path: string): AsyncIterable<{ name: string; kind: "file" | "directory" }> {
      const entry = getEntry(path);
      if (!entry || entry.kind !== "directory") {
        throw new Error(`Not a directory: ${path}`);
      }

      for (const [name, child] of entry.children) {
        yield { name, kind: child.kind };
      }
    },

    async readFile(path: string): Promise<Uint8Array> {
      const entry = getEntry(path);
      if (!entry) {
        throw new Error(`File not found: ${path}`);
      }
      if (entry.kind !== "file") {
        throw new Error(`Not a file: ${path}`);
      }
      return entry.content;
    },

    async stats(path: string): Promise<{ size?: number; lastModified?: number } | null> {
      const entry = getEntry(path);
      if (!entry) {
        return null;
      }
      if (entry.kind === "file") {
        return {
          size: entry.content.length,
          lastModified: entry.lastModified ?? Date.now(),
        };
      }
      return { size: 0, lastModified: Date.now() };
    },

    // Required stub methods
    async write(_path: string, _chunks: Iterable<Uint8Array>): Promise<void> {},
    async mkdir(_path: string): Promise<void> {},
    async remove(_path: string): Promise<boolean> {
      return false;
    },
    async move(_from: string, _to: string): Promise<void> {},
  };
}

/**
 * Helper to create a mock file with text content.
 */
function mockFile(content: string, lastModified?: number): MockFile {
  return {
    kind: "file",
    content: new TextEncoder().encode(content),
    lastModified,
  };
}

/**
 * Helper to create a mock directory.
 */
function mockDir(entries: Record<string, MockEntry>): MockDirectory {
  return {
    kind: "directory",
    children: new Map(Object.entries(entries)),
  };
}

describe("FileTreeIterator", () => {
  describe("walk", () => {
    it("should iterate over all files in a directory", async () => {
      const root = mockDir({
        "file1.txt": mockFile("Hello"),
        "file2.js": mockFile("console.log()"),
        subdir: mockDir({
          "nested.ts": mockFile("export const x = 1"),
        }),
      });

      const files = createMockFilesApi(root);
      const iterator = createFileTreeIterator({
        files: files as any,
        rootPath: "",
        autoLoadGitignore: false,
      });

      const entries: string[] = [];
      for await (const entry of iterator.walk()) {
        entries.push(entry.path);
      }

      expect(entries).toContain("file1.txt");
      expect(entries).toContain("file2.js");
      expect(entries).toContain("subdir/nested.ts");
      expect(entries).toHaveLength(3);
    });

    it("should include directories when requested", async () => {
      const root = mockDir({
        "file1.txt": mockFile("Hello"),
        subdir: mockDir({
          "nested.ts": mockFile("export const x = 1"),
        }),
      });

      const files = createMockFilesApi(root);
      const iterator = createFileTreeIterator({
        files: files as any,
        rootPath: "",
        autoLoadGitignore: false,
      });

      const entries: string[] = [];
      for await (const entry of iterator.walk({ includeDirectories: true })) {
        entries.push(entry.path);
      }

      expect(entries).toContain("file1.txt");
      expect(entries).toContain("subdir");
      expect(entries).toContain("subdir/nested.ts");
      expect(entries).toHaveLength(3);
    });

    it("should skip .git directory", async () => {
      const root = mockDir({
        "file1.txt": mockFile("Hello"),
        ".git": mockDir({
          HEAD: mockFile("ref: refs/heads/main"),
          config: mockFile("[core]"),
        }),
      });

      const files = createMockFilesApi(root);
      const iterator = createFileTreeIterator({
        files: files as any,
        rootPath: "",
        autoLoadGitignore: false,
      });

      const entries: string[] = [];
      for await (const entry of iterator.walk({ includeDirectories: true })) {
        entries.push(entry.path);
      }

      expect(entries).toContain("file1.txt");
      expect(entries).not.toContain(".git");
      expect(entries).not.toContain(".git/HEAD");
      expect(entries).toHaveLength(1);
    });

    it("should filter by path prefix", async () => {
      const root = mockDir({
        src: mockDir({
          "main.ts": mockFile("main"),
          lib: mockDir({
            "utils.ts": mockFile("utils"),
          }),
        }),
        test: mockDir({
          "main.test.ts": mockFile("test"),
        }),
      });

      const files = createMockFilesApi(root);
      const iterator = createFileTreeIterator({
        files: files as any,
        rootPath: "",
        autoLoadGitignore: false,
      });

      const entries: string[] = [];
      for await (const entry of iterator.walk({ pathPrefix: "src" })) {
        entries.push(entry.path);
      }

      expect(entries).toContain("src/main.ts");
      expect(entries).toContain("src/lib/utils.ts");
      expect(entries).not.toContain("test/main.test.ts");
      expect(entries).toHaveLength(2);
    });

    it("should sort entries by name", async () => {
      const root = mockDir({
        "zebra.txt": mockFile("z"),
        "alpha.txt": mockFile("a"),
        "beta.txt": mockFile("b"),
      });

      const files = createMockFilesApi(root);
      const iterator = createFileTreeIterator({
        files: files as any,
        rootPath: "",
        autoLoadGitignore: false,
      });

      const entries: string[] = [];
      for await (const entry of iterator.walk()) {
        entries.push(entry.path);
      }

      expect(entries).toEqual(["alpha.txt", "beta.txt", "zebra.txt"]);
    });
  });

  describe("gitignore integration", () => {
    it("should skip ignored files", async () => {
      const root = mockDir({
        "file.txt": mockFile("Hello"),
        "file.log": mockFile("Log entry"),
        ".gitignore": mockFile("*.log"),
      });

      const files = createMockFilesApi(root);
      const iterator = createFileTreeIterator({
        files: files as any,
        rootPath: "",
        autoLoadGitignore: true,
      });

      const entries: string[] = [];
      for await (const entry of iterator.walk()) {
        entries.push(entry.path);
      }

      expect(entries).toContain("file.txt");
      expect(entries).toContain(".gitignore");
      expect(entries).not.toContain("file.log");
    });

    it("should include ignored files when requested", async () => {
      const root = mockDir({
        "file.txt": mockFile("Hello"),
        "file.log": mockFile("Log entry"),
        ".gitignore": mockFile("*.log"),
      });

      const files = createMockFilesApi(root);
      const iterator = createFileTreeIterator({
        files: files as any,
        rootPath: "",
        autoLoadGitignore: true,
      });

      const entries: string[] = [];
      for await (const entry of iterator.walk({ includeIgnored: true })) {
        entries.push(entry.path);
      }

      expect(entries).toContain("file.txt");
      expect(entries).toContain(".gitignore");
      expect(entries).toContain("file.log");
    });

    it("should mark ignored entries correctly", async () => {
      const root = mockDir({
        "file.txt": mockFile("Hello"),
        "file.log": mockFile("Log entry"),
        ".gitignore": mockFile("*.log"),
      });

      const files = createMockFilesApi(root);
      const iterator = createFileTreeIterator({
        files: files as any,
        rootPath: "",
        autoLoadGitignore: true,
      });

      const entries: { path: string; isIgnored: boolean }[] = [];
      for await (const entry of iterator.walk({ includeIgnored: true })) {
        entries.push({ path: entry.path, isIgnored: entry.isIgnored });
      }

      const fileTxt = entries.find((e) => e.path === "file.txt");
      const fileLog = entries.find((e) => e.path === "file.log");

      expect(fileTxt?.isIgnored).toBe(false);
      expect(fileLog?.isIgnored).toBe(true);
    });

    it("should respect directory-level gitignore", async () => {
      const root = mockDir({
        src: mockDir({
          "main.ts": mockFile("main"),
          "main.bak": mockFile("backup"),
          ".gitignore": mockFile("*.bak"),
        }),
        "root.bak": mockFile("root backup"),
      });

      const files = createMockFilesApi(root);
      const iterator = createFileTreeIterator({
        files: files as any,
        rootPath: "",
        autoLoadGitignore: true,
      });

      const entries: string[] = [];
      for await (const entry of iterator.walk()) {
        entries.push(entry.path);
      }

      expect(entries).toContain("src/main.ts");
      expect(entries).toContain("src/.gitignore");
      expect(entries).toContain("root.bak"); // Not ignored at root level
      expect(entries).not.toContain("src/main.bak"); // Ignored in src/
    });

    it("should respect negation patterns", async () => {
      const root = mockDir({
        "file1.log": mockFile("log1"),
        "file2.log": mockFile("log2"),
        "important.log": mockFile("important"),
        ".gitignore": mockFile("*.log\n!important.log"),
      });

      const files = createMockFilesApi(root);
      const iterator = createFileTreeIterator({
        files: files as any,
        rootPath: "",
        autoLoadGitignore: true,
      });

      const entries: string[] = [];
      for await (const entry of iterator.walk()) {
        entries.push(entry.path);
      }

      expect(entries).toContain(".gitignore");
      expect(entries).toContain("important.log"); // Un-ignored
      expect(entries).not.toContain("file1.log");
      expect(entries).not.toContain("file2.log");
    });

    it("should support custom ignore patterns", async () => {
      const root = mockDir({
        "file.txt": mockFile("Hello"),
        "file.tmp": mockFile("Temp"),
      });

      const files = createMockFilesApi(root);
      const iterator = createFileTreeIterator({
        files: files as any,
        rootPath: "",
        autoLoadGitignore: false,
      });

      const entries: string[] = [];
      for await (const entry of iterator.walk({ ignorePatterns: ["*.tmp"] })) {
        entries.push(entry.path);
      }

      expect(entries).toContain("file.txt");
      expect(entries).not.toContain("file.tmp");
    });
  });

  describe("entry properties", () => {
    it("should return correct file mode for regular files", async () => {
      const root = mockDir({
        "file.txt": mockFile("Hello"),
      });

      const files = createMockFilesApi(root);
      const iterator = createFileTreeIterator({
        files: files as any,
        rootPath: "",
        autoLoadGitignore: false,
      });

      const entries: { path: string; mode: number }[] = [];
      for await (const entry of iterator.walk()) {
        entries.push({ path: entry.path, mode: entry.mode });
      }

      const file = entries.find((e) => e.path === "file.txt");
      expect(file?.mode).toBe(FileMode.REGULAR_FILE);
    });

    it("should return correct file mode for directories", async () => {
      const root = mockDir({
        subdir: mockDir({
          "file.txt": mockFile("Hello"),
        }),
      });

      const files = createMockFilesApi(root);
      const iterator = createFileTreeIterator({
        files: files as any,
        rootPath: "",
        autoLoadGitignore: false,
      });

      const entries: { path: string; mode: number }[] = [];
      for await (const entry of iterator.walk({ includeDirectories: true })) {
        entries.push({ path: entry.path, mode: entry.mode });
      }

      const dir = entries.find((e) => e.path === "subdir");
      expect(dir?.mode).toBe(FileMode.TREE);
    });

    it("should detect gitlinks (submodules)", async () => {
      const root = mockDir({
        submodule: mockDir({
          ".git": mockDir({}), // Submodule has .git directory
          "file.txt": mockFile("Hello"),
        }),
      });

      const files = createMockFilesApi(root);
      const iterator = createFileTreeIterator({
        files: files as any,
        rootPath: "",
        autoLoadGitignore: false,
      });

      const entries: { path: string; mode: number }[] = [];
      for await (const entry of iterator.walk({ includeDirectories: true })) {
        entries.push({ path: entry.path, mode: entry.mode });
      }

      const submodule = entries.find((e) => e.path === "submodule");
      expect(submodule?.mode).toBe(FileMode.GITLINK);
      // Gitlinks should not be recursed into
      expect(entries.find((e) => e.path === "submodule/file.txt")).toBeUndefined();
    });

    it("should return correct size for files", async () => {
      const content = "Hello, World!";
      const root = mockDir({
        "file.txt": mockFile(content),
      });

      const files = createMockFilesApi(root);
      const iterator = createFileTreeIterator({
        files: files as any,
        rootPath: "",
        autoLoadGitignore: false,
      });

      const entries: { path: string; size: number }[] = [];
      for await (const entry of iterator.walk()) {
        entries.push({ path: entry.path, size: entry.size });
      }

      const file = entries.find((e) => e.path === "file.txt");
      expect(file?.size).toBe(new TextEncoder().encode(content).length);
    });
  });

  describe("getEntry", () => {
    it("should return entry for existing file", async () => {
      const root = mockDir({
        "file.txt": mockFile("Hello"),
      });

      const files = createMockFilesApi(root);
      const iterator = createFileTreeIterator({
        files: files as any,
        rootPath: "",
        autoLoadGitignore: false,
      });

      const entry = await iterator.getEntry("file.txt");

      expect(entry).toBeDefined();
      expect(entry?.path).toBe("file.txt");
      expect(entry?.name).toBe("file.txt");
      expect(entry?.isDirectory).toBe(false);
    });

    it("should return undefined for non-existing file", async () => {
      const root = mockDir({
        "file.txt": mockFile("Hello"),
      });

      const files = createMockFilesApi(root);
      const iterator = createFileTreeIterator({
        files: files as any,
        rootPath: "",
        autoLoadGitignore: false,
      });

      const entry = await iterator.getEntry("nonexistent.txt");
      expect(entry).toBeUndefined();
    });

    it("should return entry for nested file", async () => {
      const root = mockDir({
        src: mockDir({
          lib: mockDir({
            "utils.ts": mockFile("export const x = 1"),
          }),
        }),
      });

      const files = createMockFilesApi(root);
      const iterator = createFileTreeIterator({
        files: files as any,
        rootPath: "",
        autoLoadGitignore: false,
      });

      const entry = await iterator.getEntry("src/lib/utils.ts");

      expect(entry).toBeDefined();
      expect(entry?.path).toBe("src/lib/utils.ts");
      expect(entry?.name).toBe("utils.ts");
    });
  });

  describe("computeHash", () => {
    it("should compute Git blob hash for file content", async () => {
      // Test with known content and expected hash
      // Git hash = SHA1("blob <size>\0<content>")
      const content = "Hello, World!";
      const root = mockDir({
        "file.txt": mockFile(content),
      });

      const files = createMockFilesApi(root);
      const iterator = createFileTreeIterator({
        files: files as any,
        rootPath: "",
        autoLoadGitignore: false,
      });

      const hash = await iterator.computeHash("file.txt");

      // Verify hash is a 40-character hex string (SHA-1)
      expect(hash).toMatch(/^[0-9a-f]{40}$/);

      // The expected Git blob hash for "Hello, World!" can be computed with:
      // echo -n "Hello, World!" | git hash-object --stdin
      // = b45ef6fec89518d314f546fd6c3025367b721684
      expect(hash).toBe("b45ef6fec89518d314f546fd6c3025367b721684");
    });

    it("should compute different hashes for different content", async () => {
      const root = mockDir({
        "file1.txt": mockFile("Content A"),
        "file2.txt": mockFile("Content B"),
      });

      const files = createMockFilesApi(root);
      const iterator = createFileTreeIterator({
        files: files as any,
        rootPath: "",
        autoLoadGitignore: false,
      });

      const hash1 = await iterator.computeHash("file1.txt");
      const hash2 = await iterator.computeHash("file2.txt");

      expect(hash1).not.toBe(hash2);
    });

    it("should compute same hash for same content", async () => {
      const root = mockDir({
        "file1.txt": mockFile("Same content"),
        "file2.txt": mockFile("Same content"),
      });

      const files = createMockFilesApi(root);
      const iterator = createFileTreeIterator({
        files: files as any,
        rootPath: "",
        autoLoadGitignore: false,
      });

      const hash1 = await iterator.computeHash("file1.txt");
      const hash2 = await iterator.computeHash("file2.txt");

      expect(hash1).toBe(hash2);
    });
  });

  describe("readContent", () => {
    it("should read file content as stream", async () => {
      const content = "Hello, World!";
      const root = mockDir({
        "file.txt": mockFile(content),
      });

      const files = createMockFilesApi(root);
      const iterator = createFileTreeIterator({
        files: files as any,
        rootPath: "",
        autoLoadGitignore: false,
      });

      const chunks: Uint8Array[] = [];
      for await (const chunk of iterator.readContent("file.txt")) {
        chunks.push(chunk);
      }

      const fullContent = new TextDecoder().decode(
        chunks.reduce((acc, chunk) => {
          const combined = new Uint8Array(acc.length + chunk.length);
          combined.set(acc);
          combined.set(chunk, acc.length);
          return combined;
        }, new Uint8Array(0)),
      );

      expect(fullContent).toBe(content);
    });
  });

  describe("custom IgnoreManager", () => {
    it("should use provided IgnoreManager", async () => {
      const root = mockDir({
        "file.txt": mockFile("Hello"),
        "ignored.txt": mockFile("Should be ignored"),
      });

      const files = createMockFilesApi(root);
      const ignoreManager = createIgnoreManager();
      ignoreManager.addGlobalPatterns(["ignored.txt"]);

      const iterator = createFileTreeIterator({
        files: files as any,
        rootPath: "",
        ignoreManager,
        autoLoadGitignore: false,
      });

      const entries: string[] = [];
      for await (const entry of iterator.walk()) {
        entries.push(entry.path);
      }

      expect(entries).toContain("file.txt");
      expect(entries).not.toContain("ignored.txt");
    });
  });
});
