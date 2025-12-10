/**
 * Type definitions for the git performance benchmark
 */

export interface PerformanceMetric {
  name: string;
  duration: number;
  unit: string;
  details?: Record<string, unknown>;
}

export interface CommitInfo {
  id: string;
  shortId: string;
  message: string;
  author: string;
  timestamp: number;
  parentCount: number;
}

export interface PerformanceResults {
  timestamp: string;
  repository: string;
  commitCount: number;
  metrics: PerformanceMetric[];
  commits: CommitInfo[];
  summary: {
    totalDuration: number;
    packFilesCount: number;
    packFilesTotalSize: number;
    objectCount: number;
  };
}

export interface StepResult<T = unknown> {
  success: boolean;
  data?: T;
  error?: string;
  metrics: PerformanceMetric[];
}
