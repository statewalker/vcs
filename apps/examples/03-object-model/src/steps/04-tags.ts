/**
 * Step 4: Tags
 *
 * Demonstrates the difference between lightweight and annotated tags.
 * Lightweight tags are just refs; annotated tags are objects.
 */

import { ObjectType } from "@statewalker/vcs-core";
import {
  FileMode,
  getHistory,
  printSection,
  printStep,
  printSubsection,
  shortId,
  storeBlob,
} from "../shared.js";

export async function step04Tags(): Promise<void> {
  printStep(4, "Tags");

  const { history } = await getHistory();

  // Ensure we have a commit
  let headRef = await history.refs.resolve("refs/heads/main");
  if (!headRef?.objectId) {
    const blobId = await storeBlob(history, "# Project v1.0");
    const treeId = await history.trees.store([
      { mode: FileMode.REGULAR_FILE, name: "README.md", id: blobId },
    ]);
    const now = Date.now() / 1000;
    const commitId = await history.commits.store({
      tree: treeId,
      parents: [],
      author: { name: "Dev", email: "dev@example.com", timestamp: now, tzOffset: "+0000" },
      committer: { name: "Dev", email: "dev@example.com", timestamp: now, tzOffset: "+0000" },
      message: "Release v1.0",
    });
    await history.refs.set("refs/heads/main", commitId);
    headRef = await history.refs.resolve("refs/heads/main");
  }

  const commitId = headRef?.objectId ?? "";

  printSubsection("Lightweight tags");

  console.log(`\n  Lightweight tags are just references (refs) pointing to commits.`);
  console.log(`  They're stored in .git/refs/tags/{name}`);

  // Create lightweight tag
  await history.refs.set("refs/tags/v1.0.0", commitId);

  const v1Tag = await history.refs.resolve("refs/tags/v1.0.0");
  console.log(`\n  Created lightweight tag 'v1.0.0':`);
  console.log(`    refs/tags/v1.0.0 -> ${shortId(v1Tag?.objectId ?? "")}`);
  console.log(`    (points directly to the commit)`);

  printSubsection("Annotated tags");

  console.log(`\n  Annotated tags are actual Git objects with metadata.`);
  console.log(`  They contain: object reference, tagger info, and message.`);

  const now = Date.now() / 1000;
  const tagId = await history.tags.store({
    object: commitId,
    objectType: ObjectType.COMMIT,
    tag: "v2.0.0",
    tagger: {
      name: "Release Manager",
      email: "release@example.com",
      timestamp: now,
      tzOffset: "+0000",
    },
    message: "Version 2.0.0 release\n\nThis is a major version with breaking changes.",
  });

  console.log(`\n  Created annotated tag 'v2.0.0':`);
  console.log(`    Tag object ID: ${shortId(tagId)}`);
  console.log(`    Points to commit: ${shortId(commitId)}`);

  // Update ref to point to tag object
  await history.refs.set("refs/tags/v2.0.0", tagId);

  // Load and display tag object
  const tag = await history.tags.load(tagId);
  if (!tag) {
    throw new Error(`Tag not found: ${tagId}`);
  }
  console.log(`\n  Tag object contents:`);
  console.log(`    object: ${shortId(tag.object)}`);
  console.log(
    `    objectType: ${tag.objectType} (${tag.objectType === ObjectType.COMMIT ? "commit" : "other"})`,
  );
  console.log(`    tag: ${tag.tag}`);
  console.log(`    tagger: ${tag.tagger?.name} <${tag.tagger?.email}>`);
  console.log(`    message: ${tag.message.split("\n")[0]}`);

  printSubsection("Resolving tags");

  console.log(`\n  Both types of tags resolve to the same commit:`);

  const lightweight = await history.refs.resolve("refs/tags/v1.0.0");
  console.log(`    v1.0.0 (lightweight): ${shortId(lightweight?.objectId ?? "")}`);

  // For annotated tag, we need to follow the tag object to the commit
  const annotated = await history.refs.resolve("refs/tags/v2.0.0");
  console.log(`    v2.0.0 (annotated tag object): ${shortId(annotated?.objectId ?? "")}`);
  console.log(`    v2.0.0 (target commit): ${shortId(tag.object)}`);

  printSubsection("When to use each type");

  console.log(`\n  Lightweight tags:`);
  console.log(`    - Quick bookmarks`);
  console.log(`    - Private/temporary markers`);
  console.log(`    - No metadata needed`);

  console.log(`\n  Annotated tags:`);
  console.log(`    - Release versions`);
  console.log(`    - Need tagger attribution`);
  console.log(`    - Need release notes/message`);
  console.log(`    - Can be GPG signed`);

  console.log("\nStep 4 completed!");
}

// Run standalone
if (import.meta.url === `file://${process.argv[1]}`) {
  printSection("Step 4: Tags");
  step04Tags()
    .then(() => console.log("\nDone!"))
    .catch((err) => {
      console.error("Error:", err);
      process.exit(1);
    });
}
