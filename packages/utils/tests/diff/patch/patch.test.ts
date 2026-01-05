import { describe, expect, it } from "vitest";
import { Patch } from "../../../src/diff/patch/patch.js";

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

    it("should parse traditional diff format", () => {
      const patch = new Patch();
      const patchText = `--- a/file.txt
+++ b/file.txt
@@ -1,3 +1,3 @@
 line 1
-old line
+new line
 line 3
`;
      const buffer = new TextEncoder().encode(patchText);
      patch.parse(buffer);

      expect(patch.getErrors()).toHaveLength(0);
      expect(patch.getFiles()).toHaveLength(1);
      expect(patch.getFiles()[0].oldPath).toBe("file.txt");
      expect(patch.getFiles()[0].newPath).toBe("file.txt");
      expect(patch.getFiles()[0].changeType).toBe("MODIFY");
      expect(patch.getFiles()[0].hunks).toHaveLength(1);
    });

    it("should parse traditional diff with /dev/null for new file", () => {
      const patch = new Patch();
      const patchText = `--- /dev/null
+++ b/newfile.txt
@@ -0,0 +1,2 @@
+new line 1
+new line 2
`;
      const buffer = new TextEncoder().encode(patchText);
      patch.parse(buffer);

      expect(patch.getErrors()).toHaveLength(0);
      expect(patch.getFiles()).toHaveLength(1);
      expect(patch.getFiles()[0].oldPath).toBeNull();
      expect(patch.getFiles()[0].newPath).toBe("newfile.txt");
      expect(patch.getFiles()[0].changeType).toBe("ADD");
    });

    it("should parse traditional diff with /dev/null for deleted file", () => {
      const patch = new Patch();
      const patchText = `--- a/deleted.txt
+++ /dev/null
@@ -1,2 +0,0 @@
-old line 1
-old line 2
`;
      const buffer = new TextEncoder().encode(patchText);
      patch.parse(buffer);

      expect(patch.getErrors()).toHaveLength(0);
      expect(patch.getFiles()).toHaveLength(1);
      expect(patch.getFiles()[0].oldPath).toBe("deleted.txt");
      expect(patch.getFiles()[0].newPath).toBeNull();
      expect(patch.getFiles()[0].changeType).toBe("DELETE");
    });

    it("should parse combined diff format (diff --cc)", () => {
      const patch = new Patch();
      const patchText = `diff --cc file.txt
index abc123,def456..789012
--- a/file.txt
+++ b/file.txt
@@@ -1,5 -1,5 +1,6 @@@
  context
+ line from parent 1
 +line from parent 2
++line in result
`;
      const buffer = new TextEncoder().encode(patchText);
      patch.parse(buffer);

      expect(patch.getErrors()).toHaveLength(0);
      expect(patch.getFiles()).toHaveLength(1);
      expect(patch.getFiles()[0].oldPath).toBe("file.txt");
      expect(patch.getFiles()[0].newPath).toBe("file.txt");
      expect(patch.getFiles()[0].hunks).toHaveLength(1);
    });

    it("should parse combined diff format (diff --combined)", () => {
      const patch = new Patch();
      const patchText = `diff --combined file.txt
index abc123,def456..789012
--- a/file.txt
+++ b/file.txt
@@@ -1,3 -1,3 +1,4 @@@
  context line
++new combined line
  more context
`;
      const buffer = new TextEncoder().encode(patchText);
      patch.parse(buffer);

      expect(patch.getErrors()).toHaveLength(0);
      expect(patch.getFiles()).toHaveLength(1);
      expect(patch.getFiles()[0].oldPath).toBe("file.txt");
      expect(patch.getFiles()[0].newPath).toBe("file.txt");
    });

    it("should parse multiple traditional diffs", () => {
      const patch = new Patch();
      const patchText = `--- a/file1.txt
+++ b/file1.txt
@@ -1,1 +1,1 @@
-old1
+new1
--- a/file2.txt
+++ b/file2.txt
@@ -1,1 +1,1 @@
-old2
+new2
`;
      const buffer = new TextEncoder().encode(patchText);
      patch.parse(buffer);

      expect(patch.getErrors()).toHaveLength(0);
      expect(patch.getFiles()).toHaveLength(2);
      expect(patch.getFiles()[0].oldPath).toBe("file1.txt");
      expect(patch.getFiles()[1].oldPath).toBe("file2.txt");
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
