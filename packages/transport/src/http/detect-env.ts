export type BrowserType = "firefox" | "edge" | "chrome" | "safari" | "unknown";

export type RuntimeType = "node" | "deno" | "bun" | "worker" | BrowserType | "unknown";

export function detectRuntime(): RuntimeType {
  const glob = globalThis as Record<string, unknown>;

  // Deno
  if (
    typeof glob.Deno !== "undefined" &&
    typeof (glob.Deno as { version: unknown }).version !== "undefined"
  ) {
    return "deno";
  }

  // Bun
  if (typeof glob.Bun !== "undefined") {
    return "bun";
  }

  // Node.js
  if (typeof process !== "undefined" && process.versions?.node && !process.versions?.deno) {
    return "node";
  }

  // Browser (main thread)
  if (typeof window !== "undefined" && typeof document !== "undefined") {
    return detectBrowser();
  }

  // Web Worker / Service Worker
  if (typeof self === "object" && self.constructor?.name === "DedicatedWorkerGlobalScope") {
    return "worker";
  }

  return "unknown";
}

export function detectBrowser(): BrowserType {
  if (!globalThis.navigator) return "unknown";
  const ua = navigator.userAgent;
  if (/Firefox\/\d+/.test(ua)) return "firefox";
  if (/Edg\/\d+/.test(ua)) return "edge";
  if (/Chrome\/\d+/.test(ua)) return "chrome";
  if (/Safari\/\d+/.test(ua) && !/Chrome/.test(ua)) return "safari";
  return "unknown";
}
