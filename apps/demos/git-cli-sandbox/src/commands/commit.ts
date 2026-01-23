/**
 * Commit command - Create a commit
 */

import { isSymbolicRef, type SymbolicRef } from "@statewalker/vcs-core";
import { dim, fatal, getDefaultAuthor, requireRepository, shortId, success } from "../shared.js";

/**
 * Parse commit command arguments
 */
function parseArgs(args: string[]): {
  message?: string;
  author?: string;
  allowEmpty: boolean;
  amend: boolean;
} {
  let message: string | undefined;
  let author: string | undefined;
  let allowEmpty = false;
  let amend = false;

  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    if (arg === "-m" || arg === "--message") {
      message = args[++i];
    } else if (arg === "--author") {
      author = args[++i];
    } else if (arg === "--allow-empty") {
      allowEmpty = true;
    } else if (arg === "--amend") {
      amend = true;
    } else if (arg.startsWith("-m")) {
      // Handle -m"message" format
      message = arg.slice(2);
    }
  }

  return { message, author, allowEmpty, amend };
}

/**
 * Parse author string "Name <email>"
 */
function parseAuthorString(authorStr: string): { name: string; email: string } | null {
  const match = authorStr.match(/^(.+?)\s*<(.+)>$/);
  if (match) {
    return { name: match[1].trim(), email: match[2].trim() };
  }
  return null;
}

/**
 * Run commit command
 */
export async function runCommit(args: string[]): Promise<void> {
  const ctx = await requireRepository();

  const { message, author: authorStr, allowEmpty, amend } = parseArgs(args);

  if (!message) {
    await ctx.repository.close();
    fatal("Aborting commit due to empty commit message.");
  }

  try {
    const cmd = ctx.git.commit().setMessage(message);

    // Set author
    let authorInfo = getDefaultAuthor();
    if (authorStr) {
      const parsed = parseAuthorString(authorStr);
      if (parsed) {
        authorInfo = parsed;
      }
    }
    cmd.setAuthor(authorInfo.name, authorInfo.email);
    cmd.setCommitter(authorInfo.name, authorInfo.email);

    if (allowEmpty) {
      cmd.setAllowEmpty(true);
    }

    if (amend) {
      cmd.setAmend(true);
    }

    const result = await cmd.call();

    // Get branch name
    const headRef = await ctx.store.refs.resolve("HEAD");
    let branchName = "HEAD";
    if (headRef && isSymbolicRef(headRef)) {
      branchName = (headRef as SymbolicRef).target.replace("refs/heads/", "");
    }

    // Count files changed
    const status = await ctx.git.status().call();
    const filesChanged = status.added.size + status.changed.size + status.removed.size;

    console.log(`[${branchName} ${shortId(result.id)}] ${message.split("\n")[0]}`);
    console.log(dim(` ${filesChanged} file(s) changed`));
    console.log(success(`\nCommit created: ${shortId(result.id)}`));
  } finally {
    await ctx.repository.close();
  }
}
