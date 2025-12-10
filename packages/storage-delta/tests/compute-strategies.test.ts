import { describe, expect, it } from "vitest";
import { RollingHashDeltaStrategy } from "../src/compute/rolling-hash-compute.js";

describe("RollingHashDeltaStrategy", () => {
  const strategy = new RollingHashDeltaStrategy();

  describe("computeDelta", () => {
    it("should compute delta as Delta[] for similar content", () => {
      // Use larger content with more similarity to get beneficial delta
      const basePattern = "The quick brown fox jumps over the lazy dog. ";
      const base = new TextEncoder().encode(basePattern.repeat(20));
      const target = new TextEncoder().encode(basePattern.replace("fox", "cat").repeat(20));

      const result = strategy.computeDelta(base, target, { maxRatio: 0.9 });

      expect(result).not.toBeNull();

      // Verify delta is an array of Delta instructions
      expect(Array.isArray(result?.delta)).toBe(true);
      expect(result?.delta[0].type).toBe("start");
      expect(result?.delta[result?.delta.length - 1].type).toBe("finish");
    });

    it("should produce copy and insert instructions for modified content", () => {
      const basePattern = "The quick brown fox jumps over the lazy dog in the park. ";
      const base = new TextEncoder().encode(basePattern.repeat(20));
      const target = new TextEncoder().encode(basePattern.replace("fox", "cat").repeat(20));

      const result = strategy.computeDelta(base, target, { maxRatio: 0.95 });
      expect(result).not.toBeNull();

      // Should have copy instructions for shared content
      const copies = result?.delta.filter((d) => d.type === "copy");
      expect(copies.length).toBeGreaterThan(0);

      // Should have insert for changed content
      const inserts = result?.delta.filter((d) => d.type === "insert");
      expect(inserts.length).toBeGreaterThan(0);
    });

    it("should return null for small objects below minSize", () => {
      const base = new TextEncoder().encode("Hi");
      const target = new TextEncoder().encode("Ho");

      const result = strategy.computeDelta(base, target, { minSize: 50 });

      expect(result).toBeNull();
    });

    it("should return null when delta is not beneficial (completely different content)", () => {
      const base = new TextEncoder().encode("AAAA".repeat(50));
      const target = new TextEncoder().encode("BBBB".repeat(50));

      const result = strategy.computeDelta(base, target);

      // Completely different content should not produce beneficial delta
      expect(result).toBeNull();
    });

    it("should respect maxRatio option", () => {
      const basePattern = "Hello, World! This is some content that repeats. ";
      const base = new TextEncoder().encode(basePattern.repeat(10));
      const target = new TextEncoder().encode(basePattern.replace("Hello", "Hi").repeat(10));

      // With very strict ratio, might not produce delta
      const strictResult = strategy.computeDelta(base, target, { maxRatio: 0.1 });

      // With lenient ratio, should produce delta
      const lenientResult = strategy.computeDelta(base, target, { maxRatio: 0.95 });

      // At least the lenient one should work
      expect(lenientResult).not.toBeNull();
      // Strict might be null (which is expected)
      if (strictResult) {
        expect(strictResult.ratio).toBeLessThan(0.1);
      }
    });
  });

  describe("applyDelta", () => {
    it("should roundtrip via applyDelta", () => {
      const basePattern = "Hello, World! This is the base content that we will modify. ";
      const base = new TextEncoder().encode(basePattern.repeat(15));
      const target = new TextEncoder().encode(basePattern.replace("modify", "change").repeat(15));

      const result = strategy.computeDelta(base, target, { maxRatio: 0.95 });
      expect(result).not.toBeNull();

      // Apply Delta[] to reconstruct target
      const reconstructed = strategy.applyDelta(base, result?.delta);
      expect(reconstructed).toEqual(target);
    });

    it("should handle empty base correctly with lenient ratio", () => {
      const base = new Uint8Array(0);
      const target = new TextEncoder().encode(
        "This is entirely new content that was not in the base. ".repeat(5),
      );

      // Empty base means all inserts - need very lenient ratio
      const result = strategy.computeDelta(base, target, { maxRatio: 1.5 });
      expect(result).not.toBeNull();

      const reconstructed = strategy.applyDelta(base, result?.delta);
      expect(reconstructed).toEqual(target);
    });

    it("should handle large content", () => {
      // Create base with repeated pattern
      const pattern = "The quick brown fox jumps over the lazy dog. ";
      const base = new TextEncoder().encode(pattern.repeat(100));

      // Modify a few places
      let targetStr = pattern.repeat(100);
      targetStr = targetStr.replace(/fox/g, "cat").replace(/dog/g, "mouse");
      const target = new TextEncoder().encode(targetStr);

      const result = strategy.computeDelta(base, target, { maxRatio: 0.95 });
      expect(result).not.toBeNull();

      // Should have reasonable compression for mostly similar content
      expect(result?.ratio).toBeLessThan(0.8);

      // Verify roundtrip
      const reconstructed = strategy.applyDelta(base, result?.delta);
      expect(reconstructed).toEqual(target);
    });
  });

  describe("estimateSize", () => {
    it("should estimate size correctly", () => {
      const basePattern = "Hello, World! This is some base content. ";
      const base = new TextEncoder().encode(basePattern.repeat(10));
      const target = new TextEncoder().encode(basePattern.replace("World", "Universe").repeat(10));

      const result = strategy.computeDelta(base, target, { maxRatio: 0.95 });
      expect(result).not.toBeNull();

      const estimatedSize = strategy.estimateSize(result?.delta);
      expect(estimatedSize).toBeGreaterThan(0);
      expect(estimatedSize).toBeLessThan(target.length * 2); // Sanity check
    });

    it("should estimate larger for more inserts", () => {
      // Create two scenarios: mostly copies vs mostly inserts
      const base = new TextEncoder().encode("A".repeat(200));
      const targetSimilar = new TextEncoder().encode(`${"A".repeat(199)}B`); // One change
      const targetDifferent = new TextEncoder().encode("B".repeat(200)); // All different

      const resultSimilar = strategy.computeDelta(base, targetSimilar, { maxRatio: 0.95 });
      const resultDifferent = strategy.computeDelta(base, targetDifferent, { maxRatio: 1.5 });

      if (resultSimilar && resultDifferent) {
        const sizeSimilar = strategy.estimateSize(resultSimilar.delta);
        const sizeDifferent = strategy.estimateSize(resultDifferent.delta);

        // Different content should have larger delta
        expect(sizeDifferent).toBeGreaterThan(sizeSimilar);
      }
    });
  });

  describe("edge cases", () => {
    it("should handle binary content with null bytes", () => {
      const baseData = new Array(200).fill(0x42);
      baseData[0] = 0x00;
      baseData[50] = 0xff;
      const base = new Uint8Array(baseData);

      const targetData = new Array(200).fill(0x42);
      targetData[0] = 0x00;
      targetData[50] = 0xff;
      targetData[100] = 0x43; // One change
      const target = new Uint8Array(targetData);

      const result = strategy.computeDelta(base, target, { maxRatio: 0.95 });
      expect(result).not.toBeNull();

      const reconstructed = strategy.applyDelta(base, result?.delta);
      expect(reconstructed).toEqual(target);
    });

    it("should handle identical content (no changes)", () => {
      const content = new TextEncoder().encode(
        "This content is exactly the same in both base and target. ".repeat(10),
      );

      const result = strategy.computeDelta(content, content, { maxRatio: 0.95 });

      // Identical content should produce very good compression
      if (result) {
        expect(result.ratio).toBeLessThan(0.5);
        const reconstructed = strategy.applyDelta(content, result.delta);
        expect(reconstructed).toEqual(content);
      }
    });

    it("should handle content with only appended data", () => {
      const baseContent = "This is the original content. ".repeat(10);
      const base = new TextEncoder().encode(baseContent);
      const target = new TextEncoder().encode(`${baseContent}And here is some more text appended.`);

      const result = strategy.computeDelta(base, target, { maxRatio: 0.95 });
      expect(result).not.toBeNull();

      const reconstructed = strategy.applyDelta(base, result?.delta);
      expect(reconstructed).toEqual(target);
    });

    it("should handle content with only prepended data", () => {
      const baseContent = "This is the original content. ".repeat(10);
      const base = new TextEncoder().encode(baseContent);
      const target = new TextEncoder().encode(`Here is some text prepended. ${baseContent}`);

      const result = strategy.computeDelta(base, target, { maxRatio: 0.95 });
      expect(result).not.toBeNull();

      const reconstructed = strategy.applyDelta(base, result?.delta);
      expect(reconstructed).toEqual(target);
    });
  });
});
