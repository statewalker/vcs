/**
 * Checkout types - Shared types for checkout operations
 *
 * These types are used by both the new Checkout interface and the
 * legacy CheckoutStore interface during migration.
 */

import type { ObjectId } from "../../common/id/index.js";
import type { StagingStore } from "../staging/types.js";
import type { RepositoryStateValue, StateCapabilities } from "../working-copy/repository-state.js";
import type {
  CherryPickState,
  MergeState,
  RebaseState,
  RevertState,
  StashStore,
} from "../working-copy.js";

/**
 * CheckoutStore configuration
 *
 * @deprecated Use Checkout interface from checkout.ts instead.
 */
export interface CheckoutStoreConfig {
  /** Custom configuration options */
  [key: string]: unknown;
}

/**
 * CheckoutStore interface - manages local checkout state
 *
 * @deprecated Use Checkout interface from checkout.ts instead.
 */
export interface CheckoutStore {
  readonly staging: StagingStore;
  readonly stash: StashStore;
  readonly config: CheckoutStoreConfig;

  getHead(): Promise<ObjectId | undefined>;
  getCurrentBranch(): Promise<string | undefined>;
  setHead(target: ObjectId | string): Promise<void>;
  isDetachedHead(): Promise<boolean>;

  getMergeState(): Promise<MergeState | undefined>;
  getRebaseState(): Promise<RebaseState | undefined>;
  getCherryPickState(): Promise<CherryPickState | undefined>;
  getRevertState(): Promise<RevertState | undefined>;
  hasOperationInProgress(): Promise<boolean>;
  getState(): Promise<RepositoryStateValue>;
  getStateCapabilities(): Promise<StateCapabilities>;

  refresh(): Promise<void>;
  close(): Promise<void>;
}
