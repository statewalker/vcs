/**
 * Performance measurement utilities
 */

import type { PerformanceMetric } from "./types.js";

export class PerformanceTracker {
  private metrics: PerformanceMetric[] = [];
  private startTime: number = 0;

  start(): void {
    this.startTime = performance.now();
  }

  record(name: string, details?: Record<string, unknown>): number {
    const duration = performance.now() - this.startTime;
    this.metrics.push({
      name,
      duration,
      unit: "ms",
      details,
    });
    return duration;
  }

  measure<T>(name: string, fn: () => T, details?: Record<string, unknown>): T {
    const start = performance.now();
    const result = fn();
    const duration = performance.now() - start;
    this.metrics.push({
      name,
      duration,
      unit: "ms",
      details,
    });
    return result;
  }

  async measureAsync<T>(
    name: string,
    fn: () => Promise<T>,
    details?: Record<string, unknown>,
  ): Promise<T> {
    const start = performance.now();
    const result = await fn();
    const duration = performance.now() - start;
    this.metrics.push({
      name,
      duration,
      unit: "ms",
      details,
    });
    return result;
  }

  getMetrics(): PerformanceMetric[] {
    return [...this.metrics];
  }

  addMetrics(metrics: PerformanceMetric[]): void {
    this.metrics.push(...metrics);
  }

  getTotalDuration(): number {
    return this.metrics.reduce((sum, m) => sum + m.duration, 0);
  }

  clear(): void {
    this.metrics = [];
  }
}

// Singleton instance for sharing across steps
let globalTracker: PerformanceTracker | null = null;

export function getGlobalTracker(): PerformanceTracker {
  if (!globalTracker) {
    globalTracker = new PerformanceTracker();
  }
  return globalTracker;
}

export function resetGlobalTracker(): void {
  globalTracker = new PerformanceTracker();
}
