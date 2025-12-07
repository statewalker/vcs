import fs from "node:fs";
import { parseArgs, showHelp, validateOptions } from "./cli.js";
import { formatResults } from "./reporter.js";
import { benchmarks, getBenchmark, getBenchmarkNames, listBenchmarks } from "./benchmarks/index.js";
import type { BenchmarkConfig, BenchmarkResult } from "./types.js";

async function main(): Promise<void> {
  const args = process.argv.slice(2);
  const options = parseArgs(args);

  // Handle help
  if (options.help) {
    showHelp();
    process.exit(0);
  }

  // Handle list
  if (options.list) {
    listBenchmarks();
    process.exit(0);
  }

  // Validate options
  const validationError = validateOptions(options);
  if (validationError) {
    console.error(`Error: ${validationError}`);
    showHelp();
    process.exit(1);
  }

  // Determine which benchmarks to run
  const benchmarkNames = options.all ? getBenchmarkNames() : options.benchmarks;

  // Validate benchmark names
  for (const name of benchmarkNames) {
    if (!getBenchmark(name)) {
      console.error(`Error: Unknown benchmark '${name}'`);
      console.error(`Available benchmarks: ${getBenchmarkNames().join(", ")}`);
      process.exit(1);
    }
  }

  // Build config
  const config: BenchmarkConfig = {
    warmup: options.warmup,
    iterations: options.iterations,
    sizes: options.sizes ?? [],
    mutations: options.mutations ?? [],
    outputFormat: options.output,
    outputFile: options.file,
    verbose: options.verbose,
  };

  console.log(`\nRunning benchmarks: ${benchmarkNames.join(", ")}`);
  console.log(`Warmup: ${config.warmup}, Iterations: ${config.iterations}`);
  if (config.sizes.length > 0) {
    console.log(`Sizes: ${config.sizes.join(", ")}`);
  }
  if (config.mutations.length > 0) {
    console.log(`Mutations: ${config.mutations.join(", ")}`);
  }
  console.log("");

  // Run benchmarks
  const results: BenchmarkResult[] = [];

  for (const name of benchmarkNames) {
    const benchmark = benchmarks.get(name);
    if (!benchmark) continue;

    console.log(`Running ${benchmark.name}...`);
    try {
      const result = await benchmark.run(config);
      results.push(result);
      console.log(
        `  Completed: ${result.summary.successCount}/${result.summary.totalRuns} passed ` +
          `(${result.summary.totalDurationMs.toFixed(0)}ms)`
      );
    } catch (error) {
      console.error(
        `  Failed: ${error instanceof Error ? error.message : String(error)}`
      );
    }
  }

  // Format and output results
  const output = formatResults(results, config.outputFormat);
  console.log(output);

  // Save to file if specified
  if (config.outputFile) {
    const dir = config.outputFile.substring(0, config.outputFile.lastIndexOf("/"));
    if (dir) {
      fs.mkdirSync(dir, { recursive: true });
    }
    fs.writeFileSync(config.outputFile, output, "utf-8");
    console.log(`\nResults saved to: ${config.outputFile}`);
  }
}

main().catch((error) => {
  console.error("Fatal error:", error);
  process.exit(1);
});
