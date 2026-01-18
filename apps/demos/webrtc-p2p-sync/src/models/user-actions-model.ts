/**
 * User actions model.
 *
 * Views update this model to request actions. Controllers listen and execute.
 * This enables Views to be completely isolated from APIs and business logic.
 */

import { BaseClass, newAdapter } from "../utils/index.js";

/**
 * Types of user actions that can be requested.
 */
export type UserActionType =
  // Storage actions
  | "storage:open"
  | "storage:clear"
  // Repository actions
  | "repo:init"
  | "repo:refresh"
  // File actions
  | "file:add"
  | "file:stage"
  | "file:unstage"
  // Staging actions
  | "stage:all"
  // Commit actions
  | "commit:create"
  // Connection actions
  | "connection:share"
  | "connection:join"
  | "connection:disconnect"
  // Sync actions
  | "sync:start"
  | "sync:cancel";

/**
 * A user action request.
 */
export interface UserAction {
  /** Action type. */
  type: UserActionType;
  /** Action payload (depends on type). */
  payload?: unknown;
  /** When the action was requested. */
  timestamp: number;
}

/**
 * User actions model - communication channel from Views to Controllers.
 *
 * Views call methods like `requestSync(peerId)` which adds an action to the queue.
 * Controllers listen via `onUpdate()` and consume actions.
 *
 * This pattern ensures Views never call APIs directly.
 */
export class UserActionsModel extends BaseClass {
  private pendingActions: UserAction[] = [];

  /**
   * Get all pending actions.
   */
  getPending(): ReadonlyArray<UserAction> {
    return this.pendingActions;
  }

  /**
   * Get and remove all pending actions.
   */
  consumeAll(): UserAction[] {
    const actions = this.pendingActions;
    this.pendingActions = [];
    return actions;
  }

  /**
   * Get and remove pending actions of a specific type.
   */
  consume(type: UserActionType): UserAction[] {
    const matching = this.pendingActions.filter((a) => a.type === type);
    this.pendingActions = this.pendingActions.filter((a) => a.type !== type);
    return matching;
  }

  /**
   * Check if there are any pending actions.
   */
  get hasPending(): boolean {
    return this.pendingActions.length > 0;
  }

  /**
   * Add an action to the queue and notify listeners.
   */
  private request(type: UserActionType, payload?: unknown): void {
    this.pendingActions.push({
      type,
      payload,
      timestamp: Date.now(),
    });
    this.notify();
  }

  // Storage actions

  /** Request to open storage (IndexedDB). */
  requestOpenStorage(): void {
    this.request("storage:open");
  }

  /** Request to clear storage. */
  requestClearStorage(): void {
    this.request("storage:clear");
  }

  // Repository actions

  /** Request to initialize a new repository. */
  requestInitRepo(): void {
    this.request("repo:init");
  }

  /** Request to refresh repository state. */
  requestRefreshRepo(): void {
    this.request("repo:refresh");
  }

  // File actions

  /** Request to add a new file. */
  requestAddFile(name: string, content: string): void {
    this.request("file:add", { name, content });
  }

  /** Request to stage a file for commit. */
  requestStageFile(path: string): void {
    this.request("file:stage", { path });
  }

  /** Request to unstage a file. */
  requestUnstageFile(path: string): void {
    this.request("file:unstage", { path });
  }

  /** Request to stage all changes. */
  requestStageAll(): void {
    this.request("stage:all");
  }

  // Commit actions

  /** Request to create a commit. */
  requestCommit(message: string): void {
    this.request("commit:create", { message });
  }

  // Connection actions

  /** Request to start sharing (hosting). */
  requestShare(): void {
    this.request("connection:share");
  }

  /** Request to join a session. */
  requestJoin(sessionId: string): void {
    this.request("connection:join", { sessionId });
  }

  /** Request to disconnect from session. */
  requestDisconnect(): void {
    this.request("connection:disconnect");
  }

  // Sync actions

  /** Request to start sync with a peer. */
  requestSync(peerId: string): void {
    this.request("sync:start", { peerId });
  }

  /** Request to cancel ongoing sync. */
  requestCancelSync(): void {
    this.request("sync:cancel");
  }

  /**
   * Clear all pending actions.
   */
  clear(): void {
    this.pendingActions = [];
  }
}

/**
 * Context adapter for UserActionsModel.
 */
export const [getUserActionsModel, setUserActionsModel] = newAdapter<UserActionsModel>(
  "user-actions-model",
  () => new UserActionsModel(),
);
