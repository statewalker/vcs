/**
 * Tests for Git refs handling
 */

import { FilesApi, joinPath, MemFilesApi } from "@statewalker/webrun-files";
import type { ObjectId } from "@webrun-vcs/vcs";
import { beforeEach, describe, expect, it } from "vitest";
import { GitRefStorage } from "../../src/git-ref-storage.js";
import {
  findPackedRef,
  parsePackedRefs,
  readPackedRefs,
} from "../../src/refs/packed-refs-reader.js";
import {
  addPackedRef,
  formatPackedRefs,
  removePackedRef,
  writePackedRefs,
} from "../../src/refs/packed-refs-writer.js";
import { isValidRefName, shortenRefName } from "../../src/refs/ref-directory.js";
import { parseRefContent, readAllRefs, readRef, resolveRef } from "../../src/refs/ref-reader.js";
import {
  createPeeledRef,
  createPeeledTagRef,
  createRef,
  createSymbolicRef,
  isSymbolicRef,
  type Ref,
  RefStore,
  type SymbolicRef,
} from "../../src/refs/ref-types.js";
import {
  createRefsStructure,
  deleteRef,
  writeObjectRef,
  writeSymbolicRef,
} from "../../src/refs/ref-writer.js";

// 40-character hex strings for testing (proper SHA-1 length)
const ID1 = "1234567890abcdef1234567890abcdef12345678" as ObjectId;
const ID2 = "abcdef1234567890abcdef1234567890abcdef12" as ObjectId;
const ID3 = "fedcba0987654321fedcba0987654321fedcba09" as ObjectId;

describe("refs", () => {
  let files: FilesApi;
  const gitDir = ".git";

  beforeEach(() => {
    files = new FilesApi(new MemFilesApi());
  });

  describe("ref-types", () => {
    it("creates regular ref", () => {
      const ref = createRef("refs/heads/main", ID1);
      expect(ref.name).toBe("refs/heads/main");
      expect(ref.objectId).toBe(ID1);
      expect(ref.storage).toBe(RefStore.LOOSE);
      expect(ref.peeled).toBe(false);
    });

    it("creates peeled ref", () => {
      const ref = createPeeledRef("refs/heads/main", ID1, RefStore.PACKED);
      expect(ref.peeled).toBe(true);
      expect(ref.peeledObjectId).toBeUndefined();
    });

    it("creates peeled tag ref", () => {
      const ref = createPeeledTagRef("refs/tags/v1.0", ID1, ID2);
      expect(ref.peeled).toBe(true);
      expect(ref.peeledObjectId).toBe(ID2);
    });

    it("creates symbolic ref", () => {
      const ref = createSymbolicRef("HEAD", "refs/heads/main");
      expect(ref.name).toBe("HEAD");
      expect(ref.target).toBe("refs/heads/main");
      expect(ref.storage).toBe(RefStore.LOOSE);
    });

    it("identifies symbolic refs", () => {
      const regular = createRef("refs/heads/main", ID1);
      const symbolic = createSymbolicRef("HEAD", "refs/heads/main");

      expect(isSymbolicRef(regular)).toBe(false);
      expect(isSymbolicRef(symbolic)).toBe(true);
    });
  });

  describe("ref-reader", () => {
    it("reads regular loose ref", async () => {
      await files.write(joinPath(gitDir, "refs/heads/main"), [
        new TextEncoder().encode(`${ID1}\n`),
      ]);

      const ref = await readRef(files, gitDir, "refs/heads/main");

      expect(ref).toBeDefined();
      if (!ref) return;
      expect(isSymbolicRef(ref)).toBe(false);
      expect((ref as Ref).objectId).toBe(ID1);
    });

    it("reads symbolic ref", async () => {
      await files.write(joinPath(gitDir, "HEAD"), [
        new TextEncoder().encode("ref: refs/heads/main\n"),
      ]);

      const ref = await readRef(files, gitDir, "HEAD");

      expect(ref).toBeDefined();
      if (!ref) return;
      expect(isSymbolicRef(ref)).toBe(true);
      expect((ref as SymbolicRef).target).toBe("refs/heads/main");
    });

    it("returns undefined for missing ref", async () => {
      const ref = await readRef(files, gitDir, "refs/heads/nonexistent");
      expect(ref).toBeUndefined();
    });

    it("resolves symbolic refs", async () => {
      await files.write(joinPath(gitDir, "HEAD"), [
        new TextEncoder().encode("ref: refs/heads/main\n"),
      ]);
      await files.write(joinPath(gitDir, "refs/heads/main"), [
        new TextEncoder().encode(`${ID1}\n`),
      ]);

      const resolved = await resolveRef(files, gitDir, "HEAD");

      expect(resolved).toBeDefined();
      expect(resolved?.objectId).toBe(ID1);
    });

    it("reads all refs", async () => {
      await files.write(joinPath(gitDir, "HEAD"), [
        new TextEncoder().encode("ref: refs/heads/main\n"),
      ]);
      await files.write(joinPath(gitDir, "refs/heads/main"), [
        new TextEncoder().encode(`${ID1}\n`),
      ]);
      await files.write(joinPath(gitDir, "refs/heads/develop"), [
        new TextEncoder().encode(`${ID2}\n`),
      ]);
      await files.write(joinPath(gitDir, "refs/tags/v1.0"), [new TextEncoder().encode(`${ID3}\n`)]);

      const refs = await readAllRefs(files, gitDir);

      // Should include refs under refs/
      expect(refs.length).toBeGreaterThanOrEqual(3);
      const names = refs.map((r) => r.name);
      expect(names).toContain("refs/heads/main");
      expect(names).toContain("refs/heads/develop");
      expect(names).toContain("refs/tags/v1.0");
    });

    it("parses ref content correctly", () => {
      const content = new TextEncoder().encode(`${ID1}\n`);

      const ref = parseRefContent("refs/heads/main", content);

      expect(isSymbolicRef(ref)).toBe(false);
      expect((ref as Ref).objectId).toBe(ID1);
    });

    it("parses symbolic ref content correctly", () => {
      const content = new TextEncoder().encode("ref: refs/heads/main\n");

      const ref = parseRefContent("HEAD", content);

      expect(isSymbolicRef(ref)).toBe(true);
      expect((ref as SymbolicRef).target).toBe("refs/heads/main");
    });
  });

  describe("ref-writer", () => {
    it("writes regular ref", async () => {
      await writeObjectRef(files, gitDir, "refs/heads/main", ID1);

      const content = await files.readFile(joinPath(gitDir, "refs/heads/main"));
      expect(new TextDecoder().decode(content).trim()).toBe(ID1);
    });

    it("writes symbolic ref", async () => {
      await writeSymbolicRef(files, gitDir, "HEAD", "refs/heads/main");

      const content = await files.readFile(joinPath(gitDir, "HEAD"));
      expect(new TextDecoder().decode(content).trim()).toBe("ref: refs/heads/main");
    });

    it("creates parent directories", async () => {
      await writeObjectRef(files, gitDir, "refs/heads/feature/my-feature", ID1);

      const exists = await files.exists(joinPath(gitDir, "refs/heads/feature"));
      expect(exists).toBe(true);
    });

    it("deletes ref", async () => {
      await writeObjectRef(files, gitDir, "refs/heads/to-delete", ID1);

      const deleted = await deleteRef(files, gitDir, "refs/heads/to-delete");

      expect(deleted).toBe(true);
      const exists = await files.exists(joinPath(gitDir, "refs/heads/to-delete"));
      expect(exists).toBe(false);
    });

    it("returns false when deleting nonexistent ref", async () => {
      const deleted = await deleteRef(files, gitDir, "refs/heads/nonexistent");
      expect(deleted).toBe(false);
    });

    it("creates refs structure", async () => {
      await createRefsStructure(files, gitDir);

      expect(await files.exists(joinPath(gitDir, "refs"))).toBe(true);
      expect(await files.exists(joinPath(gitDir, "refs/heads"))).toBe(true);
      expect(await files.exists(joinPath(gitDir, "refs/tags"))).toBe(true);
    });
  });

  describe("packed-refs-reader", () => {
    it("parses packed-refs without header", () => {
      const content = `${ID1} refs/heads/main\n${ID2} refs/heads/develop\n`;

      const { refs, peeled } = parsePackedRefs(content);

      expect(peeled).toBe(false);
      expect(refs.length).toBe(2);
      expect(refs[0].name).toBe("refs/heads/main");
      expect(refs[0].objectId).toBe(ID1);
    });

    it("parses packed-refs with peeled header", () => {
      const content = `# pack-refs with: peeled\n${ID1} refs/heads/main\n${ID2} refs/tags/v1.0\n^${ID3}\n`;

      const { refs, peeled } = parsePackedRefs(content);

      expect(peeled).toBe(true);
      expect(refs.length).toBe(2);
      expect(refs[1].name).toBe("refs/tags/v1.0");
      expect(refs[1].peeledObjectId).toBe(ID3);
    });

    it("reads packed-refs from file", async () => {
      const content = `${ID1} refs/heads/main\n`;
      await files.write(joinPath(gitDir, "packed-refs"), [new TextEncoder().encode(content)]);

      const { refs } = await readPackedRefs(files, gitDir);

      expect(refs.length).toBe(1);
      expect(refs[0].name).toBe("refs/heads/main");
    });

    it("returns empty array for missing packed-refs", async () => {
      const { refs } = await readPackedRefs(files, gitDir);
      expect(refs).toEqual([]);
    });

    it("finds specific packed ref", async () => {
      const content = `${ID1} refs/heads/main\n${ID2} refs/heads/develop\n`;
      await files.write(joinPath(gitDir, "packed-refs"), [new TextEncoder().encode(content)]);

      const ref = await findPackedRef(files, gitDir, "refs/heads/develop");

      expect(ref).toBeDefined();
      expect(ref?.objectId).toBe(ID2);
    });
  });

  describe("packed-refs-writer", () => {
    it("formats packed-refs with header", () => {
      const refs: Ref[] = [createPeeledRef("refs/heads/main", ID1, RefStore.PACKED)];

      const content = formatPackedRefs(refs, true);

      expect(content).toContain("# pack-refs with: peeled");
      expect(content).toContain(`${ID1} refs/heads/main`);
    });

    it("formats peeled tags correctly", () => {
      const refs: Ref[] = [createPeeledTagRef("refs/tags/v1.0", ID1, ID2, RefStore.PACKED)];

      const content = formatPackedRefs(refs, true);

      expect(content).toContain(`${ID1} refs/tags/v1.0`);
      expect(content).toContain(`^${ID2}`);
    });

    it("writes packed-refs file", async () => {
      const refs: Ref[] = [createPeeledRef("refs/heads/main", ID1, RefStore.PACKED)];

      await writePackedRefs(files, gitDir, refs);

      const content = await files.readFile(joinPath(gitDir, "packed-refs"));
      expect(new TextDecoder().decode(content)).toContain("refs/heads/main");
    });

    it("adds ref to packed-refs", async () => {
      const content = `# pack-refs with: peeled\n${ID1} refs/heads/main\n`;
      await files.write(joinPath(gitDir, "packed-refs"), [new TextEncoder().encode(content)]);

      const newRef = createPeeledRef("refs/heads/develop", ID2, RefStore.PACKED);

      await addPackedRef(files, gitDir, newRef);

      const { refs } = await readPackedRefs(files, gitDir);
      expect(refs.length).toBe(2);
      const names = refs.map((r) => r.name);
      expect(names).toContain("refs/heads/develop");
    });

    it("removes ref from packed-refs", async () => {
      const content = `# pack-refs with: peeled\n${ID1} refs/heads/main\n${ID2} refs/heads/develop\n`;
      await files.write(joinPath(gitDir, "packed-refs"), [new TextEncoder().encode(content)]);

      const removed = await removePackedRef(files, gitDir, "refs/heads/main");

      expect(removed).toBe(true);
      const { refs } = await readPackedRefs(files, gitDir);
      expect(refs.length).toBe(1);
      expect(refs[0].name).toBe("refs/heads/develop");
    });
  });

  describe("GitRefStorage", () => {
    it("reads exact ref", async () => {
      await files.write(joinPath(gitDir, "refs/heads/main"), [
        new TextEncoder().encode(`${ID1}\n`),
      ]);

      const refStorage = new GitRefStorage(files, gitDir);
      const ref = await refStorage.get("refs/heads/main");

      expect(ref).toBeDefined();
      expect((ref as Ref).objectId).toBe(ID1);
    });

    it("resolves HEAD to branch", async () => {
      await files.write(joinPath(gitDir, "HEAD"), [
        new TextEncoder().encode("ref: refs/heads/main\n"),
      ]);
      await files.write(joinPath(gitDir, "refs/heads/main"), [
        new TextEncoder().encode(`${ID1}\n`),
      ]);

      const refStorage = new GitRefStorage(files, gitDir);
      const resolved = await refStorage.resolve("HEAD");

      expect(resolved).toBeDefined();
      expect(resolved?.objectId).toBe(ID1);
    });

    it("lists branches", async () => {
      await files.write(joinPath(gitDir, "refs/heads/main"), [
        new TextEncoder().encode(`${ID1}\n`),
      ]);
      await files.write(joinPath(gitDir, "refs/heads/develop"), [
        new TextEncoder().encode(`${ID2}\n`),
      ]);

      const refStorage = new GitRefStorage(files, gitDir);
      const branches: Ref[] = [];
      for await (const ref of refStorage.list("refs/heads/")) {
        if (!isSymbolicRef(ref)) {
          branches.push(ref);
        }
      }

      expect(branches.length).toBe(2);
      const names = branches.map((b) => b.name);
      expect(names).toContain("refs/heads/main");
      expect(names).toContain("refs/heads/develop");
    });

    it("sets ref", async () => {
      const refStorage = new GitRefStorage(files, gitDir);
      await refStorage.set("refs/heads/main", ID1);

      const ref = await refStorage.get("refs/heads/main");
      expect(ref).toBeDefined();
      expect((ref as Ref).objectId).toBe(ID1);
    });

    it("sets symbolic ref", async () => {
      const refStorage = new GitRefStorage(files, gitDir);
      await refStorage.setSymbolic("HEAD", "refs/heads/main");

      const head = await refStorage.get("HEAD");
      expect(head).toBeDefined();
      if (!head) return;
      expect(isSymbolicRef(head)).toBe(true);
      expect((head as SymbolicRef).target).toBe("refs/heads/main");
    });

    it("sets detached HEAD", async () => {
      const refStorage = new GitRefStorage(files, gitDir);
      await refStorage.set("HEAD", ID1);

      const head = await refStorage.get("HEAD");
      expect(head).toBeDefined();
      if (!head) return;
      expect(isSymbolicRef(head)).toBe(false);
      expect((head as Ref).objectId).toBe(ID1);
    });

    it("deletes ref", async () => {
      await files.write(joinPath(gitDir, "refs/heads/to-delete"), [
        new TextEncoder().encode(`${ID1}\n`),
      ]);

      const refStorage = new GitRefStorage(files, gitDir);
      const deleted = await refStorage.delete("refs/heads/to-delete");

      expect(deleted).toBe(true);
      expect(await refStorage.has("refs/heads/to-delete")).toBe(false);
    });

    it("checks ref existence", async () => {
      await files.write(joinPath(gitDir, "refs/heads/main"), [
        new TextEncoder().encode(`${ID1}\n`),
      ]);

      const refStorage = new GitRefStorage(files, gitDir);

      expect(await refStorage.has("refs/heads/main")).toBe(true);
      expect(await refStorage.has("refs/heads/nonexistent")).toBe(false);
    });
  });

  describe("ref utilities", () => {
    it("validates ref names", () => {
      expect(isValidRefName("refs/heads/main")).toBe(true);
      expect(isValidRefName("refs/heads/feature/foo")).toBe(true);
      expect(isValidRefName("HEAD")).toBe(true);

      expect(isValidRefName("")).toBe(false);
      expect(isValidRefName("/refs/heads/main")).toBe(false);
      expect(isValidRefName("refs/heads/main/")).toBe(false);
      expect(isValidRefName("refs//heads/main")).toBe(false);
      expect(isValidRefName("refs/heads/main..bar")).toBe(false);
      expect(isValidRefName("refs/heads/main.lock")).toBe(false);
      expect(isValidRefName("refs/heads/main@{0}")).toBe(false);
    });

    it("shortens ref names", () => {
      expect(shortenRefName("refs/heads/main")).toBe("main");
      expect(shortenRefName("refs/tags/v1.0")).toBe("v1.0");
      expect(shortenRefName("refs/remotes/origin/main")).toBe("origin/main");
      expect(shortenRefName("HEAD")).toBe("HEAD");
    });
  });

  describe("loose ref precedence over packed", () => {
    it("loose ref takes precedence", async () => {
      // Write packed ref
      const packedContent = `${ID1} refs/heads/main\n`;
      await files.write(joinPath(gitDir, "packed-refs"), [new TextEncoder().encode(packedContent)]);

      // Write different loose ref
      await files.write(joinPath(gitDir, "refs/heads/main"), [
        new TextEncoder().encode(`${ID2}\n`),
      ]);

      const ref = await readRef(files, gitDir, "refs/heads/main");

      expect(ref).toBeDefined();
      // Should return loose ref value, not packed
      expect((ref as Ref).objectId).toBe(ID2);
      expect((ref as Ref).storage).toBe(RefStore.LOOSE);
    });

    it("falls back to packed when loose missing", async () => {
      // Write packed ref only
      const packedContent = `${ID1} refs/heads/main\n`;
      await files.write(joinPath(gitDir, "packed-refs"), [new TextEncoder().encode(packedContent)]);

      const ref = await readRef(files, gitDir, "refs/heads/main");

      expect(ref).toBeDefined();
      expect((ref as Ref).objectId).toBe(ID1);
      expect((ref as Ref).storage).toBe(RefStore.PACKED);
    });
  });
});
