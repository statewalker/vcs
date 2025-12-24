/**
 * Delta compression strategies
 *
 * Provides strategies for:
 * - Finding delta base candidates (DeltaCandidateStrategy)
 * - Computing deltas between objects (DeltaComputeStrategy)
 */

export * from "./commit-window-candidate.js";
export * from "./rolling-hash-compute.js";
export * from "./similar-size-candidate.js";
