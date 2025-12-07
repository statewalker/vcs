import type { CLIOptions, OutputFormat } from "./types.js";

const HELP_TEXT = `
perf-bench - Performance benchmarking tool for webrun-vcs

Usage: perf-bench [options] [benchmarks...]

Options:
  -a, --all              Run all benchmarks
  -o, --output <format>  Output format: table, json, csv, markdown (default: table)
  -f, --file <path>      Save results to file
  -w, --warmup <n>       Warmup iterations (default: 1)
  -i, --iterations <n>   Test iterations (default: 1)
  -s, --sizes <sizes>    Comma-separated file sizes to test
  -m, --mutations <m>    Comma-separated mutation degrees (0-1)
  -v, --verbose          Verbose output
  -l, --list             List available benchmarks
  -h, --help             Show this help message

Available benchmarks:
  binary-delta     Binary delta encoding/decoding performance
  delta-ranges     Delta range generation and application

Examples:
  perf-bench --all
  perf-bench binary-delta delta-ranges
  perf-bench --all --output json -f results/latest.json
  perf-bench binary-delta --sizes 1024,10240,102400
  perf-bench delta-ranges --mutations 0,0.25,0.5,1.0
`;

/**
 * Parse command line arguments
 */
export function parseArgs(args: string[]): CLIOptions {
  const options: CLIOptions = {
    benchmarks: [],
    all: false,
    output: "table",
    warmup: 1,
    iterations: 1,
    verbose: false,
    list: false,
    help: false,
  };

  let i = 0;
  while (i < args.length) {
    const arg = args[i];

    switch (arg) {
      case "-a":
      case "--all":
        options.all = true;
        break;

      case "-o":
      case "--output":
        options.output = (args[++i] as OutputFormat) ?? "table";
        break;

      case "-f":
      case "--file":
        options.file = args[++i];
        break;

      case "-w":
      case "--warmup":
        options.warmup = parseInt(args[++i] ?? "1", 10);
        break;

      case "-i":
      case "--iterations":
        options.iterations = parseInt(args[++i] ?? "1", 10);
        break;

      case "-s":
      case "--sizes":
        options.sizes = (args[++i] ?? "")
          .split(",")
          .map((s) => parseInt(s.trim(), 10))
          .filter((n) => !isNaN(n));
        break;

      case "-m":
      case "--mutations":
        options.mutations = (args[++i] ?? "")
          .split(",")
          .map((s) => parseFloat(s.trim()))
          .filter((n) => !isNaN(n));
        break;

      case "-v":
      case "--verbose":
        options.verbose = true;
        break;

      case "-l":
      case "--list":
        options.list = true;
        break;

      case "-h":
      case "--help":
        options.help = true;
        break;

      default:
        if (!arg.startsWith("-")) {
          options.benchmarks.push(arg);
        }
        break;
    }

    i++;
  }

  return options;
}

/**
 * Show help message
 */
export function showHelp(): void {
  console.log(HELP_TEXT);
}

/**
 * Validate CLI options
 */
export function validateOptions(options: CLIOptions): string | null {
  if (!options.all && options.benchmarks.length === 0 && !options.list && !options.help) {
    return "No benchmarks specified. Use --all or specify benchmark names.";
  }

  if (options.warmup < 0) {
    return "Warmup must be non-negative";
  }

  if (options.iterations < 1) {
    return "Iterations must be at least 1";
  }

  const validFormats = ["table", "json", "csv", "markdown"];
  if (!validFormats.includes(options.output)) {
    return `Invalid output format. Must be one of: ${validFormats.join(", ")}`;
  }

  return null;
}
