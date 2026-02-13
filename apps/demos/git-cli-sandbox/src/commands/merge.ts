/**
 * Merge command - Merge branches
 */

import { FastForwardMode, MergeStatus } from "@statewalker/vcs-commands";
import { isSymbolicRef, type SymbolicRef } from "@statewalker/vcs-core";
import { error, fatal, requireRepository, shortId, success, warning } from "../shared.js";

/**
 * Parse merge command arguments
 */
function parseArgs(args: string[]): {
  branch?: string;
  noFf: boolean;
  squash: boolean;
  message?: string;
} {
  let branch: string | undefined;
  let noFf = false;
  let squash = false;
  let message: string | undefined;

  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    if (arg === "--no-ff") {
      noFf = true;
    } else if (arg === "--squash") {
      squash = true;
    } else if (arg === "-m" || arg === "--message") {
      message = args[++i];
    } else if (!arg.startsWith("-")) {
      branch = arg;
    }
  }

  return { branch, noFf, squash, message };
}

/**
 * Run merge command
 */
export async function runMerge(args: string[]): Promise<void> {
  const ctx = await requireRepository();

  const { branch, noFf, squash, message } = parseArgs(args);

  if (!branch) {
    await ctx.repository.close();
    fatal("No branch specified for merge.");
  }

  try {
    // Resolve branch to commit ID
    const branchRef = await ctx.store.refs.resolve(`refs/heads/${branch}`);
    if (!branchRef || !branchRef.objectId) {
      fatal(`merge: ${branch} - not something we can merge`);
    }

    const cmd = ctx.git.merge().include(branch);

    if (noFf) {
      cmd.setFastForwardMode(FastForwardMode.NO_FF);
    }

    if (squash) {
      cmd.setSquash(true);
    }

    if (message) {
      cmd.setMessage(message);
    }

    const result = await cmd.call();

    // Get current branch name
    const headRef = await ctx.store.refs.resolve("HEAD");
    let _currentBranch = "HEAD";
    if (headRef && isSymbolicRef(headRef)) {
      _currentBranch = (headRef as SymbolicRef).target.replace("refs/heads/", "");
    }

    switch (result.status) {
      case MergeStatus.ALREADY_UP_TO_DATE:
        console.log("Already up to date.");
        break;

      case MergeStatus.FAST_FORWARD:
        console.log(
          `Updating ${shortId(result.mergeBase || "")}..${shortId(result.newHead || "")}`,
        );
        console.log("Fast-forward");
        console.log(success(`Merge completed (fast-forward)`));
        break;

      case MergeStatus.MERGED:
        console.log(`Merge made by the 'ort' strategy.`);
        if (result.newHead) {
          console.log(success(`Merged commit: ${shortId(result.newHead)}`));
        }
        break;

      case MergeStatus.CONFLICTING:
        console.log(warning("Automatic merge failed; fix conflicts and then commit the result."));
        if (result.conflicts && result.conflicts.length > 0) {
          console.log("\nConflicting files:");
          for (const conflict of result.conflicts) {
            console.log(error(`  ${conflict}`));
          }
        }
        break;

      case MergeStatus.FAILED:
        console.log(error("Merge failed"));
        if (result.failingPaths && result.failingPaths.size > 0) {
          for (const [path, reason] of result.failingPaths) {
            console.log(error(`  ${path}: ${reason}`));
          }
        }
        break;

      case MergeStatus.ABORTED:
        console.log(warning("Merge aborted"));
        break;

      default:
        console.log(success(`Merge completed`));
    }
  } finally {
    await ctx.repository.close();
  }
}
