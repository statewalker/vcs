/**
 * Factory function for creating Git-compatible streaming stores
 *
 * Creates stores using the new streaming architecture that produces
 * Git-compatible object IDs.
 */

import type { GitStores } from "@webrun-vcs/vcs";
import { createStreamingStores, MemoryTempStore } from "@webrun-vcs/vcs";
import { MemoryRawStorage } from "./memory-raw-storage.js";

/**
 * Create Git-compatible stores backed by memory.
 *
 * Uses the streaming architecture with proper Git header format
 * for SHA-1 compatibility.
 *
 * @returns GitStores with all typed store implementations
 */
export function createStreamingMemoryStores(): GitStores {
  const storage = new MemoryRawStorage();
  const temp = new MemoryTempStore();
  return createStreamingStores({ storage, temp });
}
