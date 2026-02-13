import { BaseClass } from "../utils/index.js";

/**
 * Log entry severity level.
 */
export type LogLevel = "info" | "success" | "warning" | "error";

/**
 * Represents a log entry.
 */
export interface LogEntry {
  timestamp: number;
  message: string;
  level: LogLevel;
}

/**
 * Model representing the activity log.
 * Tracks timestamped events and messages.
 */
export class ActivityLogModel extends BaseClass {
  #entries: LogEntry[] = [];
  #maxEntries: number;

  constructor(maxEntries = 100) {
    super();
    this.#maxEntries = maxEntries;
  }

  get entries(): readonly LogEntry[] {
    return this.#entries;
  }

  log(message: string, level: LogLevel = "info"): void {
    const entry: LogEntry = {
      timestamp: Date.now(),
      message,
      level,
    };

    this.#entries.push(entry);

    // Trim if exceeding max
    if (this.#entries.length > this.#maxEntries) {
      this.#entries = this.#entries.slice(-this.#maxEntries);
    }

    this.notify();
  }

  info(message: string): void {
    this.log(message, "info");
  }

  success(message: string): void {
    this.log(message, "success");
  }

  warning(message: string): void {
    this.log(message, "warning");
  }

  error(message: string): void {
    this.log(message, "error");
  }

  clear(): void {
    if (this.#entries.length > 0) {
      this.#entries = [];
      this.notify();
    }
  }
}
