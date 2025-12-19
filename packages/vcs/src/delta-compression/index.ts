/**
 * Delta compression module
 *
 * Provides delta-aware object storage with compression strategies:
 * - DeltaStorageImpl: Main implementation coordinating storage and strategies
 * - Strategies: Candidate selection and delta computation
 * - Chain resolution: Utilities for resolving delta chains
 */

export * from "./delta-storage-impl.js";
export * from "./resolve-delta-chain.js";
export * from "./strategies/index.js";
export * from "./types.js";
