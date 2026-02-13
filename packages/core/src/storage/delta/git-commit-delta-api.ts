/**
 * Git Files Commit Delta API - Binary delta operations for commit objects
 *
 * Follows the same pattern as GitFilesBlobDeltaApi but for commits.
 * Uses PackDeltaStore for native Git pack-based delta storage.
 *
 * Commits don't need a separate store reference (unlike blobs) because
 * PackDeltaStore handles object loading and delta resolution internally.
 */

import type { PackDeltaStore } from "../../backend/git/pack/index.js";
import type { ObjectId } from "../../common/id/object-id.js";
import type {
  BlobDeltaChainInfo,
  DeltaCandidateSource,
  StreamingDeltaResult,
} from "./blob-delta-api.js";
import type { CommitDeltaApi } from "./commit-delta-api.js";
import { parseBinaryDelta } from "./delta-binary-format.js";

/**
 * CommitDeltaApi implementation using PackDeltaStore
 *
 * Wraps PackDeltaStore's delta operations with the typed CommitDeltaApi interface.
 * Mirrors GitFilesBlobDeltaApi but without the blob-specific content loading.
 *
 * @internal Exported for use by createGitFilesHistory
 */
export class GitFilesCommitDeltaApi implements CommitDeltaApi {
  constructor(private readonly packDeltaStore: PackDeltaStore) {}

  async findCommitDelta(
    _targetId: ObjectId,
    _candidates: DeltaCandidateSource,
  ): Promise<StreamingDeltaResult | null> {
    // Delta computation is handled by DeltaEngine externally
    // This API is for storage operations, not computation
    return null;
  }

  async deltifyCommit(
    targetId: ObjectId,
    baseId: ObjectId,
    delta: AsyncIterable<Uint8Array>,
  ): Promise<void> {
    // Collect delta bytes
    const chunks: Uint8Array[] = [];
    for await (const chunk of delta) {
      chunks.push(chunk);
    }

    // Start batch update to create pack with delta
    const update = this.packDeltaStore.startUpdate();

    // Store target as delta
    const deltaBytes = concatBytes(chunks);
    const deltaInstructions = parseBinaryDelta(deltaBytes);

    await update.storeDelta({ baseKey: baseId, targetKey: targetId }, deltaInstructions);

    // Commit the pack
    await update.close();
  }

  async undeltifyCommit(id: ObjectId): Promise<void> {
    // Load resolved content from pack
    const content = await this.packDeltaStore.loadObject(id);
    if (!content) {
      throw new Error(`Commit ${id} not found in pack files`);
    }

    // The content is now resolved - removing delta just means
    // the pack file marks it as removed (handled by removeDelta)
    await this.packDeltaStore.removeDelta(id, true);
  }

  async isCommitDelta(id: ObjectId): Promise<boolean> {
    return this.packDeltaStore.isDelta(id);
  }

  async getCommitDeltaChain(id: ObjectId): Promise<BlobDeltaChainInfo | undefined> {
    const chainInfo = await this.packDeltaStore.getDeltaChainInfo(id);
    if (!chainInfo) return undefined;

    return {
      depth: chainInfo.depth,
      totalSize: chainInfo.compressedSize,
      baseIds: chainInfo.chain,
    };
  }
}

/**
 * Concatenate byte arrays
 */
function concatBytes(chunks: Uint8Array[]): Uint8Array {
  const totalLength = chunks.reduce((sum, chunk) => sum + chunk.length, 0);
  const result = new Uint8Array(totalLength);
  let offset = 0;
  for (const chunk of chunks) {
    result.set(chunk, offset);
    offset += chunk.length;
  }
  return result;
}
