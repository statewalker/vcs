/**
 * Shared test suite for FileApi implementations
 *
 * Run this suite against any FileApi implementation to verify correctness.
 */

import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { FileApi } from "../../src/file-api/types.js";

/**
 * Shared test suite for FileApi implementations
 */
export function createFileApiTestSuite(
  name: string,
  factory: () => FileApi | Promise<FileApi>,
  cleanup?: () => Promise<void>,
): void {
  describe(`FileApi - ${name}`, () => {
    let files: FileApi;

    beforeEach(async () => {
      files = await factory();
    });

    afterEach(async () => {
      if (cleanup) await cleanup();
    });

    describe("readFile / writeFile", () => {
      it("writes and reads file content", async () => {
        const content = new TextEncoder().encode("Hello, World!");
        await files.mkdir("test");
        await files.writeFile("test/hello.txt", content);

        const read = await files.readFile("test/hello.txt");
        expect(read).toEqual(content);
      });

      it("overwrites existing file", async () => {
        await files.mkdir("test");
        await files.writeFile("test/file.txt", new Uint8Array([1, 2, 3]));
        await files.writeFile("test/file.txt", new Uint8Array([4, 5, 6]));

        const read = await files.readFile("test/file.txt");
        expect(read).toEqual(new Uint8Array([4, 5, 6]));
      });

      it("throws ENOENT for missing file", async () => {
        await expect(files.readFile("nonexistent.txt")).rejects.toThrow();
      });

      it("handles binary content correctly", async () => {
        const binary = new Uint8Array(256);
        for (let i = 0; i < 256; i++) binary[i] = i;

        await files.mkdir("test");
        await files.writeFile("test/binary.bin", binary);

        const read = await files.readFile("test/binary.bin");
        expect(read).toEqual(binary);
      });

      it("handles empty files", async () => {
        await files.mkdir("test");
        await files.writeFile("test/empty.txt", new Uint8Array(0));

        const read = await files.readFile("test/empty.txt");
        expect(read.length).toBe(0);
      });

      it("handles large files", { timeout: 30000 }, async () => {
        const large = new Uint8Array(1024 * 1024); // 1MB
        for (let i = 0; i < large.length; i++) large[i] = i % 256;

        await files.mkdir("test");
        await files.writeFile("test/large.bin", large);

        const read = await files.readFile("test/large.bin");
        expect(read).toEqual(large);
      });
    });

    describe("exists", () => {
      it("returns true for existing file", async () => {
        await files.mkdir("test");
        await files.writeFile("test/file.txt", new Uint8Array([1]));

        expect(await files.exists("test/file.txt")).toBe(true);
      });

      it("returns true for existing directory", async () => {
        await files.mkdir("test/subdir");

        expect(await files.exists("test/subdir")).toBe(true);
      });

      it("returns false for nonexistent path", async () => {
        expect(await files.exists("nonexistent")).toBe(false);
      });
    });

    describe("stat", () => {
      it("returns correct stats for file", async () => {
        const content = new Uint8Array([1, 2, 3, 4, 5]);
        await files.mkdir("test");
        await files.writeFile("test/file.txt", content);

        const stat = await files.stat("test/file.txt");
        expect(stat.isFile).toBe(true);
        expect(stat.isDirectory).toBe(false);
        expect(stat.size).toBe(5);
        expect(stat.mtime).toBeGreaterThan(0);
      });

      it("returns correct stats for directory", async () => {
        await files.mkdir("test/dir");

        const stat = await files.stat("test/dir");
        expect(stat.isFile).toBe(false);
        expect(stat.isDirectory).toBe(true);
      });

      it("throws ENOENT for missing path", async () => {
        await expect(files.stat("nonexistent")).rejects.toThrow();
      });
    });

    describe("mkdir", () => {
      it("creates directory", async () => {
        await files.mkdir("newdir");

        expect(await files.exists("newdir")).toBe(true);
        const stat = await files.stat("newdir");
        expect(stat.isDirectory).toBe(true);
      });

      it("creates nested directories", async () => {
        await files.mkdir("a/b/c/d");

        expect(await files.exists("a/b/c/d")).toBe(true);
      });

      it("succeeds if directory already exists", async () => {
        await files.mkdir("existing");
        await files.mkdir("existing"); // Should not throw
      });
    });

    describe("readdir", () => {
      it("lists directory contents", async () => {
        await files.mkdir("dir");
        await files.writeFile("dir/file1.txt", new Uint8Array([1]));
        await files.writeFile("dir/file2.txt", new Uint8Array([2]));
        await files.mkdir("dir/subdir");

        const entries = await files.readdir("dir");
        const names = entries.map((e) => e.name).sort();

        expect(names).toEqual(["file1.txt", "file2.txt", "subdir"]);
      });

      it("indicates file vs directory correctly", async () => {
        await files.mkdir("dir/subdir");
        await files.writeFile("dir/file.txt", new Uint8Array([1]));

        const entries = await files.readdir("dir");
        const file = entries.find((e) => e.name === "file.txt");
        const subdir = entries.find((e) => e.name === "subdir");

        expect(file?.isFile).toBe(true);
        expect(file?.isDirectory).toBe(false);
        expect(subdir?.isFile).toBe(false);
        expect(subdir?.isDirectory).toBe(true);
      });

      it("returns empty array for empty directory", async () => {
        await files.mkdir("empty");

        const entries = await files.readdir("empty");
        expect(entries).toEqual([]);
      });
    });

    describe("rename", () => {
      it("renames file", async () => {
        await files.mkdir("test");
        await files.writeFile("test/old.txt", new Uint8Array([1, 2, 3]));

        await files.rename("test/old.txt", "test/new.txt");

        expect(await files.exists("test/old.txt")).toBe(false);
        expect(await files.exists("test/new.txt")).toBe(true);

        const content = await files.readFile("test/new.txt");
        expect(content).toEqual(new Uint8Array([1, 2, 3]));
      });

      it("moves file to different directory", async () => {
        await files.mkdir("src");
        await files.mkdir("dst");
        await files.writeFile("src/file.txt", new Uint8Array([1, 2, 3]));

        await files.rename("src/file.txt", "dst/file.txt");

        expect(await files.exists("src/file.txt")).toBe(false);
        expect(await files.exists("dst/file.txt")).toBe(true);
      });

      it("throws for missing source", async () => {
        await expect(
          files.rename("nonexistent.txt", "new.txt"),
        ).rejects.toThrow();
      });
    });

    describe("unlink", () => {
      it("deletes file", async () => {
        await files.mkdir("test");
        await files.writeFile("test/file.txt", new Uint8Array([1]));

        const result = await files.unlink("test/file.txt");
        expect(result).toBe(true);
        expect(await files.exists("test/file.txt")).toBe(false);
      });

      it("returns false for nonexistent file", async () => {
        const result = await files.unlink("nonexistent.txt");
        expect(result).toBe(false);
      });
    });

    describe("rmdir", () => {
      it("deletes empty directory", async () => {
        await files.mkdir("test/empty");

        const result = await files.rmdir("test/empty");
        expect(result).toBe(true);
        expect(await files.exists("test/empty")).toBe(false);
      });

      it("deletes directory with contents", async () => {
        await files.mkdir("test/dir");
        await files.writeFile("test/dir/file.txt", new Uint8Array([1]));
        await files.mkdir("test/dir/subdir");

        const result = await files.rmdir("test/dir");
        expect(result).toBe(true);
        expect(await files.exists("test/dir")).toBe(false);
      });

      it("returns false for nonexistent directory", async () => {
        const result = await files.rmdir("nonexistent");
        expect(result).toBe(false);
      });
    });

    describe("openFile / FileHandle", () => {
      it("reads at specific offset", async () => {
        await files.mkdir("test");
        await files.writeFile("test/data.bin", new Uint8Array([0, 1, 2, 3, 4, 5, 6, 7, 8, 9]));

        const handle = await files.openFile("test/data.bin");
        try {
          const buffer = new Uint8Array(4);
          const bytesRead = await handle.read(buffer, 0, 4, 3);

          expect(bytesRead).toBe(4);
          expect(buffer).toEqual(new Uint8Array([3, 4, 5, 6]));
        } finally {
          await handle.close();
        }
      });

      it("reads at multiple offsets", async () => {
        await files.mkdir("test");
        await files.writeFile("test/data.bin", new Uint8Array([0, 1, 2, 3, 4, 5, 6, 7, 8, 9]));

        const handle = await files.openFile("test/data.bin");
        try {
          const buffer1 = new Uint8Array(2);
          const buffer2 = new Uint8Array(3);

          await handle.read(buffer1, 0, 2, 0);
          await handle.read(buffer2, 0, 3, 7);

          expect(buffer1).toEqual(new Uint8Array([0, 1]));
          expect(buffer2).toEqual(new Uint8Array([7, 8, 9]));
        } finally {
          await handle.close();
        }
      });

      it("returns 0 when reading past end of file", async () => {
        await files.mkdir("test");
        await files.writeFile("test/data.bin", new Uint8Array([0, 1, 2]));

        const handle = await files.openFile("test/data.bin");
        try {
          const buffer = new Uint8Array(4);
          const bytesRead = await handle.read(buffer, 0, 4, 10);
          expect(bytesRead).toBe(0);
        } finally {
          await handle.close();
        }
      });

      it("returns partial read at end of file", async () => {
        await files.mkdir("test");
        await files.writeFile("test/data.bin", new Uint8Array([0, 1, 2, 3, 4]));

        const handle = await files.openFile("test/data.bin");
        try {
          const buffer = new Uint8Array(10);
          const bytesRead = await handle.read(buffer, 0, 10, 3);

          expect(bytesRead).toBe(2);
          expect(buffer.subarray(0, 2)).toEqual(new Uint8Array([3, 4]));
        } finally {
          await handle.close();
        }
      });
    });

    describe("path operations", () => {
      it("join combines path segments", () => {
        expect(files.join("a", "b", "c")).toContain("a");
        expect(files.join("a", "b", "c")).toContain("b");
        expect(files.join("a", "b", "c")).toContain("c");
      });

      it("dirname returns parent directory", () => {
        expect(files.dirname("a/b/c")).toContain("a");
        expect(files.dirname("a/b/c")).toContain("b");
        expect(files.dirname("a/b/c")).not.toContain("c");
      });

      it("basename returns file name", () => {
        expect(files.basename("a/b/c.txt")).toBe("c.txt");
        expect(files.basename("single.txt")).toBe("single.txt");
      });
    });
  });
}
