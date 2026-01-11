/**
 * Step 1: Blob Storage
 *
 * Demonstrates how Git stores file content as blobs.
 * Blobs are content-addressable: the SHA-1 hash of the content becomes the ID.
 */

import {
  getRepository,
  printSection,
  printStep,
  printSubsection,
  readBlob,
  shortId,
  storeBlob,
} from "../shared.js";

export async function step01BlobStorage(): Promise<void> {
  printStep(1, "Blob Storage");

  const { repository } = await getRepository();

  printSubsection("Storing content as a blob");

  const content = "Hello, World! This is my first blob.";
  const blobId = await storeBlob(repository, content);

  console.log(`\n  Content: "${content}"`);
  console.log(`  Blob ID: ${blobId}`);
  console.log(`  Short ID: ${shortId(blobId)}`);

  printSubsection("Understanding the ID");

  console.log(`\n  The blob ID is a SHA-1 hash of the content.`);
  console.log(`  Git prefixes the content with "blob {size}\\0" before hashing.`);
  console.log(`  This creates a unique identifier based on content.`);

  printSubsection("Reading blob content back");

  const retrieved = await readBlob(repository, blobId);
  console.log(`\n  Retrieved content: "${retrieved}"`);
  console.log(`  Content matches: ${content === retrieved}`);

  printSubsection("Getting object metadata");

  const header = await repository.objects.getHeader(blobId);
  console.log(`\n  Object type: ${header.type}`);
  console.log(`  Object size: ${header.size} bytes`);

  printSubsection("Storage path");

  console.log(`\n  In Git's loose object storage, objects are stored at:`);
  console.log(`    .git/objects/{first 2 chars}/{remaining 38 chars}`);
  console.log(`\n  For ID ${shortId(blobId)}...:`);
  console.log(`    Path: .git/objects/${blobId.slice(0, 2)}/${blobId.slice(2)}`);

  console.log("\nStep 1 completed!");
}

// Run standalone
if (import.meta.url === `file://${process.argv[1]}`) {
  printSection("Step 1: Blob Storage");
  step01BlobStorage()
    .then(() => console.log("\nDone!"))
    .catch((err) => {
      console.error("Error:", err);
      process.exit(1);
    });
}
