/**
 * Activity log model.
 *
 * Tracks application events and messages for display to the user.
 */

import { Base, newAdapter } from "../utils/index.js";

/**
 * Log entry severity level.
 */
export type LogLevel = "info" | "warn" | "error";

/**
 * A single log entry.
 */
export interface LogEntry {
  /** Entry ID for React keys. */
  id: number;
  /** When the entry was created. */
  timestamp: Date;
  /** Severity level. */
  level: LogLevel;
  /** Log message. */
  message: string;
}

/**
 * Activity log model - tracks application events.
 *
 * This model holds NO business logic. Controllers add log entries
 * as they perform operations.
 */
export class ActivityLogModel extends Base {
  private entries: LogEntry[] = [];
  private maxEntries = 100;
  private nextId = 1;

  /**
   * Get all log entries (readonly).
   */
  getEntries(): ReadonlyArray<LogEntry> {
    return this.entries;
  }

  /**
   * Get the most recent entries (newest first).
   */
  getRecent(count = 10): ReadonlyArray<LogEntry> {
    return this.entries.slice(-count).reverse();
  }

  /**
   * Add a new log entry.
   */
  addEntry(level: LogLevel, message: string): void {
    return this.update(() => {
      this.entries.push({
        id: this.nextId++,
        timestamp: new Date(),
        level,
        message,
      });

      // Keep only the last N entries
      if (this.entries.length > this.maxEntries) {
        this.entries = this.entries.slice(-this.maxEntries);
      }

    
    });
  }

  /**
   * Add an info-level log entry.
   */
  info(message: string): void {
    this.addEntry("info", message);
  }

  /**
   * Add a warning-level log entry.
   */
  warn(message: string): void {
    this.addEntry("warn", message);
  }

  /**
   * Add an error-level log entry.
   */
  error(message: string): void {
    this.addEntry("error", message);
  }

  /**
   * Clear all entries.
   */
  clear(): void {
    return this.update(() => {
      this.entries = [];
    
    });
  }

  /**
   * Set the maximum number of entries to keep.
   */
  setMaxEntries(max: number): void {
    this.maxEntries = max;
    if (this.entries.length > max) {
      return this.update(() => {
        this.entries = this.entries.slice(-max);
      
      });
    }
  }
}

/**
 * Context adapter for ActivityLogModel.
 */
export const [getActivityLogModel, setActivityLogModel] = newAdapter<ActivityLogModel>(
  "activity-log-model",
  () => new ActivityLogModel(),
);
