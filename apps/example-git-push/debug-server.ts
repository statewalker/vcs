/**
 * Debug script to test the HTTP server
 */

import { execFileSync } from "node:child_process";
import * as fs from "node:fs/promises";
import * as http from "node:http";
import * as path from "node:path";

const BASE_DIR = "./test-repos-debug";
const REMOTE_REPO_DIR = path.join(BASE_DIR, "remote.git");
const PORT = 8766;

function httpGet(url: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const req = http.get(url, (res) => {
      let data = "";
      res.on("data", (chunk) => {
        data += chunk;
      });
      res.on("end", () => resolve(data));
    });
    req.on("error", reject);
    req.setTimeout(5000, () => {
      req.destroy();
      reject(new Error("Timeout"));
    });
  });
}

async function main() {
  // Cleanup and create bare repo
  await fs.rm(BASE_DIR, { recursive: true, force: true });
  await fs.mkdir(REMOTE_REPO_DIR, { recursive: true });
  execFileSync("git", ["init", "--bare"], { cwd: REMOTE_REPO_DIR });

  console.log(`Starting simple HTTP server on port ${PORT}...`);
  const server = http.createServer((req, res) => {
    console.log(`[HTTP] Request: ${req.method} ${req.url}`);
    res.writeHead(200, { "Content-Type": "text/plain" });
    res.end("Hello World\n");
  });

  await new Promise<void>((resolve) => server.listen(PORT, () => resolve()));
  console.log("Server started!");

  // Test with http.get
  console.log("\nTesting with http.get...");
  try {
    const output = await httpGet(`http://localhost:${PORT}/test`);
    console.log(`Response: ${output}`);
  } catch (e) {
    console.error("HTTP get failed:", (e as Error).message);
  }

  server.close();
  await fs.rm(BASE_DIR, { recursive: true, force: true });
  console.log("\nDone");
}

main().catch(console.error);
