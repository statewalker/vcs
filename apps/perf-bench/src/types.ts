/**
 * Configuration for running benchmarks
 */
export interface BenchmarkConfig {
  /** Warmup iterations before measuring */
  warmup: number;
  /** Number of measurement iterations */
  iterations: number;
  /** File sizes to test */
  sizes: number[];
  /** Mutation degrees to test (0.0 to 1.0) */
  mutations: number[];
  /** Output format */
  outputFormat: OutputFormat;
  /** Optional output file path */
  outputFile?: string;
  /** Verbose output */
  verbose: boolean;
}

export type OutputFormat = "table" | "json" | "csv" | "markdown";

/**
 * Environment information for reproducibility
 */
export interface EnvironmentInfo {
  node: string;
  platform: string;
  arch: string;
  cpuModel: string;
  cpuCores: number;
  totalMemory: number;
  timestamp: string;
}

/**
 * Individual metric result from a benchmark run
 */
export interface MetricResult {
  /** Test case identifier */
  testCase: string;
  /** Size configuration */
  size: number;
  /** Mutation degree */
  mutation: number;
  /** Primary duration in milliseconds */
  durationMs: number;
  /** Custom metrics specific to the benchmark */
  metrics: Record<string, number | string>;
}

/**
 * Complete result from a benchmark
 */
export interface BenchmarkResult {
  /** Benchmark name */
  name: string;
  /** Benchmark description */
  description: string;
  /** When the benchmark was run */
  timestamp: Date;
  /** Environment info */
  environment: EnvironmentInfo;
  /** All metric results */
  results: MetricResult[];
  /** Summary statistics */
  summary: {
    totalRuns: number;
    successCount: number;
    errorCount: number;
    totalDurationMs: number;
  };
}

/**
 * Benchmark interface that all benchmarks must implement
 */
export interface Benchmark {
  /** Unique name for CLI */
  name: string;
  /** Description for help */
  description: string;
  /** Run the benchmark */
  run(config: BenchmarkConfig): Promise<BenchmarkResult>;
}

/**
 * CLI options from command line arguments
 */
export interface CLIOptions {
  benchmarks: string[];
  all: boolean;
  output: OutputFormat;
  file?: string;
  warmup: number;
  iterations: number;
  sizes?: number[];
  mutations?: number[];
  verbose: boolean;
  list: boolean;
  help: boolean;
}
