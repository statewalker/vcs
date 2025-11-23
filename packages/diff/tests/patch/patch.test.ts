import { describe, it, expect } from "vitest";
import { Patch } from "../../src/patch/patch.js";

describe("Patch", () => {
	describe("parse", () => {
		it("should parse empty patch", () => {
			const patch = new Patch();
			const buffer = new Uint8Array([]);
			patch.parse(buffer);

			expect(patch.getFiles()).toHaveLength(0);
			expect(patch.getErrors()).toHaveLength(0);
		});

		it("should skip trailing whitespace", () => {
			const patch = new Patch();
			const buffer = new TextEncoder().encode("   \n  \n");
			patch.parse(buffer);

			expect(patch.getFiles()).toHaveLength(0);
			expect(patch.getErrors()).toHaveLength(0);
		});

		it("should detect disconnected hunk header", () => {
			const patch = new Patch();
			const buffer = new TextEncoder().encode("@@ -1,1 +1,1 @@\n");
			patch.parse(buffer);

			expect(patch.getFiles()).toHaveLength(0);
			expect(patch.getErrors()).toHaveLength(1);
			expect(patch.getErrors()[0].message).toContain("disconnected");
		});

		it("should detect git diff format", () => {
			const patch = new Patch();
			const buffer = new TextEncoder().encode(
				"diff --git a/file.txt b/file.txt\n",
			);
			patch.parse(buffer);

			// Should attempt to parse (will error since we haven't implemented FileHeader yet)
			expect(patch.getErrors().length).toBeGreaterThanOrEqual(1);
			expect(patch.getErrors()[0].message).toContain("not yet implemented");
		});

		it("should detect traditional diff format", () => {
			const patch = new Patch();
			const buffer = new TextEncoder().encode(
				"--- a/file.txt\n+++ b/file.txt\n@@ -1,1 +1,1 @@\n",
			);
			patch.parse(buffer);

			// Should attempt to parse (will error since we haven't implemented parsing yet)
			expect(patch.getErrors().length).toBeGreaterThanOrEqual(1);
			expect(patch.getErrors()[0].message).toContain("not yet implemented");
		});

		it("should detect combined diff format", () => {
			const patch = new Patch();
			const buffer = new TextEncoder().encode("diff --cc file.txt\n");
			patch.parse(buffer);

			// Should attempt to parse (will error since we haven't implemented parsing yet)
			expect(patch.getErrors().length).toBeGreaterThanOrEqual(1);
			expect(patch.getErrors()[0].message).toContain("not yet implemented");
		});

		it("should parse with custom offset and end", () => {
			const patch = new Patch();
			const buffer = new TextEncoder().encode(
				"junk\ndiff --git a/file.txt b/file.txt\nmore junk",
			);
			patch.parse(buffer, 5, 38);

			// Should parse just the middle section
			expect(patch.getErrors().length).toBeGreaterThanOrEqual(1);
		});
	});
});
