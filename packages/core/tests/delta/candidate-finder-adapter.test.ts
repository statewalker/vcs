/**
 * Tests for CandidateFinder adapters
 */

import { describe, expect, it } from "vitest";
import { MemoryRawStore } from "../../src/binary/raw-store.memory.js";
import {
	CandidateFinderAdapter,
	LegacyStrategyAdapter,
} from "../../src/delta/candidate-finder/adapter.js";
import type {
	CandidateFinder,
	DeltaTarget,
} from "../../src/delta/candidate-finder.js";
import { SimilarSizeCandidateStrategy } from "../../src/delta/strategies/similar-size-candidate.js";
import { ObjectType } from "../../src/objects/object-types.js";

describe("CandidateFinderAdapter", () => {
	it("wraps CandidateFinder to work as DeltaCandidateStrategy", async () => {
		// Create a mock CandidateFinder
		const mockFinder: CandidateFinder = {
			async *findCandidates(_target: DeltaTarget) {
				yield {
					id: "candidate-1",
					type: ObjectType.BLOB,
					size: 100,
					similarity: 0.8,
					reason: "similar-size" as const,
				};
				yield {
					id: "candidate-2",
					type: ObjectType.BLOB,
					size: 110,
					similarity: 0.7,
					reason: "similar-size" as const,
				};
			},
		};

		const adapter = new CandidateFinderAdapter(mockFinder);
		const storage = new MemoryRawStore();

		// Store target object
		await storage.store("target-id", [
			new TextEncoder().encode("target content"),
		]);

		// Collect candidates
		const candidates: string[] = [];
		for await (const id of adapter.findCandidates("target-id", storage)) {
			candidates.push(id);
		}

		expect(candidates).toContain("candidate-1");
		expect(candidates).toContain("candidate-2");
		expect(candidates.length).toBe(2);
	});

	it("respects maxCandidates option", async () => {
		const mockFinder: CandidateFinder = {
			async *findCandidates() {
				for (let i = 0; i < 100; i++) {
					yield {
						id: `candidate-${i}`,
						type: ObjectType.BLOB,
						size: 100,
						similarity: 0.8,
						reason: "similar-size" as const,
					};
				}
			},
		};

		const adapter = new CandidateFinderAdapter(mockFinder, {
			maxCandidates: 5,
		});
		const storage = new MemoryRawStore();
		await storage.store("target-id", [new TextEncoder().encode("content")]);

		const candidates: string[] = [];
		for await (const id of adapter.findCandidates("target-id", storage)) {
			candidates.push(id);
		}

		expect(candidates.length).toBe(5);
	});

	it("passes object size from storage to finder", async () => {
		let capturedTarget: DeltaTarget | undefined;

		const mockFinder: CandidateFinder = {
			// biome-ignore lint/correctness/useYield: empty generator for test that just captures the target
			async *findCandidates(target: DeltaTarget) {
				capturedTarget = target;
			},
		};

		const adapter = new CandidateFinderAdapter(mockFinder);
		const storage = new MemoryRawStore();

		const content = new TextEncoder().encode("test content here");
		await storage.store("target-id", [content]);

		// Consume the iterator
		for await (const _ of adapter.findCandidates("target-id", storage)) {
			// Intentionally empty - just need to consume the iterator
		}

		expect(capturedTarget).toBeDefined();
		expect(capturedTarget?.id).toBe("target-id");
		expect(capturedTarget?.size).toBe(content.length);
	});
});

describe("LegacyStrategyAdapter", () => {
	it("wraps DeltaCandidateStrategy to work as CandidateFinder", async () => {
		const storage = new MemoryRawStore();

		// Store objects with similar sizes
		await storage.store("obj-1", [new TextEncoder().encode("x".repeat(100))]);
		await storage.store("obj-2", [new TextEncoder().encode("x".repeat(105))]);
		await storage.store("obj-3", [new TextEncoder().encode("x".repeat(110))]);

		const legacyStrategy = new SimilarSizeCandidateStrategy({ tolerance: 0.2 });
		const adapter = new LegacyStrategyAdapter(legacyStrategy, storage);

		const target: DeltaTarget = {
			id: "obj-1",
			type: ObjectType.BLOB,
			size: 100,
		};

		const candidates: Array<{ id: string; similarity: number }> = [];
		for await (const candidate of adapter.findCandidates(target)) {
			candidates.push({ id: candidate.id, similarity: candidate.similarity });
		}

		// Should find obj-2 and obj-3 as candidates (similar size to obj-1)
		expect(candidates.length).toBeGreaterThanOrEqual(2);
		expect(candidates.find((c) => c.id === "obj-2")).toBeDefined();
		expect(candidates.find((c) => c.id === "obj-3")).toBeDefined();
	});

	it("estimates similarity based on size difference", async () => {
		const storage = new MemoryRawStore();

		await storage.store("target", [new TextEncoder().encode("x".repeat(100))]);
		await storage.store("same-size", [
			new TextEncoder().encode("y".repeat(100)),
		]);
		await storage.store("different-size", [
			new TextEncoder().encode("z".repeat(120)),
		]);

		const legacyStrategy = new SimilarSizeCandidateStrategy({ tolerance: 0.5 });
		const adapter = new LegacyStrategyAdapter(legacyStrategy, storage);

		const target: DeltaTarget = {
			id: "target",
			type: ObjectType.BLOB,
			size: 100,
		};

		const candidates: Array<{ id: string; similarity: number }> = [];
		for await (const candidate of adapter.findCandidates(target)) {
			candidates.push({ id: candidate.id, similarity: candidate.similarity });
		}

		const sameSize = candidates.find((c) => c.id === "same-size");
		const differentSize = candidates.find((c) => c.id === "different-size");

		// Same size should have higher similarity
		if (sameSize && differentSize) {
			expect(sameSize.similarity).toBeGreaterThan(differentSize.similarity);
		}
	});

	it("adds reason to candidates", async () => {
		const storage = new MemoryRawStore();

		await storage.store("obj-1", [new TextEncoder().encode("x".repeat(100))]);
		await storage.store("obj-2", [new TextEncoder().encode("x".repeat(100))]);

		const legacyStrategy = new SimilarSizeCandidateStrategy();
		const adapter = new LegacyStrategyAdapter(legacyStrategy, storage);

		const target: DeltaTarget = {
			id: "obj-1",
			type: ObjectType.BLOB,
			size: 100,
		};

		for await (const candidate of adapter.findCandidates(target)) {
			expect(candidate.reason).toBe("similar-size");
		}
	});
});
