/**
 * Step 5: Deduplication
 *
 * Demonstrates how Git's content-addressable storage enables automatic deduplication.
 * Same content = same hash = stored only once.
 */

import {
  getHistory,
  printSection,
  printStep,
  printSubsection,
  shortId,
  storeBlob,
} from "../shared.js";

export async function step05Deduplication(): Promise<void> {
  printStep(5, "Deduplication");

  const { history } = await getHistory();

  printSubsection("Content-addressable storage");

  console.log(`\n  Git uses SHA-1 hashes to identify content.`);
  console.log(`  The hash is computed from the content itself.`);
  console.log(`  This means identical content ALWAYS produces the same hash.`);

  printSubsection("Demonstrating deduplication");

  const content = "Hello, World! This is some content.";

  console.log(`\n  Storing content: "${content}"`);

  // Store the same content multiple times
  const id1 = await storeBlob(history, content);
  console.log(`  First store:  ${id1}`);

  const id2 = await storeBlob(history, content);
  console.log(`  Second store: ${id2}`);

  const id3 = await storeBlob(history, content);
  console.log(`  Third store:  ${id3}`);

  console.log(`\n  All IDs identical: ${id1 === id2 && id2 === id3}`);
  console.log(`  Content is stored only ONCE, regardless of how many times we store it.`);

  printSubsection("Storage efficiency");

  // Create multiple files with duplicate content
  const fileContents = [
    { name: "file1.txt", content: "Shared content" },
    { name: "file2.txt", content: "Shared content" }, // Duplicate!
    { name: "file3.txt", content: "Unique content 1" },
    { name: "file4.txt", content: "Unique content 2" },
    { name: "file5.txt", content: "Shared content" }, // Duplicate!
  ];

  console.log(`\n  Storing ${fileContents.length} files:`);

  const ids = new Set<string>();
  for (const { name, content: fileContent } of fileContents) {
    const id = await storeBlob(history, fileContent);
    const isDuplicate = ids.has(id);
    ids.add(id);
    console.log(
      `    ${name}: ${shortId(id)} ${isDuplicate ? "(duplicate - not stored again)" : ""}`,
    );
  }

  console.log(`\n  Total files: ${fileContents.length}`);
  console.log(`  Unique blobs stored: ${ids.size}`);
  console.log(`  Space saved: ${fileContents.length - ids.size} blob(s) deduplicated`);

  printSubsection("Why this matters");

  console.log(`\n  Benefits of content-addressable storage:`);
  console.log(`    1. Automatic deduplication across entire repository`);
  console.log(`    2. Efficient storage of similar files`);
  console.log(`    3. Fast comparison (same ID = same content)`);
  console.log(`    4. Integrity verification (hash as checksum)`);
  console.log(`    5. Efficient network transfer (send only unique objects)`);

  printSubsection("Practical implications");

  console.log(`\n  Common scenarios where deduplication helps:`);
  console.log(`    - License files copied across multiple directories`);
  console.log(`    - Template files`);
  console.log(`    - Reverted changes (restores reference to existing blob)`);
  console.log(`    - Renamed files (content unchanged, only tree entry changes)`);
  console.log(`    - Forked branches with shared history`);

  console.log("\nStep 5 completed!");
}

// Run standalone
if (import.meta.url === `file://${process.argv[1]}`) {
  printSection("Step 5: Deduplication");
  step05Deduplication()
    .then(() => console.log("\nDone!"))
    .catch((err) => {
      console.error("Error:", err);
      process.exit(1);
    });
}
