/**
 * History commands - log, diff
 */

import { ChangeType } from "@statewalker/vcs-commands";
import {
  bold,
  colorize,
  colors,
  dim,
  formatAuthor,
  formatDate,
  requireRepository,
  shortId,
} from "../shared.js";

/**
 * Parse log command arguments
 */
function parseLogArgs(args: string[]): {
  maxCount: number;
  oneline: boolean;
  all: boolean;
  graph: boolean;
} {
  let maxCount = 10;
  let oneline = false;
  let all = false;
  let graph = false;

  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    if (arg === "-n" || arg === "--max-count") {
      maxCount = parseInt(args[++i], 10);
    } else if (arg.startsWith("-n") && arg.length > 2) {
      maxCount = parseInt(arg.slice(2), 10);
    } else if (arg === "--oneline") {
      oneline = true;
    } else if (arg === "--all") {
      all = true;
    } else if (arg === "--graph") {
      graph = true;
    }
  }

  return { maxCount, oneline, all, graph };
}

/**
 * Run log command
 */
export async function runLog(args: string[]): Promise<void> {
  const ctx = await requireRepository();

  const { maxCount, oneline, all, graph: _graph } = parseLogArgs(args);

  try {
    const cmd = ctx.git.log().setMaxCount(maxCount);

    if (all) {
      cmd.all();
    }

    const commits = await cmd.call();

    let count = 0;
    for await (const commit of commits) {
      if (count >= maxCount) break;
      count++;

      if (oneline) {
        const shortHash = colorize(shortId(commit.id), colors.yellow);
        const message = commit.message.split("\n")[0];
        console.log(`${shortHash} ${message}`);
      } else {
        console.log(colorize(`commit ${commit.id}`, colors.yellow));

        if (commit.parents.length > 1) {
          console.log(`Merge: ${commit.parents.map((p) => shortId(p)).join(" ")}`);
        }

        console.log(`Author: ${formatAuthor(commit.author.name, commit.author.email)}`);
        console.log(`Date:   ${formatDate(commit.author.timestamp)}`);
        console.log();

        // Indent message
        const lines = commit.message.split("\n");
        for (const line of lines) {
          console.log(`    ${line}`);
        }
        console.log();
      }
    }

    if (count === 0) {
      console.log(dim("No commits yet"));
    }
  } finally {
    await ctx.repository.close();
  }
}

/**
 * Parse diff command arguments
 */
function parseDiffArgs(args: string[]): {
  oldTree?: string;
  newTree?: string;
  cached: boolean;
  stat: boolean;
} {
  let oldTree: string | undefined;
  let newTree: string | undefined;
  let cached = false;
  let stat = false;

  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    if (arg === "--cached" || arg === "--staged") {
      cached = true;
    } else if (arg === "--stat") {
      stat = true;
    } else if (!arg.startsWith("-")) {
      if (!oldTree) {
        oldTree = arg;
      } else if (!newTree) {
        newTree = arg;
      }
    }
  }

  return { oldTree, newTree, cached, stat };
}

/**
 * Format diff change type
 */
function formatChangeType(type: ChangeType): string {
  switch (type) {
    case ChangeType.ADD:
      return colorize("A", colors.green);
    case ChangeType.DELETE:
      return colorize("D", colors.red);
    case ChangeType.MODIFY:
      return colorize("M", colors.yellow);
    case ChangeType.RENAME:
      return colorize("R", colors.cyan);
    case ChangeType.COPY:
      return colorize("C", colors.cyan);
    default:
      return "?";
  }
}

/**
 * Run diff command
 */
export async function runDiff(args: string[]): Promise<void> {
  const ctx = await requireRepository();

  const { oldTree, newTree, cached, stat } = parseDiffArgs(args);

  try {
    const cmd = ctx.git.diff();

    if (oldTree) {
      cmd.setOldTree(oldTree);
    }

    if (newTree) {
      cmd.setNewTree(newTree);
    }

    if (cached) {
      cmd.setCached(true);
    }

    const entries = await cmd.call();

    if (entries.length === 0) {
      console.log(dim("No changes"));
      return;
    }

    if (stat) {
      // Show stat summary
      const _additions = 0;
      const _deletions = 0;

      for (const entry of entries) {
        const typeStr = formatChangeType(entry.changeType);
        console.log(` ${typeStr} ${entry.newPath || entry.oldPath}`);
      }

      console.log();
      console.log(dim(` ${entries.length} file(s) changed`));
    } else {
      // Show full diff
      for (const entry of entries) {
        const oldPath = entry.oldPath || "/dev/null";
        const newPath = entry.newPath || "/dev/null";

        console.log(bold(`diff --git a/${oldPath} b/${newPath}`));

        if (entry.changeType === ChangeType.ADD) {
          console.log(colorize("new file mode 100644", colors.cyan));
        } else if (entry.changeType === ChangeType.DELETE) {
          console.log(colorize("deleted file mode 100644", colors.cyan));
        }

        if (entry.oldId && entry.newId) {
          console.log(dim(`index ${shortId(entry.oldId)}..${shortId(entry.newId)}`));
        }

        console.log(`--- a/${oldPath}`);
        console.log(`+++ b/${newPath}`);
        console.log();
      }
    }
  } finally {
    await ctx.repository.close();
  }
}
