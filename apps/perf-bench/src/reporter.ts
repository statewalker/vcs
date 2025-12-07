import type { BenchmarkResult, OutputFormat } from "./types.js";
import { formatMs, formatPercent, formatSize, pad, separator } from "./utils/format.js";

/**
 * Format benchmark results according to the specified output format
 */
export function formatResults(results: BenchmarkResult[], format: OutputFormat): string {
  switch (format) {
    case "json":
      return formatAsJson(results);
    case "csv":
      return formatAsCsv(results);
    case "markdown":
      return formatAsMarkdown(results);
    default:
      return formatAsTable(results);
  }
}

function formatAsJson(results: BenchmarkResult[]): string {
  return JSON.stringify(results, null, 2);
}

function formatAsCsv(results: BenchmarkResult[]): string {
  const lines: string[] = [];

  for (const result of results) {
    if (result.results.length === 0) continue;

    // Get all metric keys from first result
    const metricKeys = Object.keys(result.results[0].metrics);
    const header = ["benchmark", "testCase", "size", "mutation", "durationMs", ...metricKeys];
    lines.push(header.join(","));

    for (const metric of result.results) {
      const values = [
        result.name,
        metric.testCase,
        metric.size.toString(),
        metric.mutation.toString(),
        metric.durationMs.toFixed(3),
        ...metricKeys.map((k) => String(metric.metrics[k] ?? "")),
      ];
      lines.push(values.join(","));
    }
    lines.push("");
  }

  return lines.join("\n");
}

function formatAsMarkdown(results: BenchmarkResult[]): string {
  const lines: string[] = [];

  for (const result of results) {
    lines.push(`# ${result.name}`);
    lines.push("");
    lines.push(`**${result.description}**`);
    lines.push("");
    lines.push(`- Timestamp: ${result.timestamp.toISOString()}`);
    lines.push(`- Node: ${result.environment.node}`);
    lines.push(`- Platform: ${result.environment.platform} (${result.environment.arch})`);
    lines.push(`- CPU: ${result.environment.cpuModel} (${result.environment.cpuCores} cores)`);
    lines.push("");

    if (result.results.length === 0) {
      lines.push("*No results*");
      continue;
    }

    // Get all metric keys
    const metricKeys = Object.keys(result.results[0].metrics);
    const header = ["Test Case", "Size", "Mutation", "Duration", ...metricKeys];
    lines.push(`| ${header.join(" | ")} |`);
    lines.push(`| ${header.map(() => "---").join(" | ")} |`);

    for (const metric of result.results) {
      const values = [
        metric.testCase,
        formatSize(metric.size),
        formatPercent(metric.mutation),
        formatMs(metric.durationMs),
        ...metricKeys.map((k) => formatMetricValue(k, metric.metrics[k])),
      ];
      lines.push(`| ${values.join(" | ")} |`);
    }

    lines.push("");
    lines.push(`## Summary`);
    lines.push("");
    lines.push(`- Total runs: ${result.summary.totalRuns}`);
    lines.push(`- Successful: ${result.summary.successCount}`);
    lines.push(`- Errors: ${result.summary.errorCount}`);
    lines.push(`- Total duration: ${formatMs(result.summary.totalDurationMs)}`);
    lines.push("");
  }

  return lines.join("\n");
}

function formatAsTable(results: BenchmarkResult[]): string {
  const lines: string[] = [];

  for (const result of results) {
    lines.push("");
    lines.push(`=== ${result.name} ===`);
    lines.push(result.description);
    lines.push(separator(70));

    if (result.results.length === 0) {
      lines.push("No results");
      continue;
    }

    // Get all metric keys
    const metricKeys = Object.keys(result.results[0].metrics);

    // Print header
    const header = [
      pad("Size", 10),
      pad("Mutation", 8),
      pad("Duration", 12),
      ...metricKeys.map((k) => pad(k, 12)),
    ];
    lines.push(header.join(" | "));
    lines.push(separator(70));

    // Print results
    for (const metric of result.results) {
      const values = [
        pad(formatSize(metric.size), 10),
        pad(formatPercent(metric.mutation), 8),
        pad(formatMs(metric.durationMs), 12),
        ...metricKeys.map((k) => pad(formatMetricValue(k, metric.metrics[k]), 12)),
      ];
      lines.push(values.join(" | "));
    }

    lines.push(separator(70));
    lines.push(
      `Summary: ${result.summary.successCount}/${result.summary.totalRuns} passed, ` +
        `${formatMs(result.summary.totalDurationMs)} total`,
    );
  }

  return lines.join("\n");
}

function formatMetricValue(key: string, value: number | string | undefined): string {
  if (value === undefined) return "-";
  if (typeof value === "string") return value;

  // Format based on key name hints
  if (key.toLowerCase().includes("time") || key.toLowerCase().includes("ms")) {
    return formatMs(value);
  }
  if (key.toLowerCase().includes("size") || key.toLowerCase().includes("bytes")) {
    return formatSize(value);
  }
  if (key.toLowerCase().includes("ratio") || key.toLowerCase().includes("percent")) {
    return formatPercent(value);
  }
  if (Number.isInteger(value)) {
    return value.toString();
  }
  return value.toFixed(3);
}
