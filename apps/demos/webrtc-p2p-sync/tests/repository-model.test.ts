/**
 * Tests for RepositoryModel with staging state.
 */

import { describe, expect, it, vi } from "vitest";
import { RepositoryModel } from "../src/models/repository-model.js";

describe("RepositoryModel", () => {
  it("should initialize with empty state", () => {
    const model = new RepositoryModel();
    const state = model.getState();

    expect(state.initialized).toBe(false);
    expect(state.branch).toBeNull();
    expect(state.commitCount).toBe(0);
    expect(state.files).toEqual([]);
    expect(state.headCommitId).toBeNull();
    expect(state.commits).toEqual([]);
    expect(state.staged).toEqual([]);
    expect(state.unstaged).toEqual([]);
    expect(state.untracked).toEqual([]);
  });

  it("should update state and notify listeners", () => {
    const model = new RepositoryModel();
    const listener = vi.fn();

    model.onUpdate(listener);
    model.update({
      initialized: true,
      branch: "main",
      commitCount: 1,
    });

    expect(listener).toHaveBeenCalled();
    expect(model.getState().initialized).toBe(true);
    expect(model.getState().branch).toBe("main");
    expect(model.getState().commitCount).toBe(1);
  });

  it("should update staging state", () => {
    const model = new RepositoryModel();

    model.update({
      staged: ["file1.txt", "file2.txt"],
      unstaged: ["file3.txt"],
      untracked: ["file4.txt"],
    });

    expect(model.getState().staged).toEqual(["file1.txt", "file2.txt"]);
    expect(model.getState().unstaged).toEqual(["file3.txt"]);
    expect(model.getState().untracked).toEqual(["file4.txt"]);
  });

  it("should set files", () => {
    const model = new RepositoryModel();
    const files = [
      { name: "README.md", path: "README.md", type: "file" as const },
      { name: "src", path: "src", type: "directory" as const },
    ];

    model.setFiles(files);

    expect(model.getState().files).toEqual(files);
  });

  it("should set commits", () => {
    const model = new RepositoryModel();
    const commits = [
      { id: "abc123", message: "Initial commit", author: "Test", timestamp: new Date() },
    ];

    model.setCommits(commits);

    expect(model.getState().commits).toEqual(commits);
    expect(model.getState().commitCount).toBe(1);
  });

  it("should add commit to beginning", () => {
    const model = new RepositoryModel();
    const commit1 = { id: "abc123", message: "First", author: "Test", timestamp: new Date() };
    const commit2 = { id: "def456", message: "Second", author: "Test", timestamp: new Date() };

    model.setCommits([commit1]);
    model.addCommit(commit2);

    expect(model.getState().commits[0].id).toBe("def456");
    expect(model.getState().commits[1].id).toBe("abc123");
    expect(model.getState().headCommitId).toBe("def456");
  });

  it("should reset to initial state", () => {
    const model = new RepositoryModel();

    model.update({
      initialized: true,
      branch: "main",
      staged: ["file.txt"],
    });

    model.reset();

    const state = model.getState();
    expect(state.initialized).toBe(false);
    expect(state.branch).toBeNull();
    expect(state.staged).toEqual([]);
    expect(state.unstaged).toEqual([]);
    expect(state.untracked).toEqual([]);
  });
});
