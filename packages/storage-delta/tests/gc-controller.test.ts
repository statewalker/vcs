import type {
  DeltaBackendStats,
  DeltaStorage,
  PackingSuggestion,
  RepackOptions,
  RepackResult,
  RepositoryAnalysis,
} from "@webrun-vcs/storage";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { GCController } from "../src/gc-controller.js";

/**
 * Mock DeltaStorage for testing GC Controller
 */
function createMockStorage(overrides?: Partial<DeltaStorage>): DeltaStorage {
  const mockStats: RepositoryAnalysis = {
    totalObjects: 100,
    looseObjects: 50,
    deltaObjects: 50,
    totalSize: 10000,
    compressedSize: 5000,
    potentialSavings: 2000,
    deltifiableCandidates: 30,
    averageChainDepth: 2,
    deepChains: 0,
  };

  return {
    looseStorage: {} as DeltaStorage["looseStorage"],
    deltaBackend: {} as DeltaStorage["deltaBackend"],
    store: vi.fn().mockResolvedValue("test-id"),
    load: vi.fn(),
    getSize: vi.fn().mockResolvedValue(100),
    has: vi.fn().mockResolvedValue(true),
    delete: vi.fn().mockResolvedValue(true),
    listObjects: vi.fn(),
    setCandidateStrategy: vi.fn(),
    setComputeStrategy: vi.fn(),
    getStrategies: vi.fn().mockReturnValue({ candidate: {}, compute: {} }),
    deltify: vi.fn().mockResolvedValue(true),
    deltifyWith: vi.fn().mockResolvedValue(true),
    undeltify: vi.fn().mockResolvedValue(undefined),
    isDelta: vi.fn().mockResolvedValue(false),
    getDeltaChainInfo: vi.fn().mockResolvedValue(undefined),
    analyzeRepository: vi.fn().mockResolvedValue(mockStats),
    suggestPacking: vi.fn().mockResolvedValue({
      candidates: [],
      estimatedSavings: 0,
      chainsToBreak: [],
    } as PackingSuggestion),
    repack: vi.fn().mockResolvedValue({
      objectsProcessed: 10,
      deltasCreated: 5,
      deltasRemoved: 0,
      looseObjectsPruned: 5,
      spaceSaved: 1000,
      duration: 100,
    } as RepackResult),
    quickPack: vi.fn().mockResolvedValue(2),
    pruneLooseObjects: vi.fn().mockResolvedValue(5),
    getStats: vi.fn().mockResolvedValue({
      loose: { count: 50, size: 5000 },
      delta: {
        deltaCount: 50,
        baseCount: 20,
        averageChainDepth: 2,
        maxChainDepth: 5,
        totalSize: 5000,
      } as DeltaBackendStats,
    }),
    ...overrides,
  } as DeltaStorage;
}

describe("GCController", () => {
  let storage: DeltaStorage;
  let controller: GCController;

  beforeEach(() => {
    storage = createMockStorage();
    controller = new GCController(storage, {
      looseObjectThreshold: 100,
      chainDepthThreshold: 50,
      minInterval: 1000,
      quickPackThreshold: 5,
    });
  });

  describe("constructor", () => {
    it("should use default options when not specified", () => {
      const ctrl = new GCController(storage);
      const options = ctrl.getOptions();

      expect(options.looseObjectThreshold).toBe(100);
      expect(options.chainDepthThreshold).toBe(50);
      expect(options.minInterval).toBe(60000);
      expect(options.quickPackThreshold).toBe(5);
    });

    it("should use provided options", () => {
      const ctrl = new GCController(storage, {
        looseObjectThreshold: 200,
        chainDepthThreshold: 10,
        minInterval: 5000,
        quickPackThreshold: 3,
      });
      const options = ctrl.getOptions();

      expect(options.looseObjectThreshold).toBe(200);
      expect(options.chainDepthThreshold).toBe(10);
      expect(options.minInterval).toBe(5000);
      expect(options.quickPackThreshold).toBe(3);
    });
  });

  describe("onCommit", () => {
    it("should track pending commits", async () => {
      await controller.onCommit("commit-1");
      expect(controller.getPendingCommitsCount()).toBe(1);

      await controller.onCommit("commit-2");
      expect(controller.getPendingCommitsCount()).toBe(2);
    });

    it("should trigger quick pack when threshold reached", async () => {
      await controller.onCommit("commit-1");
      await controller.onCommit("commit-2");
      await controller.onCommit("commit-3");
      await controller.onCommit("commit-4");
      expect(controller.getPendingCommitsCount()).toBe(4);

      // Fifth commit should trigger quick pack
      await controller.onCommit("commit-5");
      expect(controller.getPendingCommitsCount()).toBe(0);
      expect(storage.quickPack).toHaveBeenCalledTimes(5);
    });
  });

  describe("quickPack", () => {
    it("should pack all pending commits", async () => {
      await controller.onCommit("commit-1");
      await controller.onCommit("commit-2");

      const result = await controller.quickPack();

      expect(result).toBe(4); // 2 commits * 2 objects each
      expect(storage.quickPack).toHaveBeenCalledWith("commit-1");
      expect(storage.quickPack).toHaveBeenCalledWith("commit-2");
      expect(controller.getPendingCommitsCount()).toBe(0);
    });

    it("should return 0 when no pending commits", async () => {
      const result = await controller.quickPack();
      expect(result).toBe(0);
    });
  });

  describe("shouldRunGC", () => {
    it("should return false if minimum interval not passed", async () => {
      // Force a recent GC
      await controller.runGC();

      // Immediately check again
      const should = await controller.shouldRunGC();
      expect(should).toBe(false);
    });

    it("should return true when loose objects exceed threshold", async () => {
      // Create controller with very low threshold
      const ctrl = new GCController(
        createMockStorage({
          analyzeRepository: vi.fn().mockResolvedValue({
            looseObjects: 150,
            deepChains: 0,
          } as RepositoryAnalysis),
        }),
        {
          looseObjectThreshold: 100,
          minInterval: 0, // No wait time
        },
      );

      const should = await ctrl.shouldRunGC();
      expect(should).toBe(true);
    });

    it("should return true when deep chains exist", async () => {
      const ctrl = new GCController(
        createMockStorage({
          analyzeRepository: vi.fn().mockResolvedValue({
            looseObjects: 10,
            deepChains: 1,
          } as RepositoryAnalysis),
        }),
        {
          looseObjectThreshold: 100,
          minInterval: 0,
        },
      );

      const should = await ctrl.shouldRunGC();
      expect(should).toBe(true);
    });

    it("should return false when below thresholds", async () => {
      const ctrl = new GCController(
        createMockStorage({
          analyzeRepository: vi.fn().mockResolvedValue({
            looseObjects: 10,
            deepChains: 0,
          } as RepositoryAnalysis),
        }),
        {
          looseObjectThreshold: 100,
          minInterval: 0,
        },
      );

      const should = await ctrl.shouldRunGC();
      expect(should).toBe(false);
    });
  });

  describe("maybeRunGC", () => {
    it("should return null if GC not needed", async () => {
      const ctrl = new GCController(
        createMockStorage({
          analyzeRepository: vi.fn().mockResolvedValue({
            looseObjects: 10,
            deepChains: 0,
          } as RepositoryAnalysis),
        }),
        {
          looseObjectThreshold: 100,
          minInterval: 0,
        },
      );

      const result = await ctrl.maybeRunGC();
      expect(result).toBeNull();
    });

    it("should run GC and return result if needed", async () => {
      const ctrl = new GCController(
        createMockStorage({
          analyzeRepository: vi.fn().mockResolvedValue({
            looseObjects: 150,
            deepChains: 0,
          } as RepositoryAnalysis),
        }),
        {
          looseObjectThreshold: 100,
          minInterval: 0,
        },
      );

      const result = await ctrl.maybeRunGC();
      expect(result).not.toBeNull();
      expect(result?.objectsProcessed).toBe(10);
    });
  });

  describe("runGC", () => {
    it("should call storage.repack", async () => {
      const result = await controller.runGC();

      expect(storage.repack).toHaveBeenCalled();
      expect(result.objectsProcessed).toBe(10);
    });

    it("should pass options to repack", async () => {
      const options: RepackOptions = {
        maxChainDepth: 5,
        aggressive: true,
      };

      await controller.runGC(options);

      expect(storage.repack).toHaveBeenCalledWith(options);
    });

    it("should quick pack pending commits first", async () => {
      await controller.onCommit("commit-1");
      await controller.onCommit("commit-2");

      await controller.runGC();

      // Quick pack should have been called for both commits
      expect(storage.quickPack).toHaveBeenCalledWith("commit-1");
      expect(storage.quickPack).toHaveBeenCalledWith("commit-2");
      expect(controller.getPendingCommitsCount()).toBe(0);
    });
  });

  describe("getTimeSinceLastGC", () => {
    it("should return -1 if never run", () => {
      expect(controller.getTimeSinceLastGC()).toBe(-1);
    });

    it("should return time since last GC", async () => {
      await controller.runGC();

      // Small delay - use 5ms to be safe with timing
      await new Promise((resolve) => setTimeout(resolve, 5));

      const time = controller.getTimeSinceLastGC();
      expect(time).toBeGreaterThanOrEqual(0);
      expect(time).toBeLessThan(1000); // Should be less than 1 second
    });
  });
});
