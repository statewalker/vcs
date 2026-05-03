/**
 * User Actions Model
 *
 * Centralized model for user action intents. Views update this model
 * when users interact with UI elements, and controllers subscribe
 * to perform the actual operations.
 *
 * This ensures Views communicate with Controllers exclusively via Models.
 */

import { Base } from "../utils/index.js";

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
export class UserActionsModel extends Base {
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
    return this.update(() => {
      this.#storageAction = { type: "open-folder" };
    
    });
  }

  requestUseMemory(): void {
    return this.update(() => {
      this.#storageAction = { type: "use-memory" };
    
    });
  }

  requestInitRepository(): void {
    return this.update(() => {
      this.#storageAction = { type: "init-repository" };
    
    });
  }

  requestCreateSamples(): void {
    return this.update(() => {
      this.#storageAction = { type: "create-samples" };
    
    });
  }

  clearStorageAction(): void {
    if (this.#storageAction) {
      return this.update(() => {
        this.#storageAction = null;
      
      });
    }
  }

  // File actions
  get fileAction(): FileAction | null {
    return this.#fileAction;
  }

  requestRefresh(): void {
    return this.update(() => {
      this.#fileAction = { type: "refresh" };
    
    });
  }

  requestStage(path: string): void {
    return this.update(() => {
      this.#fileAction = { type: "stage", path };
    
    });
  }

  requestUnstage(path: string): void {
    return this.update(() => {
      this.#fileAction = { type: "unstage", path };
    
    });
  }

  clearFileAction(): void {
    if (this.#fileAction) {
      return this.update(() => {
        this.#fileAction = null;
      
      });
    }
  }

  // Commit actions
  get commitAction(): CommitAction | null {
    return this.#commitAction;
  }

  requestCommit(message: string): void {
    return this.update(() => {
      this.#commitAction = { type: "commit", message };
    
    });
  }

  requestRestore(commitId: string): void {
    return this.update(() => {
      this.#commitAction = { type: "restore", commitId };
    
    });
  }

  clearCommitAction(): void {
    if (this.#commitAction) {
      return this.update(() => {
        this.#commitAction = null;
      
      });
    }
  }

  // Connection actions
  get connectionAction(): ConnectionAction | null {
    return this.#connectionAction;
  }

  requestCreateOffer(): void {
    return this.update(() => {
      this.#connectionAction = { type: "create-offer" };
    
    });
  }

  requestAcceptOffer(payload: string): void {
    return this.update(() => {
      this.#connectionAction = { type: "accept-offer", payload };
    
    });
  }

  requestAcceptAnswer(payload: string): void {
    return this.update(() => {
      this.#connectionAction = { type: "accept-answer", payload };
    
    });
  }

  requestCloseConnection(): void {
    return this.update(() => {
      this.#connectionAction = { type: "close-connection" };
    
    });
  }

  clearConnectionAction(): void {
    if (this.#connectionAction) {
      return this.update(() => {
        this.#connectionAction = null;
      
      });
    }
  }

  // Sync actions
  get syncAction(): SyncAction | null {
    return this.#syncAction;
  }

  requestPush(): void {
    return this.update(() => {
      this.#syncAction = { type: "push" };
    
    });
  }

  requestFetch(): void {
    return this.update(() => {
      this.#syncAction = { type: "fetch" };
    
    });
  }

  clearSyncAction(): void {
    if (this.#syncAction) {
      return this.update(() => {
        this.#syncAction = null;
      
      });
    }
  }
}
