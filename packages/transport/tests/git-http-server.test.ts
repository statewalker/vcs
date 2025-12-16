/**
 * Tests for Git HTTP server.
 * Ported from JGit's SmartClientSmartServerTest.java and related tests.
 *
 * Tests the HTTP server handling of git smart protocol.
 */

import { describe, expect, it } from "vitest";
import type {
  HeadInfo,
  ObjectId,
  ObjectInfo,
  ObjectTypeCode,
  RefInfo,
  RepositoryAccess,
} from "../src/handlers/types.js";
import { createGitHttpServer } from "../src/http-server/git-http-server.js";
import {
  CONTENT_TYPE_RECEIVE_PACK_ADVERTISEMENT,
  CONTENT_TYPE_RECEIVE_PACK_REQUEST,
  CONTENT_TYPE_RECEIVE_PACK_RESULT,
  CONTENT_TYPE_UPLOAD_PACK_ADVERTISEMENT,
  CONTENT_TYPE_UPLOAD_PACK_REQUEST,
  CONTENT_TYPE_UPLOAD_PACK_RESULT,
} from "../src/protocol/constants.js";

// Object type codes
const OBJ_COMMIT = 1 as ObjectTypeCode;
const _OBJ_TREE = 2 as ObjectTypeCode;
const _OBJ_BLOB = 3 as ObjectTypeCode;

// Sample object IDs
const COMMIT_A = "a".repeat(40);
const _COMMIT_B = "b".repeat(40);

/**
 * Create a mock repository for testing.
 */
function createMockRepository(options?: {
  refs?: RefInfo[];
  head?: HeadInfo | null;
}): RepositoryAccess {
  const refs = options?.refs ?? [{ name: "refs/heads/master", objectId: COMMIT_A }];
  const head = options?.head ?? { target: "refs/heads/master" };

  return {
    async *listRefs(): AsyncIterable<RefInfo> {
      for (const ref of refs) {
        yield ref;
      }
    },

    async getHead(): Promise<HeadInfo | null> {
      return head;
    },

    async hasObject(_id: ObjectId): Promise<boolean> {
      return true;
    },

    async getObjectInfo(id: ObjectId): Promise<ObjectInfo | null> {
      return {
        id,
        type: OBJ_COMMIT,
        size: 100,
      };
    },

    async *loadObject(_id: ObjectId): AsyncIterable<Uint8Array> {
      yield new Uint8Array(0);
    },

    async storeObject(_type: ObjectTypeCode, _content: Uint8Array): Promise<ObjectId> {
      return "stored".repeat(8).slice(0, 40);
    },

    async updateRef(
      _name: string,
      _oldId: ObjectId | null,
      _newId: ObjectId | null,
    ): Promise<boolean> {
      return true;
    },

    async *walkObjects(
      _wants: ObjectId[],
      _haves: ObjectId[],
    ): AsyncIterable<{ id: ObjectId; type: ObjectTypeCode; content: Uint8Array }> {
      // Empty for basic tests
    },
  };
}

describe("GitHttpServer", () => {
  describe("URL parsing", () => {
    it("should handle repo.git/info/refs path", async () => {
      const repository = createMockRepository();
      const server = createGitHttpServer({
        async resolveRepository(_req, path) {
          if (path === "test.git") return repository;
          return null;
        },
      });

      const request = new Request("http://localhost/test.git/info/refs?service=git-upload-pack");
      const response = await server.fetch(request);

      expect(response.status).toBe(200);
    });

    it("should handle repo/info/refs path without .git suffix", async () => {
      const repository = createMockRepository();
      const server = createGitHttpServer({
        async resolveRepository(_req, path) {
          if (path === "test") return repository;
          return null;
        },
      });

      const request = new Request("http://localhost/test/info/refs?service=git-upload-pack");
      const response = await server.fetch(request);

      expect(response.status).toBe(200);
    });

    it("should handle nested paths like user/repo.git", async () => {
      const repository = createMockRepository();
      const server = createGitHttpServer({
        async resolveRepository(_req, path) {
          if (path === "user/repo.git") return repository;
          return null;
        },
      });

      const request = new Request(
        "http://localhost/user/repo.git/info/refs?service=git-upload-pack",
      );
      const response = await server.fetch(request);

      expect(response.status).toBe(200);
    });

    it("should respect basePath option", async () => {
      const repository = createMockRepository();
      const server = createGitHttpServer({
        basePath: "/git",
        async resolveRepository(_req, path) {
          if (path === "repo.git") return repository;
          return null;
        },
      });

      const request = new Request(
        "http://localhost/git/repo.git/info/refs?service=git-upload-pack",
      );
      const response = await server.fetch(request);

      expect(response.status).toBe(200);
    });

    it("should return 404 for unknown paths", async () => {
      const server = createGitHttpServer({
        async resolveRepository() {
          return null;
        },
      });

      const request = new Request("http://localhost/unknown/path");
      const response = await server.fetch(request);

      expect(response.status).toBe(404);
    });
  });

  describe("GET /info/refs", () => {
    it("should return upload-pack advertisement", async () => {
      const repository = createMockRepository();
      const server = createGitHttpServer({
        async resolveRepository() {
          return repository;
        },
      });

      const request = new Request("http://localhost/repo.git/info/refs?service=git-upload-pack");
      const response = await server.fetch(request);

      expect(response.status).toBe(200);
      expect(response.headers.get("Content-Type")).toBe(CONTENT_TYPE_UPLOAD_PACK_ADVERTISEMENT);

      const body = await response.text();
      expect(body).toContain("# service=git-upload-pack");
      expect(body).toContain(COMMIT_A);
    });

    it("should return receive-pack advertisement", async () => {
      const repository = createMockRepository();
      const server = createGitHttpServer({
        async resolveRepository() {
          return repository;
        },
      });

      const request = new Request("http://localhost/repo.git/info/refs?service=git-receive-pack");
      const response = await server.fetch(request);

      expect(response.status).toBe(200);
      expect(response.headers.get("Content-Type")).toBe(CONTENT_TYPE_RECEIVE_PACK_ADVERTISEMENT);

      const body = await response.text();
      expect(body).toContain("# service=git-receive-pack");
    });

    it("should return 403 without service parameter", async () => {
      const repository = createMockRepository();
      const server = createGitHttpServer({
        async resolveRepository() {
          return repository;
        },
      });

      const request = new Request("http://localhost/repo.git/info/refs");
      const response = await server.fetch(request);

      expect(response.status).toBe(403);
    });

    it("should return 403 for invalid service", async () => {
      const repository = createMockRepository();
      const server = createGitHttpServer({
        async resolveRepository() {
          return repository;
        },
      });

      const request = new Request("http://localhost/repo.git/info/refs?service=invalid");
      const response = await server.fetch(request);

      expect(response.status).toBe(403);
    });

    it("should include cache control headers", async () => {
      const repository = createMockRepository();
      const server = createGitHttpServer({
        async resolveRepository() {
          return repository;
        },
      });

      const request = new Request("http://localhost/repo.git/info/refs?service=git-upload-pack");
      const response = await server.fetch(request);

      expect(response.headers.get("Cache-Control")).toBe("no-cache");
      expect(response.headers.get("Pragma")).toBe("no-cache");
    });
  });

  describe("POST /git-upload-pack", () => {
    it("should handle valid upload-pack request", async () => {
      const repository = createMockRepository();
      const server = createGitHttpServer({
        async resolveRepository() {
          return repository;
        },
      });

      // Send empty want request (just flush)
      const body = "0000";
      const request = new Request("http://localhost/repo.git/git-upload-pack", {
        method: "POST",
        headers: {
          "Content-Type": CONTENT_TYPE_UPLOAD_PACK_REQUEST,
        },
        body,
      });

      const response = await server.fetch(request);

      expect(response.status).toBe(200);
      expect(response.headers.get("Content-Type")).toBe(CONTENT_TYPE_UPLOAD_PACK_RESULT);
    });

    it("should return 415 for wrong content type", async () => {
      const repository = createMockRepository();
      const server = createGitHttpServer({
        async resolveRepository() {
          return repository;
        },
      });

      const request = new Request("http://localhost/repo.git/git-upload-pack", {
        method: "POST",
        headers: {
          "Content-Type": "text/plain",
        },
        body: "test",
      });

      const response = await server.fetch(request);

      expect(response.status).toBe(415);
    });
  });

  describe("POST /git-receive-pack", () => {
    it("should handle valid receive-pack request", async () => {
      const repository = createMockRepository();
      const server = createGitHttpServer({
        async resolveRepository() {
          return repository;
        },
      });

      // Send empty command (just flush)
      const body = "0000";
      const request = new Request("http://localhost/repo.git/git-receive-pack", {
        method: "POST",
        headers: {
          "Content-Type": CONTENT_TYPE_RECEIVE_PACK_REQUEST,
        },
        body,
      });

      const response = await server.fetch(request);

      expect(response.status).toBe(200);
      expect(response.headers.get("Content-Type")).toBe(CONTENT_TYPE_RECEIVE_PACK_RESULT);
    });

    it("should return 415 for wrong content type", async () => {
      const repository = createMockRepository();
      const server = createGitHttpServer({
        async resolveRepository() {
          return repository;
        },
      });

      const request = new Request("http://localhost/repo.git/git-receive-pack", {
        method: "POST",
        headers: {
          "Content-Type": "text/plain",
        },
        body: "test",
      });

      const response = await server.fetch(request);

      expect(response.status).toBe(415);
    });
  });

  describe("Authentication", () => {
    it("should call authenticate callback", async () => {
      let authenticateCalled = false;
      const repository = createMockRepository();
      const server = createGitHttpServer({
        async resolveRepository() {
          return repository;
        },
        async authenticate() {
          authenticateCalled = true;
          return true;
        },
      });

      const request = new Request("http://localhost/repo.git/info/refs?service=git-upload-pack");
      await server.fetch(request);

      expect(authenticateCalled).toBe(true);
    });

    it("should return 401 when authentication fails", async () => {
      const repository = createMockRepository();
      const server = createGitHttpServer({
        async resolveRepository() {
          return repository;
        },
        async authenticate() {
          return false;
        },
      });

      const request = new Request("http://localhost/repo.git/info/refs?service=git-upload-pack");
      const response = await server.fetch(request);

      expect(response.status).toBe(401);
      expect(response.headers.get("WWW-Authenticate")).toContain("Basic");
    });
  });

  describe("Authorization", () => {
    it("should call authorize callback for fetch operations", async () => {
      let authorizeAction: string | null = null;
      const repository = createMockRepository();
      const server = createGitHttpServer({
        async resolveRepository() {
          return repository;
        },
        async authorize(_req, _repo, action) {
          authorizeAction = action;
          return true;
        },
      });

      const body = "0000";
      const request = new Request("http://localhost/repo.git/git-upload-pack", {
        method: "POST",
        headers: {
          "Content-Type": CONTENT_TYPE_UPLOAD_PACK_REQUEST,
        },
        body,
      });

      await server.fetch(request);

      expect(authorizeAction).toBe("fetch");
    });

    it("should call authorize callback for push operations", async () => {
      let authorizeAction: string | null = null;
      const repository = createMockRepository();
      const server = createGitHttpServer({
        async resolveRepository() {
          return repository;
        },
        async authorize(_req, _repo, action) {
          authorizeAction = action;
          return true;
        },
      });

      const body = "0000";
      const request = new Request("http://localhost/repo.git/git-receive-pack", {
        method: "POST",
        headers: {
          "Content-Type": CONTENT_TYPE_RECEIVE_PACK_REQUEST,
        },
        body,
      });

      await server.fetch(request);

      expect(authorizeAction).toBe("push");
    });

    it("should return 403 when authorization fails", async () => {
      const repository = createMockRepository();
      const server = createGitHttpServer({
        async resolveRepository() {
          return repository;
        },
        async authorize() {
          return false;
        },
      });

      const body = "0000";
      const request = new Request("http://localhost/repo.git/git-upload-pack", {
        method: "POST",
        headers: {
          "Content-Type": CONTENT_TYPE_UPLOAD_PACK_REQUEST,
        },
        body,
      });

      const response = await server.fetch(request);

      expect(response.status).toBe(403);
    });
  });

  describe("Error handling", () => {
    it("should return 404 for non-existent repository", async () => {
      const server = createGitHttpServer({
        async resolveRepository() {
          return null;
        },
      });

      const request = new Request("http://localhost/unknown.git/info/refs?service=git-upload-pack");
      const response = await server.fetch(request);

      expect(response.status).toBe(404);
    });

    it("should call onError callback on exception", async () => {
      let errorCalled = false;
      const server = createGitHttpServer({
        async resolveRepository() {
          throw new Error("Test error");
        },
        onError(_error) {
          errorCalled = true;
          return new Response("Custom error", { status: 500 });
        },
      });

      const request = new Request("http://localhost/repo.git/info/refs?service=git-upload-pack");
      const response = await server.fetch(request);

      expect(errorCalled).toBe(true);
      expect(response.status).toBe(500);
    });

    it("should return 500 for unhandled exceptions", async () => {
      const server = createGitHttpServer({
        async resolveRepository() {
          throw new Error("Test error");
        },
      });

      const request = new Request("http://localhost/repo.git/info/refs?service=git-upload-pack");
      const response = await server.fetch(request);

      expect(response.status).toBe(500);
    });
  });
});
