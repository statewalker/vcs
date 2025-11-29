/**
 * Git annotated tag object format serialization and parsing
 *
 * Tag format:
 *   object <object-sha1>
 *   type <object-type>
 *   tag <tag-name>
 *   tagger <name> <email> <timestamp> <timezone>
 *   [gpgsig <signature>]     (optional)
 *   [encoding <encoding>]    (optional)
 *
 *   <tag message>
 *
 * Reference: jgit/org.eclipse.jgit/src/org/eclipse/jgit/lib/TagBuilder.java
 */

import type { AnnotatedTag, ObjectTypeCode } from "@webrun-vcs/storage";
import { typeCodeToString, typeStringToCode } from "./object-header.js";
import { formatPersonIdent, parsePersonIdent } from "./person-ident.js";

const encoder = new TextEncoder();
const decoder = new TextDecoder();

const LF = "\n";

/**
 * Serialize an annotated tag to Git tag format
 *
 * @param tag Tag object
 * @returns Serialized tag content (without header)
 */
export function serializeTag(tag: AnnotatedTag): Uint8Array {
  const lines: string[] = [];

  // object
  lines.push(`object ${tag.object}`);

  // type
  lines.push(`type ${typeCodeToString(tag.objectType)}`);

  // tag name
  lines.push(`tag ${tag.tag}`);

  // tagger (optional)
  if (tag.tagger) {
    lines.push(`tagger ${formatPersonIdent(tag.tagger)}`);
  }

  // encoding (optional)
  if (tag.encoding && tag.encoding.toLowerCase() !== "utf-8") {
    lines.push(`encoding ${tag.encoding}`);
  }

  // gpgsig (optional) - must be formatted with continuation lines
  if (tag.gpgSignature) {
    const sigLines = tag.gpgSignature.split("\n");
    lines.push(`gpgsig ${sigLines[0]}`);
    for (let i = 1; i < sigLines.length; i++) {
      lines.push(` ${sigLines[i]}`);
    }
  }

  // Empty line before message
  lines.push("");

  // Message
  lines.push(tag.message);

  return encoder.encode(lines.join(LF));
}

/**
 * Parse an annotated tag from Git tag format
 *
 * @param data Serialized tag content (without header)
 * @returns Parsed tag object
 */
export function parseTag(data: Uint8Array): AnnotatedTag {
  const text = decoder.decode(data);
  const lines = text.split(LF);

  let object: string | undefined;
  let objectType: ObjectTypeCode | undefined;
  let tagName: string | undefined;
  let tagger: ReturnType<typeof parsePersonIdent> | undefined;
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
      case "object":
        object = value;
        break;
      case "type":
        objectType = typeStringToCode(value as "commit" | "tree" | "blob" | "tag");
        break;
      case "tag":
        tagName = value;
        break;
      case "tagger":
        tagger = parsePersonIdent(value);
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
  if (!object) {
    throw new Error("Invalid tag: missing object");
  }
  if (objectType === undefined) {
    throw new Error("Invalid tag: missing type");
  }
  if (!tagName) {
    throw new Error("Invalid tag: missing tag name");
  }

  // Extract message
  let message = "";
  if (messageStart !== -1 && messageStart < lines.length) {
    message = lines.slice(messageStart).join(LF);
  }

  const tag: AnnotatedTag = {
    object,
    objectType,
    tag: tagName,
    message,
  };

  if (tagger) {
    tag.tagger = tagger;
  }

  if (encoding) {
    tag.encoding = encoding;
  }

  if (gpgSignature) {
    tag.gpgSignature = gpgSignature;
  }

  return tag;
}
