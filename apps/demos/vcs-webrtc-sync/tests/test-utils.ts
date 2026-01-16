/**
 * Test utilities for the WebRTC sync demo.
 */

import type { AppContext } from "../src/controllers/main-controller.js";
import {
  getActivityLogModel,
  getCommitFormModel,
  getCommitHistoryModel,
  getConnectionModel,
  getFileListModel,
  getRepositoryModel,
  getSharingFormModel,
  getStagingModel,
  getUserActionsModel,
} from "../src/models/index.js";

/**
 * Create a fresh test context with all models initialized.
 */
export function createTestContext(): AppContext {
  const ctx: AppContext = new Map();

  // Initialize all models
  getRepositoryModel(ctx);
  getFileListModel(ctx);
  getStagingModel(ctx);
  getCommitHistoryModel(ctx);
  getCommitFormModel(ctx);
  getConnectionModel(ctx);
  getSharingFormModel(ctx);
  getActivityLogModel(ctx);
  getUserActionsModel(ctx);

  return ctx;
}

/**
 * Wait for a condition to become true.
 */
export async function waitFor(
  condition: () => boolean,
  { timeout = 1000, interval = 10 } = {},
): Promise<void> {
  const start = Date.now();
  while (!condition()) {
    if (Date.now() - start > timeout) {
      throw new Error("waitFor timeout");
    }
    await new Promise((resolve) => setTimeout(resolve, interval));
  }
}

/**
 * Create a spy function that records calls.
 */
export function spy<T extends (...args: unknown[]) => unknown>(
  fn?: T,
): T & { calls: Parameters<T>[]; lastCall: Parameters<T> | undefined } {
  const calls: Parameters<T>[] = [];
  const spyFn = ((...args: unknown[]) => {
    calls.push(args as Parameters<T>);
    return fn?.(...args);
  }) as T & { calls: Parameters<T>[]; lastCall: Parameters<T> | undefined };
  Object.defineProperty(spyFn, "calls", { get: () => calls });
  Object.defineProperty(spyFn, "lastCall", { get: () => calls[calls.length - 1] });
  return spyFn;
}
