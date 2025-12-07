/**
 * Run all Git pack file examples
 *
 * Usage: tsx src/run-all.ts <pack-file>
 */

import { spawn } from "node:child_process";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));

interface Example {
  name: string;
  script: string;
  description: string;
  inputType: "pack" | "idx";
}

const EXAMPLES: Example[] = [
  {
    name: "01-simple-roundtrip",
    script: "01-simple-roundtrip/01-simple-roundtrip.ts",
    description: "Basic read-and-write workflow",
    inputType: "pack",
  },
  {
    name: "02-delta-preservation",
    script: "02-delta-preservation/02-delta-preservation.ts",
    description: "Analyze delta relationships",
    inputType: "pack",
  },
  {
    name: "03-streaming-ofs-delta",
    script: "03-streaming-ofs-delta/03-streaming-ofs-delta.ts",
    description: "Streaming writer with deltas",
    inputType: "pack",
  },
  {
    name: "04-full-verification",
    script: "04-full-verification/04-full-verification.ts",
    description: "Detailed verification",
    inputType: "pack",
  },
  {
    name: "05-index-format-comparison",
    script: "05-index-format-comparison/05-index-format-comparison.ts",
    description: "Compare index V1 vs V2",
    inputType: "idx",
  },
];

/**
 * Run a single example
 */
function runExample(example: Example, inputFile: string): Promise<boolean> {
  return new Promise((resolvePromise) => {
    const scriptPath = resolve(__dirname, example.script);

    // Adjust input file based on expected type
    let actualInput = inputFile;
    if (example.inputType === "idx" && inputFile.endsWith(".pack")) {
      actualInput = inputFile.slice(0, -5) + ".idx";
    } else if (example.inputType === "pack" && inputFile.endsWith(".idx")) {
      actualInput = inputFile.slice(0, -4) + ".pack";
    }

    console.log(`\n${"=".repeat(60)}`);
    console.log(`Running: ${example.name}`);
    console.log(`Description: ${example.description}`);
    console.log(`Input: ${actualInput}`);
    console.log(`${"=".repeat(60)}\n`);

    const child = spawn("tsx", [scriptPath, actualInput], {
      stdio: "inherit",
      cwd: process.cwd(),
    });

    child.on("close", (code) => {
      if (code === 0) {
        console.log(`\n✓ ${example.name} completed successfully\n`);
        resolvePromise(true);
      } else {
        console.error(`\n✗ ${example.name} failed with code ${code}\n`);
        resolvePromise(false);
      }
    });

    child.on("error", (err) => {
      console.error(`\n✗ ${example.name} error: ${err.message}\n`);
      resolvePromise(false);
    });
  });
}

/**
 * Print usage information
 */
function printUsage() {
  console.log(`
Git Pack File Examples Runner

Usage:
  tsx src/run-all.ts <pack-or-idx-file> [example-number]

Arguments:
  pack-or-idx-file   Path to a .pack or .idx file
  example-number     Optional: run only this example (1-5)

Examples:
  # Run all examples
  tsx src/run-all.ts ./test-data/git-repo/test.pack

  # Run only example 1
  tsx src/run-all.ts ./test-data/git-repo/test.pack 1

  # Run only example 5 (index comparison)
  tsx src/run-all.ts ./test-data/git-repo/test.idx 5

Available Examples:
${EXAMPLES.map((e, i) => `  ${i + 1}. ${e.name.padEnd(25)} - ${e.description}`).join("\n")}
`);
}

async function main() {
  const args = process.argv.slice(2);

  if (args.length === 0 || args.includes("--help") || args.includes("-h")) {
    printUsage();
    process.exit(args.length === 0 ? 1 : 0);
  }

  const inputFile = resolve(process.cwd(), args[0]);
  const exampleNum = args[1] ? parseInt(args[1], 10) : null;

  console.log("Git Pack File Examples");
  console.log("======================");
  console.log(`Input file: ${inputFile}`);

  // Determine which examples to run
  let examplesToRun: Example[];
  if (exampleNum !== null) {
    if (exampleNum < 1 || exampleNum > EXAMPLES.length) {
      console.error(`Error: Example number must be between 1 and ${EXAMPLES.length}`);
      process.exit(1);
    }
    examplesToRun = [EXAMPLES[exampleNum - 1]];
  } else {
    examplesToRun = EXAMPLES;
  }

  console.log(`Running ${examplesToRun.length} example(s)...`);

  // Run examples sequentially
  const results: { name: string; success: boolean }[] = [];

  for (const example of examplesToRun) {
    const success = await runExample(example, inputFile);
    results.push({ name: example.name, success });
  }

  // Print summary
  console.log("\n" + "=".repeat(60));
  console.log("Summary");
  console.log("=".repeat(60));

  const passed = results.filter((r) => r.success).length;
  const failed = results.filter((r) => !r.success).length;

  for (const result of results) {
    console.log(`  ${result.success ? "✓" : "✗"} ${result.name}`);
  }

  console.log(`\nTotal: ${passed} passed, ${failed} failed`);

  process.exit(failed > 0 ? 1 : 0);
}

main().catch((err) => {
  console.error("Error:", err.message);
  process.exit(1);
});
