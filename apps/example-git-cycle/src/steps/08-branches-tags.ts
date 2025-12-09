/**
 * Step 8: Working with Branches and Tags
 *
 * This step demonstrates reference management for branches and tags.
 *
 * Key concepts:
 * - Branches are refs in refs/heads/
 * - Tags are refs in refs/tags/ (lightweight) or tag objects (annotated)
 * - HEAD is a symbolic ref pointing to the current branch
 * - Switching branches = updating HEAD
 *
 * @see packages/storage-git/src/git-ref-storage.ts - GitRefStorage class
 * @see packages/storage/src/ref-storage.ts - RefStorage interface
 * @see packages/storage-git/src/refs/ref-types.ts - Ref, SymbolicRef types
 * @see packages/storage/src/tag-storage.ts - TagStorage for annotated tags
 */

import {
  createAuthor,
  FileMode,
  getStorage,
  ObjectType,
  printSection,
  printStep,
  printSubsection,
  shortId,
  storeBlob,
} from "../shared/index.js";
import { storedCommits } from "./04-create-commits.js";

export async function step08BranchesTags(): Promise<void> {
  printStep(8, "Working with Branches and Tags");

  const storage = await getStorage();

  // Ensure we have commits
  if (!storedCommits.commit1) {
    console.log("  Note: Running previous steps to create commits...\n");
    const { step02CreateFiles } = await import("./02-create-files.js");
    const { step03BuildTrees } = await import("./03-build-trees.js");
    const { step04CreateCommits } = await import("./04-create-commits.js");
    const { step05UpdateFiles } = await import("./05-update-files.js");
    await step02CreateFiles();
    await step03BuildTrees();
    await step04CreateCommits();
    await step05UpdateFiles();
  }

  printSubsection("Current branch state");

  const currentBranch = await storage.getCurrentBranch();
  const headId = await storage.getHead();

  if (!headId) {
    console.log("\n  No HEAD found - repository may be empty");
    return;
  }

  console.log(`\n  Current branch: ${currentBranch}`);
  console.log(`  HEAD commit: ${shortId(headId)}`);

  // Show HEAD symbolic ref
  const head = await storage.refs.get("HEAD");
  console.log(`\n  HEAD reference details:`);
  if (head && "target" in head) {
    console.log(`    Type: symbolic ref`);
    console.log(`    Target: ${head.target}`);
  } else if (head && "objectId" in head && head.objectId) {
    console.log(`    Type: direct ref`);
    console.log(`    ObjectId: ${shortId(head.objectId)}`);
  } else {
    console.log(`    HEAD not found`);
  }

  printSubsection("Creating a new branch");

  // Create branch from commit2
  const branchPoint = storedCommits.commit2 || storedCommits.commit1;
  await storage.refs.set("refs/heads/feature", branchPoint);

  console.log(`\n  Created branch 'feature' at ${shortId(branchPoint)}`);

  // List all branches
  console.log(`\n  All branches:`);
  for await (const branch of storage.refs.list("refs/heads/")) {
    if ("objectId" in branch) {
      const name = branch.name.replace("refs/heads/", "");
      const isCurrent = name === currentBranch;
      const marker = isCurrent ? "*" : " ";
      const branchId = branch.objectId ?? "(unknown)";
      console.log(`    ${marker} ${name.padEnd(12)} -> ${shortId(branchId)}`);
    }
  }

  printSubsection("Switching branches");

  // Switch to feature branch
  await storage.refs.setSymbolic("HEAD", "refs/heads/feature");
  const featureBranchHead = await storage.getHead();
  console.log(`\n  Switched to branch: ${await storage.getCurrentBranch()}`);
  console.log(`  HEAD now at: ${shortId(featureBranchHead ?? "(unknown)")}`);

  // Make a commit on feature branch
  const featureBlob = await storeBlob(storage, "# Feature\n\nNew feature code");
  const featureTree = await storage.trees.storeTree([
    { mode: FileMode.REGULAR_FILE, name: "FEATURE.md", id: featureBlob },
  ]);

  const featureCommit = await storage.commits.storeCommit({
    tree: featureTree,
    parents: [branchPoint],
    author: createAuthor("Feature Dev", "feature@example.com", 5),
    committer: createAuthor("Feature Dev", "feature@example.com", 5),
    message: "Add feature documentation",
  });

  await storage.refs.set("refs/heads/feature", featureCommit);
  console.log(`\n  Made commit on feature branch: ${shortId(featureCommit)}`);

  // Switch back to main
  await storage.refs.setSymbolic("HEAD", "refs/heads/main");
  console.log(`  Switched back to: ${await storage.getCurrentBranch()}`);

  // Show branch divergence
  console.log(`\n  Branch state after divergence:`);
  const mainHead = await storage.refs.resolve("refs/heads/main");
  const featureHeadRef = await storage.refs.resolve("refs/heads/feature");
  console.log(`    main:    ${shortId(mainHead?.objectId ?? "(unknown)")}`);
  console.log(`    feature: ${shortId(featureHeadRef?.objectId ?? "(unknown)")}`);

  printSubsection("Creating lightweight tags");

  // Lightweight tag = just a ref
  await storage.refs.set("refs/tags/v1.0.0", storedCommits.commit1);
  console.log(`\n  Created lightweight tag 'v1.0.0' at ${shortId(storedCommits.commit1)}`);

  await storage.refs.set("refs/tags/v1.1.0", storedCommits.commit2 || storedCommits.commit1);
  console.log(`  Created lightweight tag 'v1.1.0'`);

  printSubsection("Creating annotated tags");

  // Annotated tag = tag object + ref
  const tagId = await storage.tags.storeTag({
    object: headId,
    objectType: ObjectType.COMMIT,
    tag: "v2.0.0",
    tagger: createAuthor("Release Manager", "release@example.com", 6),
    message: "Release version 2.0.0\n\nMajor update with new features and improvements.",
  });

  await storage.refs.set("refs/tags/v2.0.0", tagId);

  console.log(`\n  Created annotated tag 'v2.0.0':`);
  console.log(`    Tag object:    ${shortId(tagId)}`);
  console.log(`    Points to:     ${shortId(headId)}`);

  // Load and display tag
  const tag = await storage.tags.loadTag(tagId);
  console.log(`    Tag name:      ${tag.tag}`);
  console.log(`    Tagger:        ${tag.tagger?.name}`);
  console.log(`    Message:       ${tag.message.split("\n")[0]}`);

  printSubsection("Listing all tags");

  console.log(`\n  All tags:`);
  for await (const tagRef of storage.refs.list("refs/tags/")) {
    if ("objectId" in tagRef) {
      const name = tagRef.name.replace("refs/tags/", "");
      const tagRefId = tagRef.objectId;

      if (!tagRefId) {
        console.log(`    ${name.padEnd(10)} -> (unknown)`);
        continue;
      }

      // Try to load as annotated tag
      try {
        const tagObj = await storage.tags.loadTag(tagRefId);
        console.log(
          `    ${name.padEnd(10)} -> ${shortId(tagRefId)} (annotated, points to ${shortId(tagObj.object)})`,
        );
      } catch {
        // Lightweight tag - ref points directly to commit
        console.log(`    ${name.padEnd(10)} -> ${shortId(tagRefId)} (lightweight)`);
      }
    }
  }

  printSubsection("Reference resolution");

  console.log(`\n  Resolving different references:`);

  const toResolve = ["HEAD", "refs/heads/main", "refs/heads/feature", "refs/tags/v1.0.0"];

  for (const refName of toResolve) {
    const resolved = await storage.refs.resolve(refName);
    if (resolved?.objectId) {
      console.log(`    ${refName.padEnd(20)} -> ${shortId(resolved.objectId)}`);
    } else {
      console.log(`    ${refName.padEnd(20)} -> (not found)`);
    }
  }

  printSubsection("Deleting branches");

  // Delete feature branch
  const deleted = await storage.refs.delete("refs/heads/feature");
  console.log(`\n  Deleted branch 'feature': ${deleted}`);

  // Verify deletion
  const featureExists = await storage.refs.has("refs/heads/feature");
  console.log(`  Branch 'feature' exists: ${featureExists}`);

  // List remaining branches
  console.log(`\n  Remaining branches:`);
  for await (const branch of storage.refs.list("refs/heads/")) {
    if ("objectId" in branch) {
      const name = branch.name.replace("refs/heads/", "");
      console.log(`    ${name}`);
    }
  }

  printSubsection("Summary");

  console.log(`
  Branch and Tag Operations:

  Branches:
    storage.refs.set("refs/heads/name", commitId)      - Create/update
    storage.refs.setSymbolic("HEAD", "refs/heads/...")  - Switch branch
    storage.refs.list("refs/heads/")                    - List branches
    storage.refs.delete("refs/heads/name")              - Delete branch

  Tags:
    Lightweight: storage.refs.set("refs/tags/name", commitId)
    Annotated:   storage.tags.storeTag({ ... }) + refs.set()
    List:        storage.refs.list("refs/tags/")

  Resolution:
    storage.refs.resolve(refName)      - Follow symrefs to commit
    storage.refs.get(refName)          - Get ref without following
    storage.refs.has(refName)          - Check existence

  Special refs:
    HEAD               - Current commit/branch
    refs/heads/*       - Branches
    refs/tags/*        - Tags
    refs/remotes/*     - Remote tracking branches
`);
}

// Run standalone
if (import.meta.url === `file://${process.argv[1]}`) {
  printSection("Step 8: Working with Branches and Tags");
  step08BranchesTags()
    .then(() => console.log("\n  Done!"))
    .catch((err) => {
      console.error("Error:", err);
      process.exit(1);
    });
}
