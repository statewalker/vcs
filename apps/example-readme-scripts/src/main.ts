/**
 * Runs all README example scripts in sequence.
 * Each script demonstrates a different aspect of the StateWalker VCS library.
 */

console.log("=".repeat(60));
console.log("StateWalker VCS - README Examples");
console.log("=".repeat(60));

console.log("\n[1/3] Basic Repository Operations\n");
await import("./basic-repository-operations.js");

console.log(`\n${"-".repeat(60)}`);
console.log("\n[2/3] Commands API\n");
await import("./commands-api.js");

console.log(`\n${"-".repeat(60)}`);
console.log("\n[3/3] Delta Compression\n");
await import("./delta-compression.js");

console.log(`\n${"=".repeat(60)}`);
console.log("All examples completed successfully!");
console.log("=".repeat(60));
