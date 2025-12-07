/**
 * Formatting utilities for benchmark output
 */

/**
 * Format a number with padding
 */
export function pad(str: string, width = 10): string {
  return str.padStart(width, " ");
}

/**
 * Format byte size in human-readable format
 */
export function formatSize(size: number): string {
  if (size < 1024) return `${size}B`;
  if (size < 1024 * 1024) return `${(size / 1024).toFixed(1)}KB`;
  return `${(size / (1024 * 1024)).toFixed(2)}MB`;
}

/**
 * Format milliseconds
 */
export function formatMs(ms: number): string {
  return `${ms.toFixed(3)}ms`;
}

/**
 * Format percentage
 */
export function formatPercent(value: number): string {
  return `${(value * 100).toFixed(1)}%`;
}

/**
 * Create a separator line
 */
export function separator(length = 70): string {
  return "-".repeat(length);
}
