/**
 * Stream utilities for Git object format handling
 *
 * Re-exported from @webrun-vcs/utils for backwards compatibility.
 */
export {
  asAsyncIterable,
  collect,
  concat,
  decodeString,
  encodeString,
  isAsyncIterable,
  mapStream,
  newByteSplitter,
  newSplitter,
  readAhead,
  readBlock,
  readHeader,
  splitStream,
  toArray,
  toLines,
} from "@webrun-vcs/utils/streams";
