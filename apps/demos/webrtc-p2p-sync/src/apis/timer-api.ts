/**
 * Timer API abstraction for dependency injection.
 *
 * This interface abstracts timing operations, enabling:
 * - Unit testing without real delays
 * - Fast-forward tests with controlled time
 * - Deterministic test behavior
 */

import { newAdapter } from "../utils/index.js";

/**
 * Timer operations interface.
 */
export interface TimerApi {
  /**
   * Schedule a callback to run after a delay.
   * @param callback Function to call
   * @param ms Delay in milliseconds
   * @returns Timer ID for cancellation
   */
  setTimeout(callback: () => void, ms: number): number;

  /**
   * Cancel a scheduled timeout.
   * @param id Timer ID from setTimeout
   */
  clearTimeout(id: number): void;

  /**
   * Schedule a callback to run repeatedly.
   * @param callback Function to call
   * @param ms Interval in milliseconds
   * @returns Timer ID for cancellation
   */
  setInterval(callback: () => void, ms: number): number;

  /**
   * Cancel a scheduled interval.
   * @param id Timer ID from setInterval
   */
  clearInterval(id: number): void;

  /**
   * Get the current timestamp in milliseconds.
   * @returns Current time (like Date.now())
   */
  now(): number;
}

/**
 * Context adapter for Timer API.
 */
export const [getTimerApi, setTimerApi] = newAdapter<TimerApi>("timer-api");

/**
 * Real timer implementation using window/global functions.
 */
export function createRealTimerApi(): TimerApi {
  return {
    setTimeout: (callback, ms) => window.setTimeout(callback, ms),
    clearTimeout: (id) => window.clearTimeout(id),
    setInterval: (callback, ms) => window.setInterval(callback, ms),
    clearInterval: (id) => window.clearInterval(id),
    now: () => Date.now(),
  };
}

/**
 * Mock timer implementation for testing.
 *
 * Allows manual control of time passage.
 */
interface TimerEntry {
  callback: () => void;
  triggerAt: number;
  interval?: number;
}

export class MockTimerApi implements TimerApi {
  private currentTime = 0;
  private nextId = 1;
  private readonly timers = new Map<number, TimerEntry>();

  setTimeout(callback: () => void, ms: number): number {
    const id = this.nextId++;
    this.timers.set(id, { callback, triggerAt: this.currentTime + ms });
    return id;
  }

  clearTimeout(id: number): void {
    this.timers.delete(id);
  }

  setInterval(callback: () => void, ms: number): number {
    const id = this.nextId++;
    this.timers.set(id, { callback, triggerAt: this.currentTime + ms, interval: ms });
    return id;
  }

  clearInterval(id: number): void {
    this.timers.delete(id);
  }

  now(): number {
    return this.currentTime;
  }

  /**
   * Advance time by the given number of milliseconds.
   * Triggers any timers that would have fired.
   */
  advance(ms: number): void {
    const targetTime = this.currentTime + ms;

    while (true) {
      // Find the next timer to fire
      let nextTimer: { id: number; entry: TimerEntry } | null = null;

      for (const [id, entry] of this.timers) {
        if (entry.triggerAt <= targetTime) {
          if (!nextTimer || entry.triggerAt < nextTimer.entry.triggerAt) {
            nextTimer = { id, entry };
          }
        }
      }

      if (!nextTimer) break;

      // Advance time to this timer
      this.currentTime = nextTimer.entry.triggerAt;

      // Fire the callback
      const { id, entry } = nextTimer;
      entry.callback();

      // Handle interval vs timeout
      if (entry.interval !== undefined) {
        // Reschedule interval
        entry.triggerAt = this.currentTime + entry.interval;
      } else {
        // Remove timeout
        this.timers.delete(id);
      }
    }

    // Advance to final target time
    this.currentTime = targetTime;
  }

  /**
   * Get the number of pending timers.
   */
  get pendingTimers(): number {
    return this.timers.size;
  }

  /**
   * Clear all pending timers.
   */
  clearAll(): void {
    this.timers.clear();
  }

  /**
   * Reset time to zero and clear all timers.
   */
  reset(): void {
    this.currentTime = 0;
    this.timers.clear();
    this.nextId = 1;
  }
}
