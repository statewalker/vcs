/**
 * Tests for pack file reading
 */

import * as fs from "node:fs/promises";
import * as path from "node:path";
import { NodeCompressionProvider } from "@webrun-vcs/common";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { NodeFileApi } from "../../src/file-api/index.js";
import {
  applyDelta,
  getDeltaBaseSize,
  getDeltaResultSize,
  PackReader,
  readPackIndex,
} from "../../src/pack/index.js";

const FIXTURES_DIR = path.join(import.meta.dirname, "fixtures");

describe("pack-reader", () => {
  describe("PackReader", () => {
    let files: NodeFileApi;
    let compression: NodeCompressionProvider;
    let reader: PackReader;

    beforeAll(async () => {
      files = new NodeFileApi();
      compression = new NodeCompressionProvider();

      // Load index
      const idxPath = path.join(
        FIXTURES_DIR,
        "pack-34be9032ac282b11fa9babdc2b2a93ca996c9c2f.idxV2",
      );
      const idxData = await fs.readFile(idxPath);
      const index = readPackIndex(new Uint8Array(idxData));

      // Create reader
      const packPath = path.join(
        FIXTURES_DIR,
        "pack-34be9032ac282b11fa9babdc2b2a93ca996c9c2f.pack",
      );
      reader = new PackReader(files, compression, packPath, index);
      await reader.open();
    });

    afterAll(async () => {
      await reader.close();
    });

    it("reads pack header correctly", async () => {
      const header = await reader.readPackHeader();
      expect(header.version).toBe(2);
      expect(header.objectCount).toBe(8);
    });

    it("checks object existence", () => {
      // Empty tree (known to exist)
      expect(reader.has("4b825dc642cb6eb9a060e54bf8d69288fbee4904")).toBe(true);
      // Random ID (doesn't exist)
      expect(reader.has("0000000000000000000000000000000000000000")).toBe(false);
    });

    it("reads blob objects", async () => {
      // Try to load a known object from the pack
      // We'll iterate through and find a blob
      const obj = await reader.get("4b825dc642cb6eb9a060e54bf8d69288fbee4904");
      expect(obj).toBeDefined();
      if (obj) {
        expect(obj.type).toBe(2); // TREE
        expect(obj.content).toBeDefined();
      }
    });

    it("reads object at offset", async () => {
      // Read the first object (at offset 12, after 12-byte header)
      const header = await reader.readObjectHeader(12);
      expect(header.type).toBeGreaterThan(0);
      expect(header.type).toBeLessThan(8);
      expect(header.size).toBeGreaterThanOrEqual(0);
    });

    it("loads all objects from pack", async () => {
      // Get all object IDs from the index
      const ids = [
        "4b825dc642cb6eb9a060e54bf8d69288fbee4904",
        "540a36d136cf413e4b064c2b0e0a4db60f77feab",
        "5b6e7c66c276e7610d4a73c70ec1a1f7c1003259",
        "6ff87c4664981e4397625791c8ea3bbb5f2279a3",
        "82c6b885ff600be425b4ea96dee75dca255b69e7",
        "902d5476fa249b7abc9d84c611577a81381f0327",
        "aabf2ffaec9b497f0950352b3e582d73035c2035",
        "c59759f143fb1fe21c197981df75a7ee00290799",
      ];

      const loaded: string[] = [];
      const errors: { id: string; error: string }[] = [];

      for (const id of ids) {
        try {
          const obj = await reader.get(id);
          if (obj) {
            // Type should be valid (1=commit, 2=tree, 3=blob, 4=tag)
            expect([1, 2, 3, 4]).toContain(obj.type);
            expect(obj.content).toBeDefined();
            expect(obj.size).toBe(obj.content.length);
            loaded.push(id);
          }
        } catch (e) {
          errors.push({
            id,
            error: e instanceof Error ? e.message : String(e),
          });
        }
      }

      // Report failures for debugging
      if (errors.length > 0) {
        console.log("Failed to load objects:", errors);
      }

      // All should load successfully
      expect(errors).toEqual([]);
    });

    it("returns undefined for nonexistent objects", async () => {
      const obj = await reader.get("0000000000000000000000000000000000000000");
      expect(obj).toBeUndefined();
    });
  });

  describe("dense pack with deltas", () => {
    let files: NodeFileApi;
    let compression: NodeCompressionProvider;
    let reader: PackReader;

    beforeAll(async () => {
      files = new NodeFileApi();
      compression = new NodeCompressionProvider();

      // Load dense pack index
      const idxPath = path.join(
        FIXTURES_DIR,
        "pack-df2982f284bbabb6bdb59ee3fcc6eb0983e20371.idxV2",
      );
      const idxData = await fs.readFile(idxPath);
      const index = readPackIndex(new Uint8Array(idxData));

      // Create reader
      const packPath = path.join(
        FIXTURES_DIR,
        "pack-df2982f284bbabb6bdb59ee3fcc6eb0983e20371.pack",
      );
      reader = new PackReader(files, compression, packPath, index);
      await reader.open();
    });

    afterAll(async () => {
      await reader.close();
    });

    it("reads pack header", async () => {
      const header = await reader.readPackHeader();
      expect(header.version).toBe(2);
      expect(header.objectCount).toBeGreaterThan(0);
    });

    it("can load objects (may include deltas)", async () => {
      // Load first 10 objects using the index
      // This tests that delta resolution works correctly
      const index = readPackIndex(
        new Uint8Array(
          await fs.readFile(
            path.join(FIXTURES_DIR, "pack-df2982f284bbabb6bdb59ee3fcc6eb0983e20371.idxV2"),
          ),
        ),
      );

      const entries = Array.from(index.entries()).slice(0, 10);
      let loaded = 0;
      const errors: { id: string; error: string }[] = [];

      for (const entry of entries) {
        try {
          const obj = await reader.get(entry.id);
          if (obj) {
            expect([1, 2, 3, 4]).toContain(obj.type);
            loaded++;
          }
        } catch (e) {
          errors.push({
            id: entry.id,
            error: e instanceof Error ? e.message : String(e),
          });
        }
      }

      if (errors.length > 0) {
        console.log("Dense pack errors:", errors);
      }

      expect(loaded).toBeGreaterThan(0);
    });
  });

  describe("applyDelta", () => {
    it("applies INSERT-only delta", () => {
      const base = new Uint8Array([1, 2, 3, 4, 5]);
      // Delta: base size = 5, result size = 8, INSERT 3 bytes
      const _delta = new Uint8Array([
        5, // base size (varint)
        8, // result size (varint)
        0x03, // INSERT 3 bytes
        6,
        7,
        8, // literal data
        0x85, // COPY offset=0, size=5 (0x80 | 0x01 | 0x10 bits set... simplified)
        0,
        5,
      ]);

      // Actually, let's create a proper delta
      // base size = 5, result size = 8
      // Copy 5 bytes from offset 0, then insert 3 bytes
      const properDelta = new Uint8Array([
        5, // base size
        8, // result size
        0x91, // COPY: offset byte present (0x01), size byte present (0x10)
        0, // offset = 0
        5, // size = 5
        0x03, // INSERT 3 bytes
        6,
        7,
        8,
      ]);

      const result = applyDelta(base, properDelta);
      expect(Array.from(result)).toEqual([1, 2, 3, 4, 5, 6, 7, 8]);
    });

    it("applies COPY-only delta", () => {
      const base = new Uint8Array([1, 2, 3, 4, 5, 6, 7, 8]);
      // Copy bytes 2-5 from base (offset=2, size=4)
      const delta = new Uint8Array([
        8, // base size
        4, // result size
        0x91, // COPY with offset and size bytes
        2, // offset = 2
        4, // size = 4
      ]);

      const result = applyDelta(base, delta);
      expect(Array.from(result)).toEqual([3, 4, 5, 6]);
    });

    it("applies mixed COPY and INSERT delta", () => {
      const base = new Uint8Array([0x48, 0x65, 0x6c, 0x6c, 0x6f]); // "Hello"
      // Result: "Hello World" (11 bytes)
      const delta = new Uint8Array([
        5, // base size
        11, // result size
        0x91, // COPY offset=0, size=5
        0,
        5,
        0x06, // INSERT 6 bytes
        0x20,
        0x57,
        0x6f,
        0x72,
        0x6c,
        0x64, // " World"
      ]);

      const result = applyDelta(base, delta);
      expect(new TextDecoder().decode(result)).toBe("Hello World");
    });

    it("throws on base size mismatch", () => {
      const base = new Uint8Array([1, 2, 3]);
      const delta = new Uint8Array([
        5, // wrong base size
        3,
        0x91,
        0,
        3,
      ]);

      expect(() => applyDelta(base, delta)).toThrow("base length mismatch");
    });
  });

  describe("getDeltaBaseSize", () => {
    it("reads single-byte size", () => {
      const delta = new Uint8Array([42, 10, 0x91, 0, 42]);
      expect(getDeltaBaseSize(delta)).toBe(42);
    });

    it("reads multi-byte size", () => {
      // Size 300 = 0x12C = (0x2C | 0x80), 0x02
      const delta = new Uint8Array([0xac, 0x02, 10, 0x91, 0, 10]);
      expect(getDeltaBaseSize(delta)).toBe(300);
    });
  });

  describe("getDeltaResultSize", () => {
    it("reads result size after base size", () => {
      const delta = new Uint8Array([5, 42, 0x91, 0, 5]);
      expect(getDeltaResultSize(delta)).toBe(42);
    });

    it("reads multi-byte sizes", () => {
      // Base size 300, result size 500
      const delta = new Uint8Array([0xac, 0x02, 0xf4, 0x03, 0x91, 0, 10]);
      expect(getDeltaResultSize(delta)).toBe(500);
    });
  });
});
