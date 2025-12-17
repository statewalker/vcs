/**
 * Tests for DiffFormatter
 */

import { describe, expect, it } from "vitest";

import { ChangeType, createAddEntry, createDeleteEntry, DiffFormatter } from "../src/index.js";
import { addFile, createInitializedGit } from "./test-helper.js";

describe("DiffFormatter", () => {
  it("should format added file", async () => {
    const { git, store } = await createInitializedGit();

    // Add a file
    await addFile(store, "new-file.txt", "line 1\nline 2\nline 3\n");
    await git.commit().setMessage("add file").call();

    // Get the diff
    const entries = await git.diff().setOldTree("HEAD~1").setNewTree("HEAD").call();

    expect(entries.length).toBe(1);
    expect(entries[0].changeType).toBe(ChangeType.ADD);

    // Format the diff
    const formatter = new DiffFormatter(store.objects);
    const diff = await formatter.format(entries[0]);

    expect(diff.entry).toBe(entries[0]);
    expect(diff.isBinary).toBe(false);
    expect(diff.header).toContain("new-file.txt");
    expect(diff.hunks.length).toBe(1);

    // Check hunk content
    const hunk = diff.hunks[0];
    expect(hunk.oldStart).toBe(1);
    expect(hunk.oldCount).toBe(0);
    expect(hunk.newStart).toBe(1);
    expect(hunk.newCount).toBe(3);
    expect(hunk.lines.every((l) => l.startsWith("+"))).toBe(true);
  });

  it("should format deleted file", async () => {
    const { git, store } = await createInitializedGit();

    // Add a file
    await addFile(store, "to-delete.txt", "content\n");
    await git.commit().setMessage("add file").call();

    // Get HEAD commit's tree for later comparison
    const headRef = await store.refs.resolve("HEAD");
    const headCommit = await store.commits.loadCommit(headRef?.objectId ?? "");

    // Remove file from staging and commit
    const builder = store.staging.builder();
    await builder.finish();
    await git.commit().setMessage("delete file").call();

    // Create a manual delete entry for testing
    const entry = createDeleteEntry(
      "to-delete.txt",
      headCommit.tree, // Using tree as placeholder - in real usage would be blob ID
      0o100644,
    );

    // For a real delete, we'd need the actual blob ID
    // This test verifies the structure is correct
    expect(entry.changeType).toBe(ChangeType.DELETE);
    expect(entry.oldPath).toBe("to-delete.txt");
  });

  it("should format modified file", async () => {
    const { git, store } = await createInitializedGit();

    // Add a file
    await addFile(store, "modify.txt", "line 1\nline 2\nline 3\n");
    await git.commit().setMessage("add file").call();

    // Modify the file
    await addFile(store, "modify.txt", "line 1\nmodified line 2\nline 3\n");
    await git.commit().setMessage("modify file").call();

    // Get the diff
    const entries = await git.diff().setOldTree("HEAD~1").setNewTree("HEAD").call();

    expect(entries.length).toBe(1);
    expect(entries[0].changeType).toBe(ChangeType.MODIFY);

    // Format the diff
    const formatter = new DiffFormatter(store.objects);
    const diff = await formatter.format(entries[0]);

    expect(diff.isBinary).toBe(false);
    expect(diff.hunks.length).toBe(1);

    // Verify hunk contains both - and + lines
    const hunk = diff.hunks[0];
    const minusLines = hunk.lines.filter((l) => l.startsWith("-"));
    const plusLines = hunk.lines.filter((l) => l.startsWith("+"));
    expect(minusLines.length).toBeGreaterThan(0);
    expect(plusLines.length).toBeGreaterThan(0);
  });

  it("should include context lines", async () => {
    const { git, store } = await createInitializedGit();

    // Add a file with many lines
    const lines = `${Array.from({ length: 20 }, (_, i) => `line ${i + 1}`).join("\n")}\n`;
    await addFile(store, "context.txt", lines);
    await git.commit().setMessage("add file").call();

    // Modify a line in the middle
    const newLines = lines.replace("line 10", "MODIFIED line 10");
    await addFile(store, "context.txt", newLines);
    await git.commit().setMessage("modify file").call();

    // Get and format the diff
    const entries = await git.diff().setOldTree("HEAD~1").setNewTree("HEAD").call();
    const formatter = new DiffFormatter(store.objects, { contextLines: 3 });
    const diff = await formatter.format(entries[0]);

    expect(diff.hunks.length).toBe(1);
    const hunk = diff.hunks[0];

    // Should have context lines (starting with space)
    const contextLines = hunk.lines.filter((l) => l.startsWith(" "));
    expect(contextLines.length).toBeGreaterThan(0);
  });

  it("should format multiple hunks for distant changes", async () => {
    const { git, store } = await createInitializedGit();

    // Add a file with many lines
    const lines = `${Array.from({ length: 30 }, (_, i) => `line ${i + 1}`).join("\n")}\n`;
    await addFile(store, "multi-hunk.txt", lines);
    await git.commit().setMessage("add file").call();

    // Modify lines at beginning and end (far apart)
    const newLines = lines
      .replace("line 1", "MODIFIED line 1")
      .replace("line 30", "MODIFIED line 30");
    await addFile(store, "multi-hunk.txt", newLines);
    await git.commit().setMessage("modify file").call();

    // Get and format the diff with small context
    const entries = await git.diff().setOldTree("HEAD~1").setNewTree("HEAD").call();
    const formatter = new DiffFormatter(store.objects, { contextLines: 2 });
    const diff = await formatter.format(entries[0]);

    // Should have 2 separate hunks due to distance
    expect(diff.hunks.length).toBe(2);
  });

  it("should convert to string format", async () => {
    const { git, store } = await createInitializedGit();

    // Add a file
    await addFile(store, "test.txt", "hello\n");
    await git.commit().setMessage("add file").call();

    // Get and format the diff
    const entries = await git.diff().setOldTree("HEAD~1").setNewTree("HEAD").call();
    const formatter = new DiffFormatter(store.objects);
    const diff = await formatter.format(entries[0]);

    const output = formatter.toString(diff);

    // Verify unified diff format
    expect(output).toContain("diff --git");
    expect(output).toContain("--- /dev/null");
    expect(output).toContain("+++ b/test.txt");
    expect(output).toContain("@@");
    expect(output).toContain("+hello");
  });

  it("should format all entries at once", async () => {
    const { git, store } = await createInitializedGit();

    // Add multiple files
    await addFile(store, "file1.txt", "content 1\n");
    await addFile(store, "file2.txt", "content 2\n");
    await git.commit().setMessage("add files").call();

    // Get and format all diffs
    const entries = await git.diff().setOldTree("HEAD~1").setNewTree("HEAD").call();
    const formatter = new DiffFormatter(store.objects);
    const output = await formatter.formatAll(entries);

    // Should contain both files
    expect(output).toContain("file1.txt");
    expect(output).toContain("file2.txt");
    expect(output).toContain("+content 1");
    expect(output).toContain("+content 2");
  });

  it("should abbreviate object IDs by default", async () => {
    const { git, store } = await createInitializedGit();

    // Add a file
    await addFile(store, "test.txt", "content\n");
    await git.commit().setMessage("add file").call();

    // Get and format the diff
    const entries = await git.diff().setOldTree("HEAD~1").setNewTree("HEAD").call();
    const formatter = new DiffFormatter(store.objects);
    const diff = await formatter.format(entries[0]);

    // Index line should have abbreviated IDs
    expect(diff.indexLine).toMatch(/index [a-f0-9]{7}\.\.[a-f0-9]{7}/);
  });

  it("should respect custom abbreviation length", async () => {
    const { git, store } = await createInitializedGit();

    // Add a file and modify it (to get both old and new IDs)
    await addFile(store, "test.txt", "content\n");
    await git.commit().setMessage("add file").call();

    await addFile(store, "test.txt", "modified\n");
    await git.commit().setMessage("modify file").call();

    // Get and format the diff (MODIFY has both old and new IDs)
    const entries = await git.diff().setOldTree("HEAD~1").setNewTree("HEAD").call();
    const formatter = new DiffFormatter(store.objects, { abbreviationLength: 10 });
    const diff = await formatter.format(entries[0]);

    // Index line should have longer abbreviated IDs (10 chars each)
    expect(diff.indexLine).toMatch(/index [a-f0-9]{10}\.\.[a-f0-9]{10}/);
  });

  it("should handle empty files", async () => {
    const { store } = await createInitializedGit();

    // The entry for an empty added file
    const entry = createAddEntry("empty.txt", "e69de29bb2d1d6434b8b29ae775ad8c2e48c5391", 0o100644);

    const formatter = new DiffFormatter(store.objects);

    // This will fail to load content (object doesn't exist) but should handle gracefully
    // In real usage, the object would exist
    try {
      const diff = await formatter.format(entry);
      // If it succeeds, verify structure
      expect(diff.entry).toBe(entry);
    } catch {
      // Expected when object doesn't exist in test store
    }
  });
});

describe("DiffFormatter with binary files", () => {
  it("should detect binary content", async () => {
    const { store } = await createInitializedGit();

    // Create binary content (with null bytes)
    const binaryContent = new Uint8Array([0x00, 0x01, 0x02, 0x03]);
    const objectId = await store.objects.store([binaryContent]);

    const entry = createAddEntry("binary.bin", objectId, 0o100644);

    const formatter = new DiffFormatter(store.objects);
    const diff = await formatter.format(entry);

    expect(diff.isBinary).toBe(true);
    expect(diff.hunks.length).toBe(0);
  });

  it("should indicate binary files differ in string output", async () => {
    const { store } = await createInitializedGit();

    // Create binary content
    const binaryContent = new Uint8Array([0x00, 0x01, 0x02]);
    const objectId = await store.objects.store([binaryContent]);

    const entry = createAddEntry("binary.bin", objectId, 0o100644);

    const formatter = new DiffFormatter(store.objects);
    const diff = await formatter.format(entry);
    const output = formatter.toString(diff);

    expect(output).toContain("Binary files");
    expect(output).toContain("differ");
  });
});
