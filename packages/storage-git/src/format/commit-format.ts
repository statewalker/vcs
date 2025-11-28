/**
 * Git commit object format serialization and parsing
 *
 * Commit format:
 *   tree <tree-sha1>
 *   parent <parent-sha1>     (repeated for each parent)
 *   author <name> <email> <timestamp> <timezone>
 *   committer <name> <email> <timestamp> <timezone>
 *   [gpgsig <signature>]     (optional)
 *   [encoding <encoding>]    (optional)
 *
 *   <commit message>
 *
 * Reference: jgit/org.eclipse.jgit/src/org/eclipse/jgit/lib/CommitBuilder.java
 */

import type { Commit } from "@webrun-vcs/storage";
import { formatPersonIdent, parsePersonIdent } from "./person-ident.js";

const encoder = new TextEncoder();
const decoder = new TextDecoder();

const LF = "\n";

/**
 * Serialize a commit to Git commit format
 *
 * @param commit Commit object
 * @returns Serialized commit content (without header)
 */
export function serializeCommit(commit: Commit): Uint8Array {
  const lines: string[] = [];

  // tree
  lines.push(`tree ${commit.tree}`);

  // parent(s)
  for (const parent of commit.parents) {
    lines.push(`parent ${parent}`);
  }

  // author
  lines.push(`author ${formatPersonIdent(commit.author)}`);

  // committer
  lines.push(`committer ${formatPersonIdent(commit.committer)}`);

  // encoding (optional)
  if (commit.encoding && commit.encoding.toLowerCase() !== "utf-8") {
    lines.push(`encoding ${commit.encoding}`);
  }

  // gpgsig (optional) - must be formatted with continuation lines
  if (commit.gpgSignature) {
    const sigLines = commit.gpgSignature.split("\n");
    lines.push(`gpgsig ${sigLines[0]}`);
    for (let i = 1; i < sigLines.length; i++) {
      lines.push(` ${sigLines[i]}`);
    }
  }

  // Empty line before message
  lines.push("");

  // Message
  lines.push(commit.message);

  return encoder.encode(lines.join(LF));
}

/**
 * Parse a commit from Git commit format
 *
 * @param data Serialized commit content (without header)
 * @returns Parsed commit object
 */
export function parseCommit(data: Uint8Array): Commit {
  const text = decoder.decode(data);
  const lines = text.split(LF);

  let tree: string | undefined;
  const parents: string[] = [];
  let author: ReturnType<typeof parsePersonIdent> | undefined;
  let committer: ReturnType<typeof parsePersonIdent> | undefined;
  let encoding: string | undefined;
  let gpgSignature: string | undefined;
  let messageStart = -1;

  // Track if we're in a multi-line field (like gpgsig)
  let inGpgSig = false;
  const gpgSigLines: string[] = [];

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];

    // Empty line marks start of message
    if (line === "" && messageStart === -1) {
      // Finalize any ongoing gpgsig
      if (inGpgSig) {
        gpgSignature = gpgSigLines.join("\n");
        inGpgSig = false;
      }
      messageStart = i + 1;
      break;
    }

    // Continuation line for gpgsig
    if (inGpgSig && line.startsWith(" ")) {
      gpgSigLines.push(line.substring(1));
      continue;
    }

    // End of gpgsig if we hit a non-continuation line
    if (inGpgSig) {
      gpgSignature = gpgSigLines.join("\n");
      inGpgSig = false;
    }

    // Parse header lines
    const spacePos = line.indexOf(" ");
    if (spacePos === -1) continue;

    const key = line.substring(0, spacePos);
    const value = line.substring(spacePos + 1);

    switch (key) {
      case "tree":
        tree = value;
        break;
      case "parent":
        parents.push(value);
        break;
      case "author":
        author = parsePersonIdent(value);
        break;
      case "committer":
        committer = parsePersonIdent(value);
        break;
      case "encoding":
        encoding = value;
        break;
      case "gpgsig":
        inGpgSig = true;
        gpgSigLines.push(value);
        break;
    }
  }

  // Validate required fields
  if (!tree) {
    throw new Error("Invalid commit: missing tree");
  }
  if (!author) {
    throw new Error("Invalid commit: missing author");
  }
  if (!committer) {
    throw new Error("Invalid commit: missing committer");
  }

  // Extract message
  let message = "";
  if (messageStart !== -1 && messageStart < lines.length) {
    message = lines.slice(messageStart).join(LF);
  }

  const commit: Commit = {
    tree,
    parents,
    author,
    committer,
    message,
  };

  if (encoding) {
    commit.encoding = encoding;
  }

  if (gpgSignature) {
    commit.gpgSignature = gpgSignature;
  }

  return commit;
}
