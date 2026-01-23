/**
 * Progress reporting utilities.
 */

import type { ProgressInfo } from "../protocol/types.js";

/**
 * Progress reporter that formats and outputs progress messages.
 */
export class ProgressReporter {
  private callback: (message: string) => void;
  private lastMessage = "";
  private startTime: number;

  constructor(callback: (message: string) => void) {
    this.callback = callback;
    this.startTime = Date.now();
  }

  /**
   * Report progress from a ProgressInfo object.
   */
  report(info: ProgressInfo): void {
    let message: string;

    if (info.total !== undefined && info.total > 0) {
      const percent = info.percent ?? Math.floor((info.current / info.total) * 100);
      message = `${info.stage}: ${percent}% (${info.current}/${info.total})`;
    } else {
      message = `${info.stage}: ${info.current}`;
    }

    this.output(message);
  }

  /**
   * Report a raw message.
   */
  message(msg: string): void {
    this.output(msg.trim());
  }

  /**
   * Report completion.
   */
  complete(message: string): void {
    const elapsed = Date.now() - this.startTime;
    const elapsedStr = formatDuration(elapsed);
    this.output(`${message} (${elapsedStr})`);
  }

  /**
   * Report an error.
   */
  error(error: string): void {
    this.output(`Error: ${error}`);
  }

  private output(message: string): void {
    // Avoid duplicate messages
    if (message !== this.lastMessage) {
      this.lastMessage = message;
      this.callback(message);
    }
  }
}

/**
 * Format duration in human-readable format.
 */
export function formatDuration(ms: number): string {
  if (ms < 1000) {
    return `${ms}ms`;
  }
  if (ms < 60000) {
    return `${(ms / 1000).toFixed(1)}s`;
  }
  const minutes = Math.floor(ms / 60000);
  const seconds = Math.floor((ms % 60000) / 1000);
  return `${minutes}m ${seconds}s`;
}

/**
 * Format byte count in human-readable format.
 */
export function formatBytes(bytes: number): string {
  if (bytes < 1024) {
    return `${bytes} B`;
  }
  if (bytes < 1024 * 1024) {
    return `${(bytes / 1024).toFixed(1)} KB`;
  }
  if (bytes < 1024 * 1024 * 1024) {
    return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  }
  return `${(bytes / (1024 * 1024 * 1024)).toFixed(1)} GB`;
}

/**
 * Create a simple console progress reporter.
 */
export function createConsoleReporter(): ProgressReporter {
  return new ProgressReporter((message) => {
    // Use carriage return for in-place updates
    process.stdout?.write?.(`\r${message}`) ?? console.log(message);
  });
}

/**
 * Create a null reporter (discards all messages).
 */
export function createNullReporter(): ProgressReporter {
  return new ProgressReporter(() => {});
}

/**
 * Aggregate progress from multiple stages.
 */
export class AggregateProgress {
  private stages: Map<string, { current: number; total?: number }> = new Map();
  private reporter: ProgressReporter;

  constructor(reporter: ProgressReporter) {
    this.reporter = reporter;
  }

  /**
   * Update progress for a stage.
   */
  update(stage: string, current: number, total?: number): void {
    this.stages.set(stage, { current, total });
    this.reportTotal();
  }

  /**
   * Complete a stage.
   */
  completeStage(stage: string): void {
    const info = this.stages.get(stage);
    if (info) {
      info.current = info.total ?? info.current;
    }
    this.reportTotal();
  }

  private reportTotal(): void {
    let totalCurrent = 0;
    let totalTotal = 0;
    let hasTotal = true;

    for (const { current, total } of this.stages.values()) {
      totalCurrent += current;
      if (total !== undefined) {
        totalTotal += total;
      } else {
        hasTotal = false;
      }
    }

    if (hasTotal && totalTotal > 0) {
      this.reporter.report({
        stage: "Total",
        current: totalCurrent,
        total: totalTotal,
      });
    } else {
      this.reporter.report({
        stage: "Total",
        current: totalCurrent,
      });
    }
  }
}
