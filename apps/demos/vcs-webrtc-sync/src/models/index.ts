/**
 * Models Module
 *
 * Observable state containers for the application.
 * Each model extends BaseClass and notifies views of state changes.
 * Adapters provide typed context access for dependency injection.
 */

import { newAdapter } from "../utils/index.js";
import { ActivityLogModel } from "./activity-log-model.js";
import { CommitFormModel } from "./commit-form-model.js";
import { CommitHistoryModel } from "./commit-history-model.js";
import { ConnectionModel } from "./connection-model.js";
import { FileListModel } from "./file-list-model.js";
import { RepositoryModel } from "./repository-model.js";
import { SharingFormModel } from "./sharing-form-model.js";
import { StagingModel } from "./staging-model.js";

export type { LogEntry, LogLevel } from "./activity-log-model.js";
export { ActivityLogModel } from "./activity-log-model.js";
export { CommitFormModel } from "./commit-form-model.js";
export type { CommitEntry } from "./commit-history-model.js";
export { CommitHistoryModel } from "./commit-history-model.js";
export type { ConnectionState, PeerRole } from "./connection-model.js";
export { ConnectionModel } from "./connection-model.js";
export type { FileEntry, FileStatus } from "./file-list-model.js";
export { FileListModel } from "./file-list-model.js";
export type { RepositoryStatus } from "./repository-model.js";
// Re-export model classes
export { RepositoryModel } from "./repository-model.js";
export type { SharingMode } from "./sharing-form-model.js";
export { SharingFormModel } from "./sharing-form-model.js";
export type { StagedFile } from "./staging-model.js";
export { StagingModel } from "./staging-model.js";

// Adapters for dependency injection
export const [getRepositoryModel, setRepositoryModel] = newAdapter<RepositoryModel>(
  "repository-model",
  () => new RepositoryModel(),
);

export const [getFileListModel, setFileListModel] = newAdapter<FileListModel>(
  "file-list-model",
  () => new FileListModel(),
);

export const [getStagingModel, setStagingModel] = newAdapter<StagingModel>(
  "staging-model",
  () => new StagingModel(),
);

export const [getCommitHistoryModel, setCommitHistoryModel] = newAdapter<CommitHistoryModel>(
  "commit-history-model",
  () => new CommitHistoryModel(),
);

export const [getCommitFormModel, setCommitFormModel] = newAdapter<CommitFormModel>(
  "commit-form-model",
  () => new CommitFormModel(),
);

export const [getConnectionModel, setConnectionModel] = newAdapter<ConnectionModel>(
  "connection-model",
  () => new ConnectionModel(),
);

export const [getSharingFormModel, setSharingFormModel] = newAdapter<SharingFormModel>(
  "sharing-form-model",
  () => new SharingFormModel(),
);

export const [getActivityLogModel, setActivityLogModel] = newAdapter<ActivityLogModel>(
  "activity-log-model",
  () => new ActivityLogModel(),
);
