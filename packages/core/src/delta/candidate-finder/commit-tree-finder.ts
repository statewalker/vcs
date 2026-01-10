/**
 * CommitTreeCandidateFinder - Find delta candidates for commits and trees
 *
 * For Git-native storage where commits and trees are also deltified.
 * Uses commit relationships (parents) and tree structure to find candidates.
 */

import type { CommitStore } from "../../commits/commit-store.js";
import { ObjectType, type ObjectTypeCode } from "../../objects/object-types.js";
import type { TreeStore } from "../../trees/tree-store.js";
import type {
	CandidateFinder,
	CandidateFinderOptions,
	DeltaCandidate,
	DeltaTarget,
} from "../candidate-finder.js";

/**
 * CommitTreeCandidateFinder implementation
 *
 * Finds delta candidates based on commit/tree relationships:
 * - For commits: parent commits are best candidates
 * - For trees: trees from parent commits at same path
 */
export class CommitTreeCandidateFinder implements CandidateFinder {
	constructor(
		private readonly commits: CommitStore,
		private readonly trees: TreeStore,
		private readonly options: CandidateFinderOptions = {},
	) {}

	async *findCandidates(target: DeltaTarget): AsyncIterable<DeltaCandidate> {
		if (target.type === ObjectType.COMMIT) {
			yield* this.findCommitCandidates(target);
		} else if (target.type === ObjectType.TREE) {
			yield* this.findTreeCandidates(target);
		}
		// Blobs are handled by PathBasedCandidateFinder
	}

	private async *findCommitCandidates(
		target: DeltaTarget,
	): AsyncIterable<DeltaCandidate> {
		const maxCandidates = this.options.maxCandidates ?? 10;
		let count = 0;

		try {
			// Parent commits are the best candidates for commit deltification
			const commit = await this.commits.loadCommit(target.id);
			if (!commit) return;

			for (const parentId of commit.parents) {
				if (count >= maxCandidates) return;

				const parent = await this.commits.loadCommit(parentId);
				if (!parent) continue;

				// Estimate size (commits are usually small)
				// In practice, we'd need to serialize to get actual size
				const estimatedSize = target.size; // Assume similar size

				yield {
					id: parentId,
					type: ObjectType.COMMIT as ObjectTypeCode,
					size: estimatedSize,
					similarity: 0.95, // Parent commits are very similar
					reason: "parent-commit",
				};
				count++;
			}
		} catch {
			// If commit can't be loaded, skip
		}
	}

	private async *findTreeCandidates(
		target: DeltaTarget,
	): AsyncIterable<DeltaCandidate> {
		const maxCandidates = this.options.maxCandidates ?? 10;
		let count = 0;

		// For trees, we look for trees with similar structure
		// This is a simplified implementation - a full implementation would
		// track tree paths through commits to find related trees

		// If we have a path, try to find trees at that path in recent commits
		if (target.path) {
			// This requires walking recent commits and finding trees at the same path
			// For now, we'll use a simpler approach: look for recently accessed trees
			// with similar size
			// Placeholder: in a full implementation, this would:
			// 1. Walk recent commits
			// 2. For each commit, navigate to the tree at target.path
			// 3. Yield those trees as candidates
		}

		// Simple fallback: look for trees of similar size
		// This isn't ideal but provides some candidates
		try {
			// Trees from the same commit structure tend to be similar
			// We could also look at sibling trees (trees in the same parent tree)
			for await (const entry of this.trees.loadTree(target.id)) {
				if (count >= maxCandidates) return;

				if (entry.mode === 0o040000) {
					// Directory entry - another tree
					yield {
						id: entry.id,
						type: ObjectType.TREE as ObjectTypeCode,
						size: target.size, // Estimate
						similarity: 0.3, // Lower similarity for sibling trees
						reason: "same-tree",
					};
					count++;
				}
			}
		} catch {
			// If tree can't be loaded, skip
		}
	}
}
