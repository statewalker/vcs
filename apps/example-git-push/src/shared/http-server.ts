/**
 * Simple HTTP server that wraps git http-backend CGI.
 *
 * This allows serving a git repository over HTTP for clone/push operations.
 */

import { spawn } from "node:child_process";
import * as http from "node:http";
import * as path from "node:path";

export interface GitHttpServerOptions {
  /** Port to listen on */
  port: number;
  /** Base directory containing git repositories */
  baseDir: string;
}

/**
 * A simple HTTP server that handles git smart HTTP protocol.
 */
export class GitHttpServer {
  private server: http.Server | null = null;
  private port: number;
  private baseDir: string;

  constructor(options: GitHttpServerOptions) {
    this.port = options.port;
    this.baseDir = options.baseDir;
  }

  /**
   * Start the HTTP server.
   */
  async start(): Promise<void> {
    return new Promise((resolve, reject) => {
      this.server = http.createServer((req, res) => {
        this.handleRequest(req, res).catch((error) => {
          console.error("Request error:", error);
          if (!res.headersSent) {
            res.writeHead(500);
            res.end("Internal Server Error");
          }
        });
      });

      this.server.on("error", reject);

      this.server.listen(this.port, () => {
        resolve();
      });
    });
  }

  /**
   * Stop the HTTP server.
   */
  async stop(): Promise<void> {
    return new Promise((resolve) => {
      if (this.server) {
        this.server.close(() => {
          this.server = null;
          resolve();
        });
      } else {
        resolve();
      }
    });
  }

  /**
   * Handle an incoming HTTP request.
   */
  private async handleRequest(req: http.IncomingMessage, res: http.ServerResponse): Promise<void> {
    const url = new URL(req.url || "/", `http://localhost:${this.port}`);
    const pathname = url.pathname;

    // Parse the repository path from URL
    // URL format: /repo.git/info/refs or /repo.git/git-upload-pack
    const match = pathname.match(/^\/([^/]+\.git)(\/.*)?$/);
    if (!match) {
      res.writeHead(404);
      res.end("Not Found");
      return;
    }

    const repoName = match[1];
    const repoPath = path.join(this.baseDir, repoName);
    const gitPath = match[2] || "/";

    // Handle different git HTTP endpoints
    if (gitPath === "/info/refs") {
      await this.handleInfoRefs(req, res, repoPath, url);
    } else if (gitPath === "/git-upload-pack") {
      await this.handleService(req, res, repoPath, "git-upload-pack");
    } else if (gitPath === "/git-receive-pack") {
      await this.handleService(req, res, repoPath, "git-receive-pack");
    } else {
      res.writeHead(404);
      res.end("Not Found");
    }
  }

  /**
   * Handle /info/refs endpoint (ref discovery).
   */
  private async handleInfoRefs(
    _req: http.IncomingMessage,
    res: http.ServerResponse,
    repoPath: string,
    url: URL,
  ): Promise<void> {
    const service = url.searchParams.get("service");

    if (!service || !["git-upload-pack", "git-receive-pack"].includes(service)) {
      res.writeHead(403);
      res.end("Forbidden");
      return;
    }

    // Set headers for smart HTTP
    res.setHeader("Content-Type", `application/x-${service}-advertisement`);
    res.setHeader("Cache-Control", "no-cache");

    // Write service announcement
    const serviceAnnouncement = `# service=${service}\n`;
    const announcementPkt = this.pktLine(serviceAnnouncement);
    res.write(announcementPkt);
    res.write("0000"); // Flush packet

    // Run git service with --advertise-refs
    // Use "git upload-pack" instead of "git-upload-pack" for compatibility
    const gitCommand = service === "git-upload-pack" ? "upload-pack" : "receive-pack";
    const git = spawn("git", [gitCommand, "--stateless-rpc", "--advertise-refs", repoPath], {
      stdio: ["pipe", "pipe", "pipe"],
    });

    // Pipe git stdout to response
    git.stdout.on("data", (chunk) => {
      res.write(chunk);
    });

    git.stderr.on("data", (data) => {
      console.error(`git ${gitCommand} stderr: ${data}`);
    });

    await new Promise<void>((resolve, reject) => {
      git.on("close", (code) => {
        if (code !== 0) {
          console.error(`git ${gitCommand} --advertise-refs exited with code ${code}`);
        }
        res.end();
        resolve();
      });
      git.on("error", (err) => {
        console.error(`git ${gitCommand} error: ${err}`);
        res.end();
        reject(err);
      });
    });
  }

  /**
   * Handle service endpoint (git-upload-pack or git-receive-pack).
   */
  private async handleService(
    req: http.IncomingMessage,
    res: http.ServerResponse,
    repoPath: string,
    service: string,
  ): Promise<void> {
    // Collect request body
    const chunks: Buffer[] = [];
    req.on("data", (chunk: Buffer) => {
      chunks.push(chunk);
    });

    await new Promise<void>((resolve) => req.on("end", resolve));

    const requestBody = Buffer.concat(chunks);

    // Set headers
    res.setHeader("Content-Type", `application/x-${service}-result`);
    res.setHeader("Cache-Control", "no-cache");

    // Run git service
    // Use "git upload-pack" instead of "git-upload-pack" for compatibility
    const gitCommand = service === "git-upload-pack" ? "upload-pack" : "receive-pack";
    const git = spawn("git", [gitCommand, "--stateless-rpc", repoPath], {
      stdio: ["pipe", "pipe", "pipe"],
    });

    // Write collected body to git stdin
    git.stdin.write(requestBody);
    git.stdin.end();

    // Pipe stdout to response
    git.stdout.on("data", (chunk) => {
      res.write(chunk);
    });

    git.stderr.on("data", (data) => {
      console.error(`git ${gitCommand} stderr: ${data}`);
    });

    await new Promise<void>((resolve, reject) => {
      git.on("close", (code) => {
        if (code !== 0) {
          console.error(`git ${gitCommand} exited with code ${code}`);
        }
        res.end();
        resolve();
      });
      git.on("error", (err) => {
        console.error(`git ${gitCommand} error: ${err}`);
        res.end();
        reject(err);
      });
    });
  }

  /**
   * Create a pkt-line formatted string.
   */
  private pktLine(data: string): string {
    const length = data.length + 4;
    return length.toString(16).padStart(4, "0") + data;
  }
}

/**
 * Create and start a git HTTP server.
 */
export async function createGitHttpServer(options: GitHttpServerOptions): Promise<GitHttpServer> {
  const server = new GitHttpServer(options);
  await server.start();
  return server;
}
