import { describe, expect, it } from "vitest";
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

    it("should detect and parse git diff format", () => {
      const patch = new Patch();
      const buffer = new TextEncoder().encode(
        "diff --git a/file.txt b/file.txt\nindex abc123..def456 100644\n",
      );
      patch.parse(buffer);

      // Should successfully parse the file header
      expect(patch.getFiles()).toHaveLength(1);
      expect(patch.getFiles()[0].oldPath).toBe("file.txt");
      expect(patch.getFiles()[0].newPath).toBe("file.txt");
    });

    it("should detect traditional diff format", () => {
      const patch = new Patch();
      const buffer = new TextEncoder().encode("--- a/file.txt\n+++ b/file.txt\n@@ -1,1 +1,1 @@\n");
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
        "junk\ndiff --git a/file.txt b/file.txt\nindex abc..def 100644\nmore junk",
      );
      patch.parse(buffer, 5, 65);

      // Should parse just the middle section
      expect(patch.getFiles()).toHaveLength(1);
    });

    it("should parse multiple files in one patch", () => {
      const patchText = `diff --git a/file1.txt b/file1.txt
index abc123..def456 100644
--- a/file1.txt
+++ b/file1.txt
@@ -1,1 +1,1 @@
-old
+new
diff --git a/file2.txt b/file2.txt
new file mode 100644
index 0000000..abc123
--- /dev/null
+++ b/file2.txt
@@ -0,0 +1,1 @@
+content
`;
      const patch = new Patch();
      const buffer = new TextEncoder().encode(patchText);
      patch.parse(buffer);

      expect(patch.getFiles()).toHaveLength(2);
      expect(patch.getFiles()[0].oldPath).toBe("file1.txt");
      expect(patch.getFiles()[0].changeType).toBe("MODIFY");
      expect(patch.getFiles()[1].oldPath).toBe("file2.txt");
      expect(patch.getFiles()[1].changeType).toBe("ADD");
    });
  });
});
