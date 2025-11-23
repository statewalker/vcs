/**
 * Example demonstrating test logger usage
 *
 * Run without logging:
 *   pnpm test test-logger.example
 *
 * Run with logging enabled:
 *   DEBUG_TESTS=1 pnpm test test-logger.example
 */

import { describe, expect, it } from "vitest";
import { isTestLogEnabled, testLog } from "./test-logger.js";

describe("Test Logger Example", () => {
  it("should demonstrate basic logging", () => {
    testLog("This message only appears when DEBUG_TESTS=1");
    testLog("You can log multiple arguments:", { foo: "bar" }, [1, 2, 3]);

    const result = 2 + 2;
    testLog(`Calculated result: ${result}`);

    expect(result).toBe(4);
  });

  it("should check if logging is enabled", () => {
    if (isTestLogEnabled()) {
      testLog("Logging is enabled!");
      testLog("Current environment:", {
        DEBUG_TESTS: process.env.DEBUG_TESTS,
        VERBOSE_TESTS: process.env.VERBOSE_TESTS,
      });
    } else {
      // This block runs during normal test execution
      // No logs are printed unless DEBUG_TESTS=1
    }

    expect(true).toBe(true);
  });

  it("should avoid expensive operations when logging is disabled", () => {
    // Only perform expensive logging operations if needed
    if (isTestLogEnabled()) {
      const expensiveReport = generateExpensiveReport();
      testLog("Detailed report:", expensiveReport);
    }

    expect(true).toBe(true);
  });
});

function generateExpensiveReport() {
  // Simulate expensive operation
  return {
    timestamp: new Date().toISOString(),
    details: "Some expensive calculation result",
  };
}
