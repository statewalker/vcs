/**
 * Garbage collection module
 *
 * Provides GC and packing functionality:
 * - GCController: Automatic garbage collection scheduling
 * - StorageAnalyzer: Storage analysis and orphan detection
 * - PackingOrchestrator: Sliding window packing algorithm
 */

export * from "./gc-controller.js";
export * from "./packing-orchestrator.js";
export * from "./storage-analyzer.js";
export * from "./types.js";
