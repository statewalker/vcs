/**
 * HTTP Push Client Tests
 *
 * Tests for httpPush function in http-client.ts.
 */

import { describe, expect, it } from "vitest";
import { httpPush } from "../../src/adapters/http/http-client.js";
import { TestRepository } from "../helpers/test-repository.js";

describe("httpPush", () => {
  describe("Error handling", () => {
    it("should return error when info/refs request fails", async () => {
      const repo = new TestRepository();
      repo.setRef("refs/heads/main", "a".repeat(40));

      const result = await httpPush("http://localhost/repo.git", repo, repo, {
        refspecs: ["refs/heads/main"],
        fetchFn: async () => new Response(null, { status: 404, statusText: "Not Found" }),
      });

      expect(result.success).toBe(false);
      expect(result.error).toContain("Failed to get refs");
    });

    it("should return error when receive-pack request fails", async () => {
      const repo = new TestRepository();
      repo.setRef("refs/heads/main", "a".repeat(40));

      let requestCount = 0;
      const result = await httpPush("http://localhost/repo.git", repo, repo, {
        refspecs: ["refs/heads/main"],
        fetchFn: async () => {
          requestCount++;
          if (requestCount === 1) {
            // info/refs succeeds
            const body =
              "001f# service=git-receive-pack\n0000" +
              "004b" +
              "a".repeat(40) +
              " refs/heads/main\0report-status\n0000";
            return new Response(body, { status: 200 });
          }
          // receive-pack fails
          return new Response(null, { status: 500, statusText: "Internal Server Error" });
        },
      });

      expect(result.success).toBe(false);
      expect(result.error).toContain("Failed to receive-pack");
    });

    it("should return error when network fails", async () => {
      const repo = new TestRepository();
      repo.setRef("refs/heads/main", "a".repeat(40));

      const result = await httpPush("http://localhost/repo.git", repo, repo, {
        refspecs: ["refs/heads/main"],
        fetchFn: async () => {
          throw new Error("Network error");
        },
      });

      expect(result.success).toBe(false);
      expect(result.error).toContain("Network error");
    });

    it("should return empty result when no refspecs provided", async () => {
      const repo = new TestRepository();

      let _requestCount = 0;
      const result = await httpPush("http://localhost/repo.git", repo, repo, {
        refspecs: [],
        fetchFn: async () => {
          _requestCount++;
          // info/refs succeeds
          const body = "001f# service=git-receive-pack\n00000000";
          return new Response(body, { status: 200 });
        },
      });

      expect(result.success).toBe(true);
      expect(result.refStatus?.size).toBe(0);
    });
  });

  describe("Authentication", () => {
    it("should include Authorization header when credentials provided", async () => {
      const repo = new TestRepository();
      repo.setRef("refs/heads/main", "a".repeat(40));

      let capturedHeaders: Headers | null = null;

      await httpPush("http://localhost/repo.git", repo, repo, {
        refspecs: ["refs/heads/main"],
        credentials: { username: "user", password: "pass" },
        fetchFn: async (_url, init) => {
          capturedHeaders = new Headers(init?.headers);
          // Return 404 to stop the flow
          return new Response(null, { status: 404 });
        },
      });

      expect(capturedHeaders).not.toBeNull();
      expect(capturedHeaders?.has("Authorization")).toBe(true);
      expect(capturedHeaders?.get("Authorization")).toMatch(/^Basic /);
    });
  });

  describe("URL handling", () => {
    it("should handle URL with trailing slash", async () => {
      const repo = new TestRepository();
      repo.setRef("refs/heads/main", "a".repeat(40));

      let capturedUrl = "";

      await httpPush("http://localhost/repo.git/", repo, repo, {
        refspecs: ["refs/heads/main"],
        fetchFn: async (url) => {
          capturedUrl = url.toString();
          return new Response(null, { status: 404 });
        },
      });

      expect(capturedUrl).toContain("/repo.git/info/refs");
      expect(capturedUrl).not.toContain("//info/refs");
    });

    it("should construct correct info/refs URL", async () => {
      const repo = new TestRepository();
      repo.setRef("refs/heads/main", "a".repeat(40));

      let capturedUrl = "";

      await httpPush("http://localhost/repo.git", repo, repo, {
        refspecs: ["refs/heads/main"],
        fetchFn: async (url) => {
          capturedUrl = url.toString();
          return new Response(null, { status: 404 });
        },
      });

      expect(capturedUrl).toBe("http://localhost/repo.git/info/refs?service=git-receive-pack");
    });
  });

  describe("Refspec parsing", () => {
    it("should handle simple refspec without colon", async () => {
      const repo = new TestRepository();
      const oid = repo.createEmptyCommit("Test");
      repo.setRef("refs/heads/main", oid);

      let sentRefName = "";
      let requestCount = 0;

      await httpPush("http://localhost/repo.git", repo, repo, {
        refspecs: ["refs/heads/main"],
        fetchFn: async (_url, init) => {
          requestCount++;
          if (requestCount === 1) {
            // info/refs
            const body = "001f# service=git-receive-pack\n00000000";
            return new Response(body, { status: 200 });
          }
          // receive-pack - capture the body
          if (init?.body) {
            const bodyArray = init.body as Uint8Array;
            const bodyText = new TextDecoder().decode(bodyArray);
            // Extract ref name from update line
            const match = bodyText.match(/refs\/heads\/\w+/);
            if (match) sentRefName = match[0];
          }
          return new Response("0000", { status: 200 });
        },
      });

      expect(sentRefName).toBe("refs/heads/main");
    });

    it("should handle refspec with different local and remote names", async () => {
      const repo = new TestRepository();
      const oid = repo.createEmptyCommit("Test");
      repo.setRef("refs/heads/feature", oid);

      let sentRefName = "";
      let requestCount = 0;

      await httpPush("http://localhost/repo.git", repo, repo, {
        refspecs: ["refs/heads/feature:refs/heads/main"],
        fetchFn: async (_url, init) => {
          requestCount++;
          if (requestCount === 1) {
            // info/refs
            const body = "001f# service=git-receive-pack\n00000000";
            return new Response(body, { status: 200 });
          }
          // receive-pack
          if (init?.body) {
            const bodyArray = init.body as Uint8Array;
            const bodyText = new TextDecoder().decode(bodyArray);
            // The remote ref should be main
            if (bodyText.includes("refs/heads/main")) {
              sentRefName = "refs/heads/main";
            }
          }
          return new Response("0000", { status: 200 });
        },
      });

      expect(sentRefName).toBe("refs/heads/main");
    });
  });

  describe("Progress callback", () => {
    it("should call progress callback during push", async () => {
      const repo = new TestRepository();
      repo.setRef("refs/heads/main", "a".repeat(40));

      const progressMessages: string[] = [];

      await httpPush("http://localhost/repo.git", repo, repo, {
        refspecs: ["refs/heads/main"],
        onProgress: (msg) => progressMessages.push(msg),
        fetchFn: async () => new Response(null, { status: 404 }),
      });

      expect(progressMessages.length).toBeGreaterThan(0);
      expect(progressMessages[0]).toContain("Fetching remote refs");
    });
  });

  describe("Headers", () => {
    it("should include custom headers in request", async () => {
      const repo = new TestRepository();
      repo.setRef("refs/heads/main", "a".repeat(40));

      let capturedHeaders: Headers | null = null;

      await httpPush("http://localhost/repo.git", repo, repo, {
        refspecs: ["refs/heads/main"],
        headers: { "X-Custom-Header": "test-value" },
        fetchFn: async (_url, init) => {
          capturedHeaders = new Headers(init?.headers);
          return new Response(null, { status: 404 });
        },
      });

      expect(capturedHeaders).not.toBeNull();
      expect(capturedHeaders?.get("X-Custom-Header")).toBe("test-value");
    });
  });
});
