/**
 * User Actions Model
 *
 * Centralized model for user action intents. Views update this model
 * when users interact with UI elements, and controllers subscribe
 * to perform the actual operations.
 *
 * This ensures Views communicate with Controllers exclusively via Models.
 */

import { BaseClass } from "../utils/index.js";

/**
 * Storage action types.
 */
export type StorageAction =
  | { type: "open-folder" }
  | { type: "use-memory" }
  | { type: "init-repository" }
  | { type: "create-samples" };

/**
 * File action types.
 */
export type FileAction =
  | { type: "refresh" }
  | { type: "stage"; path: string }
  | { type: "unstage"; path: string };

/**
 * Commit action types.
 */
export type CommitAction =
  | { type: "commit"; message: string }
  | { type: "restore"; commitId: string };

/**
 * Connection action types.
 */
export type ConnectionAction =
  | { type: "create-offer" }
  | { type: "accept-offer"; payload: string }
  | { type: "accept-answer"; payload: string }
  | { type: "close-connection" };

/**
 * Sync action types.
 */
export type SyncAction = { type: "push" } | { type: "fetch" };

/**
 * Model for tracking user-initiated action requests.
 * Views set action requests, controllers consume and clear them.
 */
export class UserActionsModel extends BaseClass {
  #storageAction: StorageAction | null = null;
  #fileAction: FileAction | null = null;
  #commitAction: CommitAction | null = null;
  #connectionAction: ConnectionAction | null = null;
  #syncAction: SyncAction | null = null;

  // Storage actions
  get storageAction(): StorageAction | null {
    return this.#storageAction;
  }

  requestOpenFolder(): void {
    this.#storageAction = { type: "open-folder" };
    this.notify();
  }

  requestUseMemory(): void {
    this.#storageAction = { type: "use-memory" };
    this.notify();
  }

  requestInitRepository(): void {
    this.#storageAction = { type: "init-repository" };
    this.notify();
  }

  requestCreateSamples(): void {
    this.#storageAction = { type: "create-samples" };
    this.notify();
  }

  clearStorageAction(): void {
    if (this.#storageAction) {
      this.#storageAction = null;
      this.notify();
    }
  }

  // File actions
  get fileAction(): FileAction | null {
    return this.#fileAction;
  }

  requestRefresh(): void {
    this.#fileAction = { type: "refresh" };
    this.notify();
  }

  requestStage(path: string): void {
    this.#fileAction = { type: "stage", path };
    this.notify();
  }

  requestUnstage(path: string): void {
    this.#fileAction = { type: "unstage", path };
    this.notify();
  }

  clearFileAction(): void {
    if (this.#fileAction) {
      this.#fileAction = null;
      this.notify();
    }
  }

  // Commit actions
  get commitAction(): CommitAction | null {
    return this.#commitAction;
  }

  requestCommit(message: string): void {
    this.#commitAction = { type: "commit", message };
    this.notify();
  }

  requestRestore(commitId: string): void {
    this.#commitAction = { type: "restore", commitId };
    this.notify();
  }

  clearCommitAction(): void {
    if (this.#commitAction) {
      this.#commitAction = null;
      this.notify();
    }
  }

  // Connection actions
  get connectionAction(): ConnectionAction | null {
    return this.#connectionAction;
  }

  requestCreateOffer(): void {
    this.#connectionAction = { type: "create-offer" };
    this.notify();
  }

  requestAcceptOffer(payload: string): void {
    this.#connectionAction = { type: "accept-offer", payload };
    this.notify();
  }

  requestAcceptAnswer(payload: string): void {
    this.#connectionAction = { type: "accept-answer", payload };
    this.notify();
  }

  requestCloseConnection(): void {
    this.#connectionAction = { type: "close-connection" };
    this.notify();
  }

  clearConnectionAction(): void {
    if (this.#connectionAction) {
      this.#connectionAction = null;
      this.notify();
    }
  }

  // Sync actions
  get syncAction(): SyncAction | null {
    return this.#syncAction;
  }

  requestPush(): void {
    this.#syncAction = { type: "push" };
    this.notify();
  }

  requestFetch(): void {
    this.#syncAction = { type: "fetch" };
    this.notify();
  }

  clearSyncAction(): void {
    if (this.#syncAction) {
      this.#syncAction = null;
      this.notify();
    }
  }
}
