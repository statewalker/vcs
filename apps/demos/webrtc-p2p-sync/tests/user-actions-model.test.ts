/**
 * Tests for UserActionsModel with staging actions.
 */

import { describe, expect, it, vi } from "vitest";
import { UserActionsModel } from "../src/models/user-actions-model.js";

describe("UserActionsModel", () => {
  it("should initialize with no pending actions", () => {
    const model = new UserActionsModel();

    expect(model.getPending()).toEqual([]);
    expect(model.hasPending).toBe(false);
  });

  it("should request stage action", () => {
    const model = new UserActionsModel();

    model.requestStageFile("file.txt");

    expect(model.hasPending).toBe(true);
    const actions = model.consume("file:stage");
    expect(actions).toHaveLength(1);
    expect((actions[0].payload as { path: string }).path).toBe("file.txt");
  });

  it("should request unstage action", () => {
    const model = new UserActionsModel();

    model.requestUnstageFile("file.txt");

    const actions = model.consume("file:unstage");
    expect(actions).toHaveLength(1);
    expect((actions[0].payload as { path: string }).path).toBe("file.txt");
  });

  it("should request stage all action", () => {
    const model = new UserActionsModel();

    model.requestStageAll();

    const actions = model.consume("stage:all");
    expect(actions).toHaveLength(1);
  });

  it("should request add file action", () => {
    const model = new UserActionsModel();

    model.requestAddFile("new-file.txt", "content");

    const actions = model.consume("file:add");
    expect(actions).toHaveLength(1);
    expect((actions[0].payload as { name: string }).name).toBe("new-file.txt");
    expect((actions[0].payload as { content: string }).content).toBe("content");
  });

  it("should request commit action", () => {
    const model = new UserActionsModel();

    model.requestCommit("Test commit message");

    const actions = model.consume("commit:create");
    expect(actions).toHaveLength(1);
    expect((actions[0].payload as { message: string }).message).toBe("Test commit message");
  });

  it("should notify on action request", () => {
    const model = new UserActionsModel();
    const listener = vi.fn();

    model.onUpdate(listener);
    model.requestInitRepo();

    expect(listener).toHaveBeenCalled();
  });

  it("should consume actions of specific type", () => {
    const model = new UserActionsModel();

    model.requestInitRepo();
    model.requestRefreshRepo();
    model.requestStageFile("file.txt");

    // Consume only stage actions
    const stageActions = model.consume("file:stage");
    expect(stageActions).toHaveLength(1);

    // Other actions should still be pending
    expect(model.getPending()).toHaveLength(2);
  });

  it("should consume all actions", () => {
    const model = new UserActionsModel();

    model.requestInitRepo();
    model.requestRefreshRepo();

    const all = model.consumeAll();
    expect(all).toHaveLength(2);
    expect(model.hasPending).toBe(false);
  });

  it("should clear all actions", () => {
    const model = new UserActionsModel();

    model.requestInitRepo();
    model.requestRefreshRepo();
    model.clear();

    expect(model.hasPending).toBe(false);
  });
});
