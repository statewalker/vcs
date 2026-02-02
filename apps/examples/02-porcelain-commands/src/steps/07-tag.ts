/**
 * Step 7: Tags
 *
 * Demonstrates creating and listing tags.
 */

import { addFileToStaging, getGit, printSection, printStep, shortId } from "../shared.js";

export async function step07Tag(): Promise<void> {
  printStep(7, "Tags");

  const { git, workingCopy, history } = await getGit();

  // Ensure we have a commit
  const head = await history.refs.resolve("HEAD");
  if (!head?.objectId) {
    await addFileToStaging(workingCopy, "README.md", "# Project v1.0.0");
    await git.commit().setMessage("Initial release").call();
  }

  // Create a lightweight tag
  console.log("\nCreating lightweight tag 'v1.0.0'...");
  await git.tag().setName("v1.0.0").call();
  console.log("  Tag 'v1.0.0' created");

  // Create another tag
  console.log("\nCreating tag 'v1.1.0-beta'...");
  await git.tag().setName("v1.1.0-beta").call();
  console.log("  Tag 'v1.1.0-beta' created");

  // Create an annotated tag
  console.log("\nCreating annotated tag 'v2.0.0'...");
  await git
    .tag()
    .setName("v2.0.0")
    .setAnnotated(true)
    .setMessage("Major version 2.0.0 release")
    .call();
  console.log("  Annotated tag 'v2.0.0' created");

  // List all tags
  console.log("\nListing tags with git.tagList()...");
  const tags = await git.tagList().call();

  console.log("\nTags:");
  for (const tag of tags) {
    console.log(`  - ${tag.name}`);
    if (tag.objectId) {
      console.log(`    Points to: ${shortId(tag.objectId)}`);
    }
  }

  // Delete a tag
  console.log("\nDeleting tag 'v1.1.0-beta'...");
  await git.tagDelete().setTags("v1.1.0-beta").call();
  console.log("  Tag 'v1.1.0-beta' deleted");

  // List remaining tags
  console.log("\nRemaining tags:");
  const remainingTags = await git.tagList().call();
  for (const tag of remainingTags) {
    console.log(`  - ${tag.name}`);
  }

  console.log("\nStep 7 completed!");
}

// Run standalone
if (import.meta.url === `file://${process.argv[1]}`) {
  printSection("Step 7: Tags");
  step07Tag()
    .then(() => console.log("\nDone!"))
    .catch((err) => {
      console.error("Error:", err);
      process.exit(1);
    });
}
