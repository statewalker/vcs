/**
 * Volatile storage interfaces
 *
 * Type aliases for TempStore/TempContent interfaces from the interfaces package.
 * The names are used interchangeably:
 * - "Temp" (original) - temporary content storage
 * - "Volatile" (new) - emphasizes short-lived nature during object creation
 *
 * Both refer to the same concept: buffering streaming content to compute
 * size before the final storage operation.
 */

import type { TempContent, TempStore } from "../../interfaces/temp-store.js";

/**
 * Type alias: VolatileContent is the same as TempContent
 *
 * Handle to temporarily buffered content that can be re-read.
 */
export type VolatileContent = TempContent;

/**
 * Type alias: VolatileStore is the same as TempStore
 *
 * Buffers streaming content and computes size during storage.
 */
export type VolatileStore = TempStore;

// Re-export for convenience
export type { TempContent, TempStore };
