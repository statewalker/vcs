import { threeWayMergeLines } from "./text-merge.js";
import type { ContentMergeInput, ContentMergeOutput, ContentMerger } from "./types.js";

const decoder = new TextDecoder();
const encoder = new TextEncoder();

/** Split into lines such that `lines.join("\n")` reproduces the source exactly. */
function toLines(bytes: Uint8Array | undefined): string[] {
  return decoder.decode(bytes ?? new Uint8Array(0)).split("\n");
}

/**
 * Default {@link ContentMerger}: a line-based three-way text merge. Clean
 * (disjoint) edits merge; overlapping edits are reported as a conflict. The
 * engine handles binary/oversize files by hash before ever reaching here.
 */
export function createTextContentMerger(): ContentMerger {
  return {
    merge(input: ContentMergeInput): ContentMergeOutput {
      const res = threeWayMergeLines(toLines(input.base), toLines(input.left), toLines(input.right));
      if (!res.ok || !res.lines) return { conflict: true };
      return { conflict: false, merged: encoder.encode(res.lines.join("\n")) };
    },
  };
}
