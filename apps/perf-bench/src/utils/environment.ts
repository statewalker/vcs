import os from "node:os";
import type { EnvironmentInfo } from "../types.js";

/**
 * Collect environment information for benchmark reproducibility
 */
export function getEnvironmentInfo(): EnvironmentInfo {
  const cpus = os.cpus();
  return {
    node: process.version,
    platform: os.platform(),
    arch: os.arch(),
    cpuModel: cpus[0]?.model ?? "unknown",
    cpuCores: cpus.length,
    totalMemory: os.totalmem(),
    timestamp: new Date().toISOString(),
  };
}
