#!/usr/bin/env node

/**
 * Git CLI Sandbox - A command-line interface using VCS porcelain API
 *
 * This sandbox provides basic git commands via CLI using the VCS library:
 * - clone: Clone repositories via HTTP protocol
 * - init: Initialize a new repository
 * - add: Stage files
 * - status: Show working tree status
 * - commit: Create commits
 * - branch: List, create, delete branches
 * - checkout: Switch branches or restore files
 * - merge: Merge branches
 * - log: Show commit history
 * - diff: Show changes
 * - remote: Manage remotes
 * - fetch: Download objects from remote
 * - pull: Fetch and merge
 * - push: Push to remote
 *
 * Usage: pnpm git <command> [options]
 * Example: pnpm git clone https://github.com/user/repo
 */

import { runBranch, runCheckout } from "./commands/branch.js";
import { runClone } from "./commands/clone.js";
import { runCommit } from "./commands/commit.js";
import { runDiff, runLog } from "./commands/history.js";
// Command imports
import { runInit } from "./commands/init.js";
import { runMerge } from "./commands/merge.js";
import { runFetch, runPull, runPush, runRemote } from "./commands/remote.js";
import { runAdd, runRm, runStatus } from "./commands/staging.js";
import { bold, dim, fatal } from "./shared.js";

interface CommandInfo {
  description: string;
  usage: string;
  run: (args: string[]) => Promise<void>;
}

const commands: Record<string, CommandInfo> = {
  init: {
    description: "Create an empty Git repository",
    usage: "init [directory] [--bare]",
    run: runInit,
  },
  clone: {
    description: "Clone a repository via HTTP",
    usage: "clone <url> [directory] [--branch <name>] [--depth <n>]",
    run: runClone,
  },
  add: {
    description: "Add file contents to the index",
    usage: "add <pathspec>... [-u]",
    run: runAdd,
  },
  status: {
    description: "Show the working tree status",
    usage: "status",
    run: runStatus,
  },
  rm: {
    description: "Remove files from the working tree and index",
    usage: "rm <file>... [--cached]",
    run: runRm,
  },
  commit: {
    description: "Record changes to the repository",
    usage: "commit -m <message> [--author <name>]",
    run: runCommit,
  },
  branch: {
    description: "List, create, or delete branches",
    usage: "branch [name] [-d <branch>] [-m <old> <new>] [-a]",
    run: runBranch,
  },
  checkout: {
    description: "Switch branches or restore files",
    usage: "checkout <branch> [-b <new-branch>]",
    run: runCheckout,
  },
  merge: {
    description: "Join two development histories together",
    usage: "merge <branch> [--no-ff] [--squash]",
    run: runMerge,
  },
  log: {
    description: "Show commit logs",
    usage: "log [-n <number>] [--oneline]",
    run: runLog,
  },
  diff: {
    description: "Show changes between commits",
    usage: "diff [<commit>] [<commit>]",
    run: runDiff,
  },
  remote: {
    description: "Manage remote repositories",
    usage: "remote [-v] | remote add <name> <url> | remote remove <name>",
    run: runRemote,
  },
  fetch: {
    description: "Download objects from remote repository",
    usage: "fetch [remote]",
    run: runFetch,
  },
  pull: {
    description: "Fetch and integrate remote changes",
    usage: "pull [remote] [branch]",
    run: runPull,
  },
  push: {
    description: "Update remote refs",
    usage: "push [remote] [branch] [-f]",
    run: runPush,
  },
};

function printHelp(): void {
  console.log(`
${bold("VCS Git CLI Sandbox")}
${dim("A Git implementation using @statewalker/vcs-commands porcelain API")}

${bold("Usage:")} vcs-git <command> [options]

${bold("Commands:")}
`);

  const maxCmdLen = Math.max(...Object.keys(commands).map((c) => c.length));

  for (const [name, info] of Object.entries(commands)) {
    console.log(`  ${name.padEnd(maxCmdLen + 2)} ${dim(info.description)}`);
  }

  console.log(`
${bold("Examples:")}
  vcs-git init                              # Initialize new repository
  vcs-git clone https://github.com/user/repo  # Clone via HTTP
  vcs-git add .                             # Stage all files
  vcs-git commit -m "Initial commit"        # Create commit
  vcs-git branch feature                    # Create branch
  vcs-git checkout feature                  # Switch to branch
  vcs-git merge feature                     # Merge branch
  vcs-git push origin main                  # Push to remote

Run ${bold("vcs-git <command> --help")} for more information on a command.
`);
}

function printCommandHelp(_cmdName: string, info: CommandInfo): void {
  console.log(`
${bold("Usage:")} vcs-git ${info.usage}

${info.description}
`);
}

async function main(): Promise<void> {
  const args = process.argv.slice(2);

  if (args.length === 0 || args[0] === "--help" || args[0] === "-h") {
    printHelp();
    return;
  }

  const cmdName = args[0];
  const cmdArgs = args.slice(1);

  // Check for command-level help
  if (cmdArgs.includes("--help") || cmdArgs.includes("-h")) {
    const cmd = commands[cmdName];
    if (cmd) {
      printCommandHelp(cmdName, cmd);
      return;
    }
  }

  const cmd = commands[cmdName];
  if (!cmd) {
    console.error(`vcs-git: '${cmdName}' is not a command. See 'vcs-git --help'.`);
    process.exit(1);
  }

  try {
    await cmd.run(cmdArgs);
  } catch (err) {
    if (err instanceof Error && err.message.startsWith("fatal:")) {
      console.error(err.message);
    } else {
      fatal(err instanceof Error ? err.message : String(err));
    }
    process.exit(1);
  }
}

main().catch((err) => {
  console.error("Unexpected error:", err);
  process.exit(1);
});
