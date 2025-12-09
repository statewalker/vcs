/**
 * Step 2: Create Files (Blobs)
 *
 * This step demonstrates storing file content as Git blobs.
 *
 * Key concepts:
 * - Blobs are content-addressable: identical content = identical ID
 * - Content is hashed (SHA-1) to produce the ObjectId
 * - Storage uses streaming (AsyncIterable) for memory efficiency
 * - Automatic deduplication - storing same content twice returns same ID
 *
 * @see packages/storage/src/object-storage.ts - ObjectStorage interface
 * @see packages/storage-git/src/git-object-storage.ts - Git implementation
 */

import {
  getStorage,
  printSection,
  printStep,
  printSubsection,
  readBlob,
  shortId,
  storeBlob,
} from "../shared/index.js";

// Sample file contents
export const FILES = {
  readme: `# My Project

Welcome to my project! This is version 1.

## Features

- Feature A
- Feature B
`,

  indexJs: `// Main entry point
export function main() {
  console.log("Hello, World!");
}

main();
`,

  packageJson: `{
  "name": "my-project",
  "version": "1.0.0",
  "type": "module",
  "main": "index.js"
}
`,
};

// Store file IDs for use in later steps
export const storedFiles: Record<string, string> = {};

export async function step02CreateFiles(): Promise<void> {
  printStep(2, "Create Files (Blobs)");

  const storage = await getStorage();

  printSubsection("Storing file contents as blobs");

  // Store each file
  storedFiles.readme = await storeBlob(storage, FILES.readme);
  storedFiles.indexJs = await storeBlob(storage, FILES.indexJs);
  storedFiles.packageJson = await storeBlob(storage, FILES.packageJson);

  console.log(`\n  Created blobs:`);
  console.log(`    README.md:     ${shortId(storedFiles.readme)}`);
  console.log(`    index.js:      ${shortId(storedFiles.indexJs)}`);
  console.log(`    package.json:  ${shortId(storedFiles.packageJson)}`);

  // Demonstrate content-addressable deduplication
  printSubsection("Demonstrating deduplication");

  const duplicateId = await storeBlob(storage, FILES.indexJs);

  console.log(`\n  Storing index.js content again:`);
  console.log(`    Original ID:  ${shortId(storedFiles.indexJs)}`);
  console.log(`    Duplicate ID: ${shortId(duplicateId)}`);
  console.log(`    Same ID:      ${storedFiles.indexJs === duplicateId}`);
  console.log(`\n  Identical content produces identical IDs - automatic deduplication!`);

  // Demonstrate reading content back
  printSubsection("Reading blob content");

  const readmeContent = await readBlob(storage, storedFiles.readme);
  console.log(`\n  README.md content (first 50 chars):`);
  console.log(`    "${readmeContent.substring(0, 50)}..."`);

  // Demonstrate object info
  printSubsection("Getting object metadata");

  const size = await storage.objects.getSize(storedFiles.readme);
  console.log(`\n  README.md object info:`);
  console.log(`    ID:   ${storedFiles.readme}`);
  console.log(`    Size: ${size} bytes`);

  // Show how blobs are stored internally
  console.log(`\n  Note: Blobs are stored with zlib compression in .git/objects/`);
  console.log(`  The path is derived from the ID: objects/XX/YYYYYYYY...`);
  console.log(`  For ID ${shortId(storedFiles.readme)}...:`);
  console.log(
    `    Path: objects/${storedFiles.readme.substring(0, 2)}/${storedFiles.readme.substring(2)}`,
  );
}

// Run standalone
if (import.meta.url === `file://${process.argv[1]}`) {
  printSection("Step 2: Create Files (Blobs)");
  step02CreateFiles()
    .then(() => console.log("\n  Done!"))
    .catch((err) => {
      console.error("Error:", err);
      process.exit(1);
    });
}
