/**
 * Common result types for fetch operations.
 */

/**
 * Result of a fetch operation.
 */
export interface FetchResult {
  /** Whether the fetch completed successfully */
  success: boolean;
  /** Error message if failed */
  error?: string;
  /** Refs that were updated */
  updatedRefs?: Map<string, string>;
  /** Number of objects imported */
  objectsImported?: number;
}

/**
 * Result of a serve operation.
 */
export interface ServeResult {
  /** Whether the serve completed successfully */
  success: boolean;
  /** Error message if failed */
  error?: string;
  /** Number of objects sent */
  objectsSent?: number;
}
