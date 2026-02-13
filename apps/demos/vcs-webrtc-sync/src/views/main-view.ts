/**
 * Main View
 *
 * Root view orchestrator that sets up all sub-views.
 */

import type { AppContext } from "../controllers/index.js";
import { newRegistry } from "../utils/index.js";
import { createActivityLogView } from "./activity-log-view.js";
import { createCommitFormView } from "./commit-form-view.js";
import { createCommitHistoryView } from "./commit-history-view.js";
import { createConnectionView } from "./connection-view.js";
import { createFileListView } from "./file-list-view.js";
import { createSharingView } from "./sharing-view.js";
import { createStagingView } from "./staging-view.js";
import { createStorageView } from "./storage-view.js";

/**
 * Create the main view that sets up all sub-views.
 * Returns cleanup function.
 */
export function createMainView(ctx: AppContext): () => void {
  const [register, cleanup] = newRegistry();

  // Get container elements
  const storageContainer = document.getElementById("storage-container");
  const fileListContainer = document.getElementById("file-list-container");
  const stagingContainer = document.getElementById("staging-container");
  const commitFormContainer = document.getElementById("commit-form-container");
  const commitHistoryContainer = document.getElementById("commit-history-container");
  const connectionContainer = document.getElementById("connection-container");
  const sharingContainer = document.getElementById("sharing-container");
  const activityLogContainer = document.getElementById("activity-log-container");

  // Create all views
  if (storageContainer) {
    register(createStorageView(ctx, storageContainer));
  }

  if (fileListContainer) {
    register(createFileListView(ctx, fileListContainer));
  }

  if (stagingContainer) {
    register(createStagingView(ctx, stagingContainer));
  }

  if (commitFormContainer) {
    register(createCommitFormView(ctx, commitFormContainer));
  }

  if (commitHistoryContainer) {
    register(createCommitHistoryView(ctx, commitHistoryContainer));
  }

  if (connectionContainer) {
    register(createConnectionView(ctx, connectionContainer));
  }

  if (sharingContainer) {
    register(createSharingView(ctx, sharingContainer));
  }

  if (activityLogContainer) {
    register(createActivityLogView(ctx, activityLogContainer));
  }

  return cleanup;
}
