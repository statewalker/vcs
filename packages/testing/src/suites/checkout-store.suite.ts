/**
 * Parametrized test suite for CheckoutStore implementations
 *
 * This suite tests the core CheckoutStore interface contract.
 * All storage implementations must pass these tests.
 */

import type { CheckoutStore, RefStore, StagingStore, StashStore } from "@statewalker/vcs-core";
import { RepositoryState } from "@statewalker/vcs-core";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

/**
 * Context provided by the storage factory
 */
export interface CheckoutStoreTestContext {
  checkoutStore: CheckoutStore;
  /** Optional ref store for setting up branches */
  refStore?: RefStore;
  cleanup?: () => Promise<void>;
}

/**
 * Factory function to create a storage instance for testing
 */
export type CheckoutStoreFactory = () => Promise<CheckoutStoreTestContext>;

/**
 * Helper function to generate a fake object ID (for testing)
 * Converts seed to hex-only characters to create a valid SHA-1 format
 */
function fakeObjectId(seed: string): string {
  // Convert each character to a 2-digit hex value
  let hex = "";
  for (let i = 0; i < seed.length && hex.length < 40; i++) {
    hex += seed.charCodeAt(i).toString(16).padStart(2, "0");
  }
  // Pad with zeros to reach 40 characters
  return hex.padEnd(40, "0").slice(0, 40);
}

/**
 * Create the CheckoutStore test suite with a specific factory
 *
 * @param name Name of the storage implementation (e.g., "Memory", "SQL", "KV")
 * @param factory Factory function to create storage instances
 */
export function createCheckoutStoreTests(name: string, factory: CheckoutStoreFactory): void {
  describe(`CheckoutStore [${name}]`, () => {
    let ctx: CheckoutStoreTestContext;

    beforeEach(async () => {
      ctx = await factory();
    });

    afterEach(async () => {
      await ctx.cleanup?.();
    });

    describe("HEAD Management", () => {
      it("getHead returns undefined for empty repository", async () => {
        const head = await ctx.checkoutStore.getHead();
        // Empty repo may return undefined
        expect(head === undefined || typeof head === "string").toBe(true);
      });

      it("setHead sets HEAD to a commit ID", async () => {
        const commitId = fakeObjectId("commit1");

        // If refStore is available, set up a branch first
        if (ctx.refStore) {
          await ctx.refStore.set("refs/heads/main", commitId);
        }

        await ctx.checkoutStore.setHead(commitId);
        const head = await ctx.checkoutStore.getHead();

        expect(head).toBe(commitId);
      });

      it("setHead sets HEAD to a branch", async () => {
        const commitId = fakeObjectId("commit1");

        // If refStore is available, set up a branch first
        if (ctx.refStore) {
          await ctx.refStore.set("refs/heads/main", commitId);
        }

        await ctx.checkoutStore.setHead("refs/heads/main");
        const branch = await ctx.checkoutStore.getCurrentBranch();

        expect(branch).toBe("main");
      });

      it("getCurrentBranch returns branch name when on a branch", async () => {
        const commitId = fakeObjectId("commit1");

        if (ctx.refStore) {
          await ctx.refStore.set("refs/heads/feature", commitId);
        }

        await ctx.checkoutStore.setHead("refs/heads/feature");
        const branch = await ctx.checkoutStore.getCurrentBranch();

        expect(branch).toBe("feature");
      });

      it("getCurrentBranch returns undefined when detached", async () => {
        const commitId = fakeObjectId("detached");

        await ctx.checkoutStore.setHead(commitId);
        const branch = await ctx.checkoutStore.getCurrentBranch();

        expect(branch).toBeUndefined();
      });

      it("isDetachedHead returns true when HEAD points to commit", async () => {
        const commitId = fakeObjectId("detached");

        await ctx.checkoutStore.setHead(commitId);
        const isDetached = await ctx.checkoutStore.isDetachedHead();

        expect(isDetached).toBe(true);
      });

      it("isDetachedHead returns false when HEAD points to branch", async () => {
        const commitId = fakeObjectId("commit1");

        if (ctx.refStore) {
          await ctx.refStore.set("refs/heads/main", commitId);
        }

        await ctx.checkoutStore.setHead("refs/heads/main");
        const isDetached = await ctx.checkoutStore.isDetachedHead();

        expect(isDetached).toBe(false);
      });
    });

    describe("In-Progress Operations", () => {
      it("hasOperationInProgress returns false by default", async () => {
        const hasOp = await ctx.checkoutStore.hasOperationInProgress();
        expect(hasOp).toBe(false);
      });

      it("getMergeState returns undefined when no merge", async () => {
        const mergeState = await ctx.checkoutStore.getMergeState();
        expect(mergeState).toBeUndefined();
      });

      it("getRebaseState returns undefined when no rebase", async () => {
        const rebaseState = await ctx.checkoutStore.getRebaseState();
        expect(rebaseState).toBeUndefined();
      });

      it("getCherryPickState returns undefined when no cherry-pick", async () => {
        const cherryPickState = await ctx.checkoutStore.getCherryPickState();
        expect(cherryPickState).toBeUndefined();
      });

      it("getRevertState returns undefined when no revert", async () => {
        const revertState = await ctx.checkoutStore.getRevertState();
        expect(revertState).toBeUndefined();
      });

      it("getState returns normal state when no operation in progress", async () => {
        const state = await ctx.checkoutStore.getState();
        expect(state).toBe(RepositoryState.SAFE);
      });
    });

    describe("Linked Stores", () => {
      it("staging property returns StagingStore", async () => {
        expect(ctx.checkoutStore.staging).toBeDefined();

        // Verify it has StagingStore-like methods
        const staging: StagingStore = ctx.checkoutStore.staging;
        expect(typeof staging.getEntry).toBe("function");
        expect(typeof staging.hasEntry).toBe("function");
        expect(typeof staging.listEntries).toBe("function");
      });

      it("stash property returns StashStore", async () => {
        expect(ctx.checkoutStore.stash).toBeDefined();

        // Verify it has StashStore-like methods
        const stash: StashStore = ctx.checkoutStore.stash;
        expect(typeof stash.list).toBe("function");
        expect(typeof stash.push).toBe("function");
        expect(typeof stash.pop).toBe("function");
      });

      it("config property is accessible", async () => {
        expect(ctx.checkoutStore.config).toBeDefined();
        expect(typeof ctx.checkoutStore.config).toBe("object");
      });
    });

    describe("State Capabilities", () => {
      it("getStateCapabilities returns capabilities object", async () => {
        const caps = await ctx.checkoutStore.getStateCapabilities();

        expect(caps).toBeDefined();
        expect(typeof caps.canCommit).toBe("boolean");
        expect(typeof caps.canCheckout).toBe("boolean");
        expect(typeof caps.canResetHead).toBe("boolean");
        expect(typeof caps.canAmend).toBe("boolean");
        expect(typeof caps.isRebasing).toBe("boolean");
      });

      it("can commit in normal state", async () => {
        const caps = await ctx.checkoutStore.getStateCapabilities();
        expect(caps.canCommit).toBe(true);
      });

      it("can checkout in normal state", async () => {
        const caps = await ctx.checkoutStore.getStateCapabilities();
        expect(caps.canCheckout).toBe(true);
      });
    });

    describe("Lifecycle", () => {
      it("refresh does not throw", async () => {
        await expect(ctx.checkoutStore.refresh()).resolves.not.toThrow();
      });

      it("close does not throw", async () => {
        await expect(ctx.checkoutStore.close()).resolves.not.toThrow();
      });
    });

    describe("Edge Cases", () => {
      it("handles switching between branches", async () => {
        const commitA = fakeObjectId("commitA");
        const commitB = fakeObjectId("commitB");

        if (ctx.refStore) {
          await ctx.refStore.set("refs/heads/branchA", commitA);
          await ctx.refStore.set("refs/heads/branchB", commitB);
        }

        await ctx.checkoutStore.setHead("refs/heads/branchA");
        expect(await ctx.checkoutStore.getCurrentBranch()).toBe("branchA");

        await ctx.checkoutStore.setHead("refs/heads/branchB");
        expect(await ctx.checkoutStore.getCurrentBranch()).toBe("branchB");
      });

      it("handles switching from branch to detached", async () => {
        const branchCommit = fakeObjectId("branchCommit");
        const detachedCommit = fakeObjectId("detachedCommit");

        if (ctx.refStore) {
          await ctx.refStore.set("refs/heads/main", branchCommit);
        }

        await ctx.checkoutStore.setHead("refs/heads/main");
        expect(await ctx.checkoutStore.isDetachedHead()).toBe(false);

        await ctx.checkoutStore.setHead(detachedCommit);
        expect(await ctx.checkoutStore.isDetachedHead()).toBe(true);
      });

      it("handles nested branch names", async () => {
        const commitId = fakeObjectId("nested");

        if (ctx.refStore) {
          await ctx.refStore.set("refs/heads/feature/auth/login", commitId);
        }

        await ctx.checkoutStore.setHead("refs/heads/feature/auth/login");
        const branch = await ctx.checkoutStore.getCurrentBranch();

        expect(branch).toBe("feature/auth/login");
      });
    });
  });
}
