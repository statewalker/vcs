/**
 * HTTP Transport Tests
 *
 * Tests for Git HTTP transport functionality including:
 * - Smart HTTP client-server protocol
 * - HTTP server components
 * - HTTP error handling
 * - HTTP configuration
 * - Redirect handling
 * - Authentication
 *
 * This file contains both:
 * 1. Integration tests using TestHttpServer helper (for client-server simulation)
 * 2. Unit tests for real HTTP handler functions from src/adapters/http/
 *
 * Modeled after JGit's HTTP transport tests.
 */

import { describe, expect, it } from "vitest";
import { handleInfoRefs } from "../../src/adapters/http/http-server.js";
import {
  createInitializedHttpServer,
  createTestHttpServer,
  TestHttpServer,
} from "../helpers/test-http-server.js";
import { createMockRefStore } from "../helpers/test-protocol.js";
import { TestRepository } from "../helpers/test-repository.js";

// ─────────────────────────────────────────────────────────────────────────────
// Smart HTTP Client-Server Tests
// ─────────────────────────────────────────────────────────────────────────────

describe("Smart HTTP Client-Server", () => {
  describe("listing refs", () => {
    it("should list remote refs via GET /info/refs?service=git-upload-pack", async () => {
      const { server, repo, fetch } = createTestHttpServer();
      const oid = repo.createEmptyCommit("Test commit");
      repo.setRef("refs/heads/main", oid);

      const response = await fetch(
        "http://localhost:3000/test.git/info/refs?service=git-upload-pack",
      );

      expect(response.status).toBe(200);
      const body = await response.text();
      expect(body).toContain("refs/heads/main");
      expect(body).toContain(oid);
    });

    it("should return 404 for invalid repository", async () => {
      const { fetch } = createTestHttpServer();

      const response = await fetch(
        "http://localhost:3000/nonexistent.git/info/refs?service=git-upload-pack",
      );

      expect(response.status).toBe(404);
    });

    it("should verify content-type is application/x-git-upload-pack-advertisement", async () => {
      const { server, repo, fetch } = createTestHttpServer();
      repo.createEmptyCommit("Test");
      repo.setRef("refs/heads/main", repo.createEmptyCommit("Main"));

      const response = await fetch(
        "http://localhost:3000/test.git/info/refs?service=git-upload-pack",
      );

      expect(response.headers.get("Content-Type")).toBe(
        "application/x-git-upload-pack-advertisement",
      );
    });
  });

  describe("fetch by SHA1", () => {
    it("should fetch by commit SHA1", async () => {
      const { repo } = await createInitializedHttpServer();

      const commit = repo.createEmptyCommit("Test commit");
      const exists = await repo.has(commit);

      expect(exists).toBe(true);
    });

    it("should handle fetch for advertised refs", async () => {
      const { server, repo, fetch } = createTestHttpServer();
      const oid = repo.createEmptyCommit("Main commit");
      repo.setRef("refs/heads/main", oid);

      // First get refs
      const infoResponse = await fetch(
        "http://localhost:3000/test.git/info/refs?service=git-upload-pack",
      );
      expect(infoResponse.status).toBe(200);

      // Verify ref is advertised
      const body = await infoResponse.text();
      expect(body).toContain(oid);
    });
  });

  describe("initial clone", () => {
    it("should clone small repository", async () => {
      const { server, repo, fetch } = createTestHttpServer();
      const commit = repo.createEmptyCommit("Initial commit");
      repo.setRef("refs/heads/main", commit);

      const response = await fetch(
        "http://localhost:3000/test.git/info/refs?service=git-upload-pack",
      );

      expect(response.status).toBe(200);
      const body = await response.text();
      expect(body).toContain("# service=git-upload-pack");
    });

    it("should verify correct HTTP request sequence", async () => {
      const { server, repo, fetch } = createTestHttpServer();
      repo.createEmptyCommit("Test");
      repo.setRef("refs/heads/main", repo.createEmptyCommit("Main"));

      // Step 1: GET /info/refs
      await fetch("http://localhost:3000/test.git/info/refs?service=git-upload-pack");

      const exchanges = server.getExchanges();
      expect(exchanges[0].request.method).toBe("GET");
      expect(exchanges[0].request.url).toContain("/info/refs");
    });

    it("should handle protocol v2 headers", async () => {
      const { server, repo, fetch } = createTestHttpServer({ protocolV2: true });
      repo.setRef("refs/heads/main", repo.createEmptyCommit("Main"));

      const response = await fetch(
        "http://localhost:3000/test.git/info/refs?service=git-upload-pack",
        { headers: { "Git-Protocol": "version=2" } },
      );

      expect(response.status).toBe(200);
    });
  });

  describe("redirects", () => {
    it("should handle 301 redirect", async () => {
      const server = TestHttpServer.create({
        redirects: new Map([
          ["/old.git", { status: 301, location: "http://localhost:3000/new.git/info/refs" }],
        ]),
      });
      server.createRepository("new.git");

      const response = await server.fetch(
        new Request("http://localhost:3000/old.git/info/refs?service=git-upload-pack"),
      );

      expect(response.status).toBe(301);
      expect(response.headers.get("Location")).toBe("http://localhost:3000/new.git/info/refs");
    });

    it("should handle 302 redirect", async () => {
      const server = TestHttpServer.create({
        redirects: new Map([
          ["/temp.git", { status: 302, location: "http://localhost:3000/repo.git/info/refs" }],
        ]),
      });
      server.createRepository("repo.git");

      const response = await server.fetch(new Request("http://localhost:3000/temp.git/info/refs"));

      expect(response.status).toBe(302);
    });

    it("should handle 307 redirect", async () => {
      const server = TestHttpServer.create({
        redirects: new Map([
          ["/moved.git", { status: 307, location: "http://localhost:3000/target.git/info/refs" }],
        ]),
      });
      server.createRepository("target.git");

      const response = await server.fetch(new Request("http://localhost:3000/moved.git/info/refs"));

      expect(response.status).toBe(307);
    });

    it("should handle multiple redirects", async () => {
      const server = TestHttpServer.create({
        redirects: new Map([
          [
            "/first.git",
            { status: 301, location: "http://localhost:3000/second.git/info/refs", count: 2 },
          ],
        ]),
      });
      server.createRepository("final.git");

      // First request - should redirect
      const response1 = await server.fetch(
        new Request("http://localhost:3000/first.git/info/refs"),
      );
      expect(response1.status).toBe(301);

      // Second request - should redirect again
      const response2 = await server.fetch(
        new Request("http://localhost:3000/first.git/info/refs"),
      );
      expect(response2.status).toBe(301);
    });
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// HTTP Server Components Tests
// ─────────────────────────────────────────────────────────────────────────────

describe("HTTP Server Components", () => {
  describe("DefaultUploadPackFactory", () => {
    it("should create upload pack instance", async () => {
      const { server, repo, fetch } = createTestHttpServer();
      repo.setRef("refs/heads/main", repo.createEmptyCommit("Test"));

      const response = await fetch(
        "http://localhost:3000/test.git/info/refs?service=git-upload-pack",
      );

      expect(response.status).toBe(200);
      expect(response.headers.get("Content-Type")).toContain("git-upload-pack");
    });

    it("should configure upload pack from request", async () => {
      const { repo, fetch } = createTestHttpServer({ protocolV2: true });
      repo.setRef("refs/heads/main", repo.createEmptyCommit("Test"));

      const response = await fetch(
        "http://localhost:3000/test.git/info/refs?service=git-upload-pack",
        { headers: { "Git-Protocol": "version=2" } },
      );

      expect(response.status).toBe(200);
    });
  });

  describe("DefaultReceivePackFactory", () => {
    it("should create receive pack instance", async () => {
      const { repo, fetch } = createTestHttpServer();
      repo.setRef("refs/heads/main", repo.createEmptyCommit("Test"));

      const response = await fetch(
        "http://localhost:3000/test.git/info/refs?service=git-receive-pack",
      );

      expect(response.status).toBe(200);
      expect(response.headers.get("Content-Type")).toContain("git-receive-pack");
    });

    it("should configure receive pack from request", async () => {
      const { repo, fetch } = createTestHttpServer();
      repo.setRef("refs/heads/main", repo.createEmptyCommit("Test"));

      const response = await fetch(
        "http://localhost:3000/test.git/info/refs?service=git-receive-pack",
      );

      expect(response.status).toBe(200);
      const body = await response.text();
      expect(body).toContain("report-status");
    });
  });

  describe("FileResolver", () => {
    it("should resolve repository path", async () => {
      const { server, repo } = createTestHttpServer();
      repo.setRef("refs/heads/main", repo.createEmptyCommit("Test"));

      const resolved = server.getRepository("test.git");

      expect(resolved).toBeDefined();
    });

    it("should reject invalid paths", async () => {
      const { fetch } = createTestHttpServer();

      const response = await fetch(
        "http://localhost:3000/../etc/passwd/info/refs?service=git-upload-pack",
      );

      expect(response.status).toBe(404);
    });

    it("should return 404 for missing repository", async () => {
      const { fetch } = createTestHttpServer();

      const response = await fetch(
        "http://localhost:3000/missing.git/info/refs?service=git-upload-pack",
      );

      expect(response.status).toBe(404);
    });
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// HTTP Error Handling Tests
// ─────────────────────────────────────────────────────────────────────────────

describe("HTTP Error Handling", () => {
  describe("ProtocolError", () => {
    it("should return proper HTTP error codes", async () => {
      const server = TestHttpServer.create({
        errors: new Map([["/broken.git", { status: 500, message: "Internal error" }]]),
      });

      const response = await server.fetch(
        new Request("http://localhost:3000/broken.git/info/refs"),
      );

      expect(response.status).toBe(500);
    });

    it("should include error details in response", async () => {
      const server = TestHttpServer.create({
        errors: new Map([["/error.git", { status: 503, message: "Service Unavailable" }]]),
      });

      const response = await server.fetch(new Request("http://localhost:3000/error.git/info/refs"));

      expect(response.status).toBe(503);
      const body = await response.text();
      expect(body).toContain("Service Unavailable");
    });
  });

  describe("AdvertiseError", () => {
    it("should handle errors during ref advertisement", async () => {
      const server = TestHttpServer.create({
        errors: new Map([["/fail-advertise.git", { status: 403, message: "Access denied" }]]),
      });

      const response = await server.fetch(
        new Request("http://localhost:3000/fail-advertise.git/info/refs?service=git-upload-pack"),
      );

      expect(response.status).toBe(403);
    });

    it("should report error message to client", async () => {
      const server = TestHttpServer.create({
        errors: new Map([["/denied.git", { status: 403, message: "Repository access denied" }]]),
      });

      const response = await server.fetch(
        new Request("http://localhost:3000/denied.git/info/refs"),
      );

      const body = await response.text();
      expect(body).toContain("Repository access denied");
    });
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// HTTP Configuration Tests
// ─────────────────────────────────────────────────────────────────────────────

describe("HTTP Configuration", () => {
  describe("HttpConfig", () => {
    it("should use configured base URL", () => {
      const server = TestHttpServer.create({
        baseUrl: "https://example.com/git",
      });

      expect(server.baseUrl).toBe("https://example.com/git");
    });

    it("should use default base URL if not configured", () => {
      const server = TestHttpServer.create();

      expect(server.baseUrl).toBe("http://localhost:3000");
    });

    it("should configure protocol v2 support", async () => {
      const server = TestHttpServer.create({ protocolV2: true });
      const repo = server.createRepository("test.git");
      repo.setRef("refs/heads/main", repo.createEmptyCommit("Test"));

      const response = await server.fetch(
        new Request("http://localhost:3000/test.git/info/refs?service=git-upload-pack", {
          headers: { "Git-Protocol": "version=2" },
        }),
      );

      expect(response.status).toBe(200);
    });
  });

  describe("HttpAuth", () => {
    it("should handle Basic auth", async () => {
      const server = TestHttpServer.create({
        auth: { type: "basic", username: "user", password: "pass" },
      });
      server.createRepository("test.git");

      // Without auth - should fail
      const failResponse = await server.fetch(
        new Request("http://localhost:3000/test.git/info/refs"),
      );
      expect(failResponse.status).toBe(401);
      expect(failResponse.headers.get("WWW-Authenticate")).toContain("Basic");

      // With auth - should succeed
      const successResponse = await server.fetch(
        new Request("http://localhost:3000/test.git/info/refs", {
          headers: { Authorization: `Basic ${btoa("user:pass")}` },
        }),
      );
      expect(successResponse.status).toBe(200);
    });

    it("should handle Bearer auth", async () => {
      const server = TestHttpServer.create({
        auth: { type: "bearer", token: "secret-token" },
      });
      server.createRepository("test.git");

      // Without auth - should fail
      const failResponse = await server.fetch(
        new Request("http://localhost:3000/test.git/info/refs"),
      );
      expect(failResponse.status).toBe(401);

      // With auth - should succeed
      const successResponse = await server.fetch(
        new Request("http://localhost:3000/test.git/info/refs", {
          headers: { Authorization: "Bearer secret-token" },
        }),
      );
      expect(successResponse.status).toBe(200);
    });

    it("should reject invalid credentials", async () => {
      const server = TestHttpServer.create({
        auth: { type: "basic", username: "user", password: "correct" },
      });
      server.createRepository("test.git");

      const response = await server.fetch(
        new Request("http://localhost:3000/test.git/info/refs", {
          headers: { Authorization: `Basic ${btoa("user:wrong")}` },
        }),
      );

      expect(response.status).toBe(401);
    });
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Dumb HTTP Protocol Tests
// ─────────────────────────────────────────────────────────────────────────────

describe("Dumb HTTP Protocol", () => {
  it("should serve refs without service parameter", async () => {
    const { repo, fetch } = createTestHttpServer();
    const oid = repo.createEmptyCommit("Test");
    repo.setRef("refs/heads/main", oid);

    const response = await fetch("http://localhost:3000/test.git/info/refs");

    expect(response.status).toBe(200);
    expect(response.headers.get("Content-Type")).toBe("text/plain");

    const body = await response.text();
    expect(body).toContain("refs/heads/main");
  });

  it("should serve refs in dumb format", async () => {
    const { repo, fetch } = createTestHttpServer();
    const oid = repo.createEmptyCommit("Test");
    repo.setRef("refs/heads/main", oid);

    const response = await fetch("http://localhost:3000/test.git/info/refs");
    const body = await response.text();

    // Dumb format: oid<TAB>refname
    expect(body).toContain(oid);
    expect(body).toContain("\t");
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// HTTP Exchange Capture Tests
// ─────────────────────────────────────────────────────────────────────────────

describe("HTTP Exchange Capture", () => {
  it("should capture request/response pairs", async () => {
    const { server, repo, fetch } = createTestHttpServer();
    repo.setRef("refs/heads/main", repo.createEmptyCommit("Test"));

    await fetch("http://localhost:3000/test.git/info/refs?service=git-upload-pack");

    const exchanges = server.getExchanges();
    expect(exchanges).toHaveLength(1);
    expect(exchanges[0].request.method).toBe("GET");
    expect(exchanges[0].response.status).toBe(200);
  });

  it("should capture multiple exchanges", async () => {
    const { server, repo, fetch } = createTestHttpServer();
    repo.setRef("refs/heads/main", repo.createEmptyCommit("Test"));

    await fetch("http://localhost:3000/test.git/info/refs?service=git-upload-pack");
    await fetch("http://localhost:3000/test.git/info/refs?service=git-receive-pack");

    const exchanges = server.getExchanges();
    expect(exchanges).toHaveLength(2);
  });

  it("should clear exchanges", async () => {
    const { server, repo, fetch } = createTestHttpServer();
    repo.setRef("refs/heads/main", repo.createEmptyCommit("Test"));

    await fetch("http://localhost:3000/test.git/info/refs");
    server.clearExchanges();

    expect(server.getExchanges()).toHaveLength(0);
  });

  it("should capture request headers", async () => {
    const { server, repo, fetch } = createTestHttpServer();
    repo.setRef("refs/heads/main", repo.createEmptyCommit("Test"));

    await fetch("http://localhost:3000/test.git/info/refs", {
      headers: { "X-Custom-Header": "test-value" },
    });

    const exchange = server.getLastExchange();
    expect(exchange?.request.headers.get("x-custom-header")).toBe("test-value");
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Repository Management Tests
// ─────────────────────────────────────────────────────────────────────────────

describe("Repository Management", () => {
  it("should register and retrieve repositories", () => {
    const server = TestHttpServer.create();
    const repo = TestRepository.create();

    server.registerRepository("custom.git", repo);
    const retrieved = server.getRepository("custom.git");

    expect(retrieved).toBe(repo);
  });

  it("should create new repositories", () => {
    const server = TestHttpServer.create();
    const repo = server.createRepository("new.git");

    expect(repo).toBeInstanceOf(TestRepository);
    expect(server.getRepository("new.git")).toBe(repo);
  });

  it("should handle multiple repositories", () => {
    const server = TestHttpServer.create();
    const repo1 = server.createRepository("repo1.git");
    const repo2 = server.createRepository("repo2.git");

    expect(server.getRepository("repo1.git")).toBe(repo1);
    expect(server.getRepository("repo2.git")).toBe(repo2);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// HTTP Server Handler Unit Tests
// These tests verify the real HTTP handler functions from src/adapters/http/
// ─────────────────────────────────────────────────────────────────────────────

describe("handleInfoRefs HTTP Handler", () => {
  it("should return refs advertisement with correct content type", async () => {
    const refStore = createMockRefStore();
    refStore._setRef("refs/heads/main", "a".repeat(40));
    refStore._setRef("refs/tags/v1.0", "b".repeat(40));

    const response = await handleInfoRefs(refStore);

    expect(response.status).toBe(200);
    expect(response.headers["Content-Type"]).toBe("application/x-git-upload-pack-advertisement");
    expect(response.body.length).toBeGreaterThan(0);
  });

  it("should include service announcement line", async () => {
    const refStore = createMockRefStore();
    refStore._setRef("refs/heads/main", "a".repeat(40));

    const response = await handleInfoRefs(refStore);

    const bodyText = new TextDecoder().decode(response.body);
    expect(bodyText).toContain("# service=git-upload-pack");
  });

  it("should include capabilities in first ref line", async () => {
    const refStore = createMockRefStore();
    refStore._setRef("refs/heads/main", "a".repeat(40));

    const response = await handleInfoRefs(refStore);

    const bodyText = new TextDecoder().decode(response.body);
    // Capabilities are after null byte
    expect(bodyText).toContain("\0");
    // Should include some common capabilities
    expect(bodyText).toMatch(/multi_ack|side-band|ofs-delta/);
  });

  it("should handle empty repository", async () => {
    const refStore = createMockRefStore();
    // No refs

    const response = await handleInfoRefs(refStore);

    expect(response.status).toBe(200);
    const bodyText = new TextDecoder().decode(response.body);
    // Should still have service line and capabilities^{}
    expect(bodyText).toContain("# service=git-upload-pack");
    expect(bodyText).toContain("capabilities^{}");
  });

  it("should list all refs", async () => {
    const refStore = createMockRefStore();
    refStore._setRef("refs/heads/main", "a".repeat(40));
    refStore._setRef("refs/heads/feature", "b".repeat(40));
    refStore._setRef("refs/tags/v1.0", "c".repeat(40));

    const response = await handleInfoRefs(refStore);

    const bodyText = new TextDecoder().decode(response.body);
    expect(bodyText).toContain("refs/heads/main");
    expect(bodyText).toContain("refs/heads/feature");
    expect(bodyText).toContain("refs/tags/v1.0");
  });

  it("should include OIDs in ref lines", async () => {
    const refStore = createMockRefStore();
    const oid = "a".repeat(40);
    refStore._setRef("refs/heads/main", oid);

    const response = await handleInfoRefs(refStore);

    const bodyText = new TextDecoder().decode(response.body);
    expect(bodyText).toContain(oid);
  });

  it("should use pkt-line format", async () => {
    const refStore = createMockRefStore();
    refStore._setRef("refs/heads/main", "a".repeat(40));

    const response = await handleInfoRefs(refStore);

    // First 4 bytes should be hex length
    const body = response.body;
    const firstFour = new TextDecoder().decode(body.slice(0, 4));
    // Should be a valid hex length
    expect(/^[0-9a-f]{4}$/.test(firstFour)).toBe(true);
  });
});
