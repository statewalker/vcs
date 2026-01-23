/**
 * Init command - Create a new Git repository
 */

import * as fs from "node:fs/promises";
import * as path from "node:path";
import { fatal, info, initRepository, success } from "../shared.js";

/**
 * Parse init command arguments
 */
function parseArgs(args: string[]): { directory: string; bare: boolean } {
  let directory = ".";
  let bare = false;

  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    if (arg === "--bare") {
      bare = true;
    } else if (!arg.startsWith("-")) {
      directory = arg;
    }
  }

  return { directory, bare };
}

/**
 * Run init command
 */
export async function runInit(args: string[]): Promise<void> {
  const { directory, bare } = parseArgs(args);

  const absDir = path.resolve(process.cwd(), directory);

  // Create directory if it doesn't exist
  await fs.mkdir(absDir, { recursive: true });

  // Check if already a repository
  const gitDir = path.join(absDir, bare ? "." : ".git");
  try {
    await fs.access(path.join(absDir, ".git"));
    fatal(`Reinitialized existing Git repository in ${gitDir}/`);
  } catch {
    // Good - not a repository yet
  }

  const ctx = await initRepository(absDir, { bare });

  if (bare) {
    console.log(success(`Initialized empty Git repository in ${absDir}/`));
  } else {
    console.log(success(`Initialized empty Git repository in ${gitDir}/`));
  }

  // Show hint for first-time users
  console.log(info("\nNext steps:"));
  console.log("  Create files and add them with: vcs-git add <file>");
  console.log('  Commit changes with: vcs-git commit -m "Initial commit"');

  await ctx.repository.close();
}
