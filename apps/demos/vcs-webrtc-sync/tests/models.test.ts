/**
 * Tests for model classes.
 */

import { describe, expect, it } from "vitest";
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
import { createTestContext, spy } from "./test-utils.js";

describe("ActivityLogModel", () => {
  it("should log messages with correct levels", () => {
    const ctx = createTestContext();
    const model = getActivityLogModel(ctx);

    model.info("Test info");
    model.success("Test success");
    model.warning("Test warning");
    model.error("Test error");

    expect(model.entries).toHaveLength(4);
    expect(model.entries[0].level).toBe("info");
    expect(model.entries[1].level).toBe("success");
    expect(model.entries[2].level).toBe("warning");
    expect(model.entries[3].level).toBe("error");
  });

  it("should notify listeners on log", () => {
    const ctx = createTestContext();
    const model = getActivityLogModel(ctx);
    const listener = spy<() => void>();

    model.onUpdate(listener);
    model.info("Test");

    expect(listener.calls).toHaveLength(1);
  });

  it("should clear entries", () => {
    const ctx = createTestContext();
    const model = getActivityLogModel(ctx);

    model.info("Test");
    expect(model.entries).toHaveLength(1);

    model.clear();
    expect(model.entries).toHaveLength(0);
  });

  it("should trim old entries when exceeding max", () => {
    const ctx = createTestContext();
    const model = getActivityLogModel(ctx);

    // Log many entries (default max is 100)
    for (let i = 0; i < 105; i++) {
      model.info(`Entry ${i}`);
    }

    expect(model.entries.length).toBeLessThanOrEqual(100);
  });
});

describe("ConnectionModel", () => {
  it("should initialize with new state", () => {
    const ctx = createTestContext();
    const model = getConnectionModel(ctx);

    expect(model.state).toBe("new");
    expect(model.peerRole).toBeNull();
    expect(model.error).toBeNull();
    expect(model.isConnected).toBe(false);
  });

  it("should set connecting state with role", () => {
    const ctx = createTestContext();
    const model = getConnectionModel(ctx);

    model.setConnecting("initiator");

    expect(model.state).toBe("connecting");
    expect(model.peerRole).toBe("initiator");
  });

  it("should set connected state", () => {
    const ctx = createTestContext();
    const model = getConnectionModel(ctx);

    model.setConnecting("responder");
    model.setConnected();

    expect(model.state).toBe("connected");
    expect(model.isConnected).toBe(true);
  });

  it("should set failed state with error", () => {
    const ctx = createTestContext();
    const model = getConnectionModel(ctx);

    model.setConnecting("initiator");
    model.setFailed("Connection timeout");

    expect(model.state).toBe("failed");
    expect(model.error).toBe("Connection timeout");
  });

  it("should reset to new state", () => {
    const ctx = createTestContext();
    const model = getConnectionModel(ctx);

    model.setConnecting("initiator");
    model.setConnected();
    model.reset();

    expect(model.state).toBe("new");
    expect(model.peerRole).toBeNull();
    expect(model.error).toBeNull();
  });
});

describe("RepositoryModel", () => {
  it("should initialize with no-storage status", () => {
    const ctx = createTestContext();
    const model = getRepositoryModel(ctx);

    expect(model.status).toBe("no-storage");
    expect(model.folderName).toBeNull();
    expect(model.branchName).toBeNull();
    expect(model.headCommit).toBeNull();
  });

  it("should set no-repository status", () => {
    const ctx = createTestContext();
    const model = getRepositoryModel(ctx);

    model.setNoRepository("my-folder");

    expect(model.status).toBe("no-repository");
    expect(model.folderName).toBe("my-folder");
  });

  it("should set ready status with all info", () => {
    const ctx = createTestContext();
    const model = getRepositoryModel(ctx);

    model.setReady("my-folder", "main", "abc1234");

    expect(model.status).toBe("ready");
    expect(model.folderName).toBe("my-folder");
    expect(model.branchName).toBe("main");
    expect(model.headCommit).toBe("abc1234");
  });

  it("should update head commit", () => {
    const ctx = createTestContext();
    const model = getRepositoryModel(ctx);

    model.setReady("folder", "main", "abc123");
    model.updateHead("def456");

    expect(model.headCommit).toBe("def456");
  });

  it("should track uncommitted changes", () => {
    const ctx = createTestContext();
    const model = getRepositoryModel(ctx);

    expect(model.hasUncommittedChanges).toBe(false);

    model.setUncommittedChanges(true);
    expect(model.hasUncommittedChanges).toBe(true);

    model.setUncommittedChanges(false);
    expect(model.hasUncommittedChanges).toBe(false);
  });

  it("should set error status", () => {
    const ctx = createTestContext();
    const model = getRepositoryModel(ctx);

    model.setError("Repository corrupted");

    expect(model.status).toBe("error");
    expect(model.errorMessage).toBe("Repository corrupted");
  });
});

describe("FileListModel", () => {
  it("should initialize with empty files list", () => {
    const ctx = createTestContext();
    const model = getFileListModel(ctx);

    expect(model.files).toEqual([]);
    expect(model.loading).toBe(false);
  });

  it("should set files", () => {
    const ctx = createTestContext();
    const model = getFileListModel(ctx);

    const files = [
      { path: "file1.txt", status: "untracked" as const },
      { path: "file2.txt", status: "modified" as const },
    ];

    model.setFiles(files);
    expect(model.files).toHaveLength(2);
    expect(model.files[0].path).toBe("file1.txt");
    expect(model.files[1].path).toBe("file2.txt");
  });

  it("should track loading state", () => {
    const ctx = createTestContext();
    const model = getFileListModel(ctx);

    model.setLoading(true);
    expect(model.loading).toBe(true);

    model.setLoading(false);
    expect(model.loading).toBe(false);
  });

  it("should update file status", () => {
    const ctx = createTestContext();
    const model = getFileListModel(ctx);

    model.setFiles([{ path: "test.txt", status: "untracked" }]);
    model.updateFileStatus("test.txt", "staged");

    expect(model.files[0].status).toBe("staged");
  });

  it("should clear files", () => {
    const ctx = createTestContext();
    const model = getFileListModel(ctx);

    model.setFiles([{ path: "test.txt", status: "untracked" }]);
    model.clear();

    expect(model.files).toEqual([]);
  });
});

describe("StagingModel", () => {
  it("should initialize with empty staged files", () => {
    const ctx = createTestContext();
    const model = getStagingModel(ctx);

    expect(model.stagedFiles).toEqual([]);
    expect(model.isEmpty).toBe(true);
  });

  it("should add staged files", () => {
    const ctx = createTestContext();
    const model = getStagingModel(ctx);

    model.addFile("file1.txt", "objectId1");
    model.addFile("file2.txt", "objectId2");

    expect(model.stagedFiles).toHaveLength(2);
    expect(model.isEmpty).toBe(false);
  });

  it("should remove staged files", () => {
    const ctx = createTestContext();
    const model = getStagingModel(ctx);

    model.addFile("file1.txt", "objectId1");
    model.addFile("file2.txt", "objectId2");
    model.removeFile("file1.txt");

    expect(model.stagedFiles).toHaveLength(1);
    expect(model.stagedFiles[0].path).toBe("file2.txt");
  });

  it("should clear all staged files", () => {
    const ctx = createTestContext();
    const model = getStagingModel(ctx);

    model.addFile("file1.txt", "objectId1");
    model.addFile("file2.txt", "objectId2");
    model.clear();

    expect(model.stagedFiles).toEqual([]);
    expect(model.isEmpty).toBe(true);
  });

  it("should check if file is staged", () => {
    const ctx = createTestContext();
    const model = getStagingModel(ctx);

    model.addFile("file1.txt", "objectId1");

    expect(model.hasFile("file1.txt")).toBe(true);
    expect(model.hasFile("file2.txt")).toBe(false);
  });

  it("should update existing file objectId", () => {
    const ctx = createTestContext();
    const model = getStagingModel(ctx);

    model.addFile("file1.txt", "objectId1");
    model.addFile("file1.txt", "objectId2");

    expect(model.stagedFiles).toHaveLength(1);
    expect(model.stagedFiles[0].objectId).toBe("objectId2");
  });
});

describe("CommitHistoryModel", () => {
  it("should initialize with empty commits", () => {
    const ctx = createTestContext();
    const model = getCommitHistoryModel(ctx);

    expect(model.commits).toEqual([]);
    expect(model.loading).toBe(false);
  });

  it("should set commits", () => {
    const ctx = createTestContext();
    const model = getCommitHistoryModel(ctx);

    const commits = [
      { id: "abc123", shortId: "abc123", message: "First", timestamp: Date.now(), author: "Test" },
      { id: "def456", shortId: "def456", message: "Second", timestamp: Date.now(), author: "Test" },
    ];

    model.setCommits(commits);
    expect(model.commits).toHaveLength(2);
  });

  it("should prepend commit to beginning", () => {
    const ctx = createTestContext();
    const model = getCommitHistoryModel(ctx);

    const commit1 = {
      id: "abc123",
      shortId: "abc123",
      message: "First",
      timestamp: Date.now(),
      author: "Test",
    };
    const commit2 = {
      id: "def456",
      shortId: "def456",
      message: "Second",
      timestamp: Date.now(),
      author: "Test",
    };

    model.setCommits([commit1]);
    model.prependCommit(commit2);

    expect(model.commits[0].id).toBe("def456");
    expect(model.commits[1].id).toBe("abc123");
  });

  it("should track loading state", () => {
    const ctx = createTestContext();
    const model = getCommitHistoryModel(ctx);

    model.setLoading(true);
    expect(model.loading).toBe(true);
  });
});

describe("UserActionsModel", () => {
  it("should handle storage actions", () => {
    const ctx = createTestContext();
    const model = getUserActionsModel(ctx);

    model.requestOpenFolder();
    expect(model.storageAction?.type).toBe("open-folder");

    model.clearStorageAction();
    expect(model.storageAction).toBeNull();
  });

  it("should handle memory storage action", () => {
    const ctx = createTestContext();
    const model = getUserActionsModel(ctx);

    model.requestUseMemory();
    expect(model.storageAction?.type).toBe("use-memory");
  });

  it("should handle file actions", () => {
    const ctx = createTestContext();
    const model = getUserActionsModel(ctx);

    model.requestStage("test.txt");
    expect(model.fileAction?.type).toBe("stage");
    expect((model.fileAction as { type: string; path: string })?.path).toBe("test.txt");

    model.clearFileAction();
    model.requestUnstage("test.txt");
    expect(model.fileAction?.type).toBe("unstage");
  });

  it("should handle commit actions", () => {
    const ctx = createTestContext();
    const model = getUserActionsModel(ctx);

    model.requestCommit("Test commit");
    expect(model.commitAction?.type).toBe("commit");
    expect((model.commitAction as { type: string; message: string })?.message).toBe("Test commit");

    model.clearCommitAction();
    model.requestRestore("abc123");
    expect(model.commitAction?.type).toBe("restore");
    expect((model.commitAction as { type: string; commitId: string })?.commitId).toBe("abc123");
  });

  it("should handle connection actions", () => {
    const ctx = createTestContext();
    const model = getUserActionsModel(ctx);

    model.requestCreateOffer();
    expect(model.connectionAction?.type).toBe("create-offer");

    model.clearConnectionAction();
    model.requestAcceptOffer("test-offer");
    expect(model.connectionAction?.type).toBe("accept-offer");
    expect((model.connectionAction as { type: string; payload: string })?.payload).toBe(
      "test-offer",
    );
  });

  it("should handle sync actions", () => {
    const ctx = createTestContext();
    const model = getUserActionsModel(ctx);

    model.requestPush();
    expect(model.syncAction?.type).toBe("push");

    model.clearSyncAction();
    model.requestFetch();
    expect(model.syncAction?.type).toBe("fetch");
  });
});

describe("SharingFormModel", () => {
  it("should initialize with idle mode", () => {
    const ctx = createTestContext();
    const model = getSharingFormModel(ctx);

    expect(model.mode).toBe("idle");
    expect(model.localSignal).toBe("");
    expect(model.remoteSignal).toBe("");
    expect(model.isProcessing).toBe(false);
  });

  it("should start share mode", () => {
    const ctx = createTestContext();
    const model = getSharingFormModel(ctx);

    model.startShare();

    expect(model.mode).toBe("share");
    expect(model.isProcessing).toBe(true);
  });

  it("should start connect mode", () => {
    const ctx = createTestContext();
    const model = getSharingFormModel(ctx);

    model.startConnect();

    expect(model.mode).toBe("connect");
    expect(model.isProcessing).toBe(false);
  });

  it("should set local signal", () => {
    const ctx = createTestContext();
    const model = getSharingFormModel(ctx);

    model.startShare();
    model.setLocalSignal("test-signal");

    expect(model.localSignal).toBe("test-signal");
    expect(model.isProcessing).toBe(false);
  });

  it("should set remote signal", () => {
    const ctx = createTestContext();
    const model = getSharingFormModel(ctx);

    model.setRemoteSignal("test-remote");
    expect(model.remoteSignal).toBe("test-remote");
  });

  it("should reset to idle", () => {
    const ctx = createTestContext();
    const model = getSharingFormModel(ctx);

    model.startShare();
    model.setLocalSignal("signal");
    model.reset();

    expect(model.mode).toBe("idle");
    expect(model.localSignal).toBe("");
    expect(model.remoteSignal).toBe("");
  });
});

describe("CommitFormModel", () => {
  it("should initialize with empty message", () => {
    const ctx = createTestContext();
    const model = getCommitFormModel(ctx);

    expect(model.message).toBe("");
    expect(model.canCommit).toBe(false);
    expect(model.isCommitting).toBe(false);
  });

  it("should validate non-empty message", () => {
    const ctx = createTestContext();
    const model = getCommitFormModel(ctx);

    model.setMessage("Test commit message");

    expect(model.message).toBe("Test commit message");
    expect(model.canCommit).toBe(true);
  });

  it("should not allow commit when committing", () => {
    const ctx = createTestContext();
    const model = getCommitFormModel(ctx);

    model.setMessage("Test");
    model.setCommitting(true);

    expect(model.canCommit).toBe(false);
  });

  it("should clear message", () => {
    const ctx = createTestContext();
    const model = getCommitFormModel(ctx);

    model.setMessage("Test");
    model.clear();

    expect(model.message).toBe("");
    expect(model.canCommit).toBe(false);
  });
});
