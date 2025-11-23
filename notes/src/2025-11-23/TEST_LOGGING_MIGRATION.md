# Test Logging Migration Summary

## Overview

All `console.log()` calls in test files have been externalized to use a centralized logging utility that can be controlled via environment variables. This reduces noise during normal test runs while still allowing verbose output when needed for debugging.

## Changes Made

### New Files Created

1. **`tests/test-logger.ts`** - Core logging utility
   - Exports `testLog()` function for logging
   - Exports `isTestLogEnabled()` helper
   - Controlled by `DEBUG_TESTS` or `VERBOSE_TESTS` environment variables

2. **`tests/README.md`** - Documentation
   - Usage instructions
   - API reference
   - Migration guide

3. **`tests/test-logger.example.ts`** - Example usage
   - Demonstrates basic logging
   - Shows conditional logging
   - Includes performance optimization patterns

### Modified Test Files

1. **`tests/delta/fossil-like-ranges.test.ts`**
   - Added import: `import { testLog } from "../test-logger.js"`
   - Replaced 1 `console.log()` call with `testLog()`

2. **`tests/delta/create-delta-ranges-performance.test.ts`**
   - Added import: `import { testLog } from "../test-logger.js"`
   - Replaced 3 `console.log()` calls with `testLog()`

3. **`tests/delta/jgit-full-suite.test.ts`**
   - Added import: `import { testLog } from "../test-logger.js"`
   - Replaced 13 `console.log()` calls with `testLog()`

### Files NOT Modified

- **`tests/delta/create-delta-ranges.test.ts`** - No console.log calls (only string literals)
- **`tests/delta/create-fossil-like-ranges.test.ts`** - No console.log calls (only string literals)
- **`tests/[skipped]/*.test-skip.ts`** - Skipped test files left unchanged

## Usage

### Default Behavior (Silent)
```bash
pnpm test
# No console output from testLog() calls
```

### With Debug Logging
```bash
DEBUG_TESTS=1 pnpm test
# All testLog() calls will print to console
```

or

```bash
VERBOSE_TESTS=1 pnpm test
# Same as DEBUG_TESTS=1
```

### Running Specific Tests with Logging
```bash
DEBUG_TESTS=1 pnpm test jgit-full-suite
DEBUG_TESTS=1 pnpm test fossil-like-ranges
```

## Benefits

1. **Cleaner Test Output** - Normal test runs are silent, showing only test results
2. **On-Demand Debugging** - Enable verbose logging when needed without code changes
3. **Consistent API** - All tests use the same logging mechanism
4. **Easy Migration** - Simple drop-in replacement for console.log
5. **Performance** - Can conditionally skip expensive logging operations

## Test Results

All 422 tests pass successfully:
- 23 test files
- 422 passing tests
- No console.log noise during normal runs

## Migration Pattern

For any new tests or updates to existing tests:

```typescript
// Old way
console.log("Debug message", data);

// New way
import { testLog } from "../test-logger.js";
testLog("Debug message", data);
```

For conditional logging:

```typescript
import { testLog, isTestLogEnabled } from "../test-logger.js";

if (isTestLogEnabled()) {
  const expensiveData = computeExpensiveReport();
  testLog("Detailed report:", expensiveData);
}
```

## Environment Variables

The logger checks these environment variables:
- `DEBUG_TESTS` - Set to `1` or `true` to enable logging
- `VERBOSE_TESTS` - Set to `1` or `true` to enable logging (alias)

## Future Enhancements

Possible improvements:
- Add log levels (info, warn, error, debug)
- Support different output formats (JSON, structured)
- Add timing/profiling utilities
- Support log filtering by test file/suite
