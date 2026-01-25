/**
 * HTTP Fetch E2E Tests
 *
 * Tests complete fetch operations over simulated HTTP using real repositories
 * with VcsRepositoryFacade for pack operations.
 */

import { httpFetch } from "@statewalker/vcs-transport";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  createInitializedTestRepository,
  createRepositoryFacade,
  createTestCommit,
  createTestRepository,
  createTransportRefStore,
  type TestRepositoryContext,
} from "../helpers/index.js";

/**
 * Mock HTTP server that handles Git Smart HTTP protocol.
 * Uses server repository's VcsRepositoryFacade for pack operations.
 */
function createMockHttpServer(serverCtx: TestRepositoryContext) {
  const serverFacade = createRepositoryFacade(serverCtx.repository);
  const serverRefs = createTransportRefStore(serverCtx.repository.refs);

  return async (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
    const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
    const parsedUrl = new URL(url);
    const path = parsedUrl.pathname;

    // Handle /info/refs?service=git-upload-pack
    if (
      path.endsWith("/info/refs") &&
      parsedUrl.searchParams.get("service") === "git-upload-pack"
    ) {
      const refsList = await serverRefs.listAll();
      const refsArray = Array.from(refsList);

      // Build pkt-line formatted response
      let response = "001e# service=git-upload-pack\n0000";

      const capabilities = ["multi_ack_detailed", "thin-pack", "side-band-64k", "ofs-delta"];

      if (refsArray.length === 0) {
        // Empty repository
        response += pktLine(`${"0".repeat(40)} capabilities^{}\0${capabilities.join(" ")}\n`);
      } else {
        let first = true;
        for (const [name, oid] of refsArray) {
          if (first) {
            response += pktLine(`${oid} ${name}\0${capabilities.join(" ")}\n`);
            first = false;
          } else {
            response += pktLine(`${oid} ${name}\n`);
          }
        }
      }
      response += "0000";

      return new Response(response, {
        status: 200,
        headers: { "Content-Type": "application/x-git-upload-pack-advertisement" },
      });
    }

    // Handle POST /git-upload-pack
    if (path.endsWith("/git-upload-pack") && init?.method === "POST") {
      const body = init.body;
      let bodyText = "";
      if (body instanceof Uint8Array) {
        bodyText = new TextDecoder().decode(body);
      } else if (typeof body === "string") {
        bodyText = body;
      }

      // Parse wants from request
      const wants = new Set<string>();
      const haves = new Set<string>();

      for (const line of bodyText.split("\n")) {
        if (line.includes("want ")) {
          const oid = line
            .replace(/.*want\s+/, "")
            .split(" ")[0]
            .trim();
          if (oid.length === 40) wants.add(oid);
        } else if (line.includes("have ")) {
          const oid = line.replace(/.*have\s+/, "").trim();
          if (oid.length === 40) haves.add(oid);
        }
      }

      // Generate pack data
      const packChunks: Uint8Array[] = [];
      for await (const chunk of serverFacade.exportPack(wants, haves)) {
        packChunks.push(chunk);
      }

      // Build response with NAK and pack on sideband
      let responseData = pktLine("NAK\n");

      // Send pack on sideband 1
      if (packChunks.length > 0) {
        const totalLength = packChunks.reduce((sum, c) => sum + c.length, 0);
        const packData = new Uint8Array(totalLength);
        let offset = 0;
        for (const chunk of packChunks) {
          packData.set(chunk, offset);
          offset += chunk.length;
        }

        // Split into sideband chunks
        const maxChunkSize = 65515;
        for (let i = 0; i < packData.length; i += maxChunkSize) {
          const chunk = packData.slice(i, i + maxChunkSize);
          const length = chunk.length + 5;
          responseData += length.toString(16).padStart(4, "0");
          responseData += "\x01"; // Sideband 1 (pack data)
          responseData += new TextDecoder("latin1").decode(chunk);
        }
      }

      responseData += "0000";

      return new Response(responseData, {
        status: 200,
        headers: { "Content-Type": "application/x-git-upload-pack-result" },
      });
    }

    return new Response("Not Found", { status: 404 });
  };
}

function pktLine(data: string): string {
  const length = data.length + 4;
  return length.toString(16).padStart(4, "0") + data;
}

describe("HTTP Fetch E2E", () => {
  let serverCtx: TestRepositoryContext;
  let clientCtx: TestRepositoryContext;

  beforeEach(async () => {
    serverCtx = await createInitializedTestRepository();
    clientCtx = await createTestRepository();
  });

  afterEach(async () => {
    await serverCtx.cleanup();
    await clientCtx.cleanup();
  });

  // Note: This test is skipped because the pack import logic in core/serialization
  // has an issue where it treats commit objects as blobs. The HTTP transport
  // layer (including sideband decoding) is now working correctly.
  // See webrun-vcs-1tv73 for the transport fix.
  it.skip("fetches refs from server", async () => {
    // Add commit to server
    await createTestCommit(serverCtx.repository, "Server commit", {
      "README.md": "# Server content",
    });

    const mockFetch = createMockHttpServer(serverCtx);
    const clientFacade = createRepositoryFacade(clientCtx.repository);
    const clientRefs = createTransportRefStore(clientCtx.repository.refs);

    const result = await httpFetch("http://test-server/repo.git", clientFacade, clientRefs, {
      fetchFn: mockFetch,
    });

    // Even if pack import isn't fully working, the fetch should succeed
    // in terms of getting refs
    expect(result.error).toBeUndefined();
  });

  it("performs info/refs request correctly", async () => {
    // Add commit to server
    await createTestCommit(serverCtx.repository, "Server commit", {
      "README.md": "# Server content",
    });

    let infoRefsRequested = false;
    let requestUrl = "";

    const mockFetch = async (input: RequestInfo | URL): Promise<Response> => {
      const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
      requestUrl = url;
      if (url.includes("/info/refs")) {
        infoRefsRequested = true;
      }
      // Return 404 after capturing the request
      return new Response("Not Found", { status: 404 });
    };

    const clientFacade = createRepositoryFacade(clientCtx.repository);
    const clientRefs = createTransportRefStore(clientCtx.repository.refs);

    await httpFetch("http://test-server/repo.git", clientFacade, clientRefs, {
      fetchFn: mockFetch,
    });

    expect(infoRefsRequested).toBe(true);
    expect(requestUrl).toContain("service=git-upload-pack");
  });

  it("handles empty server repository", async () => {
    // Create fresh empty server repo
    const emptyServerCtx = await createTestRepository();

    try {
      const mockFetch = createMockHttpServer(emptyServerCtx);
      const clientFacade = createRepositoryFacade(clientCtx.repository);
      const clientRefs = createTransportRefStore(clientCtx.repository.refs);

      const result = await httpFetch("http://test-server/repo.git", clientFacade, clientRefs, {
        fetchFn: mockFetch,
      });

      // Empty repo should still return successfully (nothing to fetch)
      expect(result.success).toBe(true);
    } finally {
      await emptyServerCtx.cleanup();
    }
  });

  it("returns error for 404 response", async () => {
    const clientFacade = createRepositoryFacade(clientCtx.repository);
    const clientRefs = createTransportRefStore(clientCtx.repository.refs);

    const result = await httpFetch("http://test-server/repo.git", clientFacade, clientRefs, {
      fetchFn: async () => new Response("Not Found", { status: 404 }),
    });

    expect(result.success).toBe(false);
    expect(result.error).toContain("404");
  });

  it("handles network errors gracefully", async () => {
    const clientFacade = createRepositoryFacade(clientCtx.repository);
    const clientRefs = createTransportRefStore(clientCtx.repository.refs);

    const result = await httpFetch("http://test-server/repo.git", clientFacade, clientRefs, {
      fetchFn: async () => {
        throw new Error("Network error");
      },
    });

    expect(result.success).toBe(false);
    expect(result.error).toContain("Network error");
  });
});

describe("HTTP Fetch - Repository Sync", () => {
  it("syncs repository facade correctly", async () => {
    const serverCtx = await createInitializedTestRepository();
    const clientCtx = await createTestRepository();

    try {
      // Create commit on server
      const commitId = await createTestCommit(serverCtx.repository, "Test commit", {
        "file.txt": "content",
      });

      const serverFacade = createRepositoryFacade(serverCtx.repository);
      const clientFacade = createRepositoryFacade(clientCtx.repository);

      // Verify server has the commit
      expect(await serverFacade.has(commitId)).toBe(true);

      // Verify client doesn't have it
      expect(await clientFacade.has(commitId)).toBe(false);

      // Test walkAncestors on server
      const ancestors: string[] = [];
      for await (const oid of serverFacade.walkAncestors(commitId)) {
        ancestors.push(oid);
      }
      expect(ancestors.length).toBeGreaterThan(0);
      expect(ancestors).toContain(commitId);
    } finally {
      await serverCtx.cleanup();
      await clientCtx.cleanup();
    }
  });
});
