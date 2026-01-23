/**
 * Branch commands - branch, checkout
 */

import { isSymbolicRef, type SymbolicRef } from "@statewalker/vcs-core";
import { colorize, colors, dim, fatal, requireRepository, shortId, success } from "../shared.js";

/**
 * Run branch command
 */
export async function runBranch(args: string[]): Promise<void> {
  const ctx = await requireRepository();

  let listAll = false;
  let deleteMode = false;
  let renameMode = false;
  let verbose = false;
  const positional: string[] = [];

  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    if (arg === "-a" || arg === "--all") {
      listAll = true;
    } else if (arg === "-d" || arg === "--delete") {
      deleteMode = true;
    } else if (arg === "-m" || arg === "--move") {
      renameMode = true;
    } else if (arg === "-v" || arg === "--verbose") {
      verbose = true;
    } else if (!arg.startsWith("-")) {
      positional.push(arg);
    }
  }

  try {
    // Delete branch
    if (deleteMode) {
      if (positional.length === 0) {
        fatal("branch name required");
      }
      for (const branchName of positional) {
        await ctx.git.branchDelete().setBranchNames(branchName).call();
        console.log(success(`Deleted branch ${branchName}`));
      }
      return;
    }

    // Rename branch
    if (renameMode) {
      if (positional.length < 2) {
        fatal("branch rename requires old and new names");
      }
      const [oldName, newName] = positional;
      await ctx.git.branchRename().setOldName(oldName).setNewName(newName).call();
      console.log(success(`Renamed branch '${oldName}' to '${newName}'`));
      return;
    }

    // Create branch
    if (positional.length > 0) {
      const branchName = positional[0];
      const startPoint = positional[1];

      const cmd = ctx.git.branchCreate().setName(branchName);
      if (startPoint) {
        cmd.setStartPoint(startPoint);
      }
      await cmd.call();
      console.log(success(`Created branch '${branchName}'`));
      return;
    }

    // List branches
    const branches = await ctx.git.branchList().call();

    // Get current branch
    const headRef = await ctx.store.refs.resolve("HEAD");
    let currentBranch = "";
    if (headRef && isSymbolicRef(headRef)) {
      currentBranch = (headRef as SymbolicRef).target.replace("refs/heads/", "");
    }

    // Local branches
    const localBranches = branches.filter((b) => b.name.startsWith("refs/heads/"));
    const remoteBranches = branches.filter((b) => b.name.startsWith("refs/remotes/"));

    for (const branch of localBranches) {
      const name = branch.name.replace("refs/heads/", "");
      const isCurrent = name === currentBranch;
      const prefix = isCurrent ? "* " : "  ";
      const displayName = isCurrent ? colorize(name, colors.green, colors.bold) : name;

      if (verbose && branch.objectId) {
        console.log(`${prefix}${displayName} ${dim(shortId(branch.objectId))}`);
      } else {
        console.log(`${prefix}${displayName}`);
      }
    }

    // Remote branches (if -a flag)
    if (listAll && remoteBranches.length > 0) {
      for (const branch of remoteBranches) {
        const name = branch.name.replace("refs/", "");
        if (verbose && branch.objectId) {
          console.log(colorize(`  ${name} ${dim(shortId(branch.objectId))}`, colors.red));
        } else {
          console.log(colorize(`  ${name}`, colors.red));
        }
      }
    }
  } finally {
    await ctx.repository.close();
  }
}

/**
 * Run checkout command
 */
export async function runCheckout(args: string[]): Promise<void> {
  const ctx = await requireRepository();

  let createBranch = false;
  let target = "";

  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    if (arg === "-b") {
      createBranch = true;
    } else if (!arg.startsWith("-")) {
      target = arg;
    }
  }

  if (!target) {
    await ctx.repository.close();
    fatal("You need to specify a branch or commit to checkout.");
  }

  try {
    const cmd = ctx.git.checkout().setName(target);

    if (createBranch) {
      cmd.setCreateBranch(true);
    }

    const _result = await cmd.call();

    if (createBranch) {
      console.log(success(`Switched to a new branch '${target}'`));
    } else {
      console.log(success(`Switched to branch '${target}'`));
    }

    // Show head commit info
    const headCommit = await ctx.repository.getHead();
    if (headCommit) {
      console.log(dim(`HEAD is now at ${shortId(headCommit)}`));
    }
  } catch (err) {
    if (err instanceof Error && err.message.includes("not found")) {
      fatal(`pathspec '${target}' did not match any file(s) known to git`);
    }
    throw err;
  } finally {
    await ctx.repository.close();
  }
}
