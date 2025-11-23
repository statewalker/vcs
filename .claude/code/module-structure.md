# Module Structure and Import/Export Conventions

This document describes the module organization, import/export patterns, and folder structure conventions used in the webrun-vcs codebase.

## Folder Structure

Each source folder must contain an `index.ts` file that serves as the public API for that module. The index file re-exports all public types, functions, and classes from the module's internal files.

### Example Structure

```
src/
├── common/
│   ├── index.ts                    # Re-exports from all submodules
│   ├── compression/
│   │   ├── index.ts                # Re-exports compression providers
│   │   ├── types.ts
│   │   ├── node-compression-provider.ts
│   │   └── web-compression-provider.ts
│   ├── crypto/
│   │   ├── index.ts                # Re-exports crypto functions
│   │   └── crypto.ts
│   └── result.ts
├── delta/
│   ├── index.ts                    # Re-exports all delta algorithms
│   ├── apply-delta.ts
│   ├── create-delta.ts
│   └── types.ts
└── index.ts                        # Main entry point - re-exports all modules
```

## Export Conventions

### Use Wildcard Exports in Index Files

All `index.ts` files must use wildcard exports (`export *`) rather than named exports. This keeps the index files clean and ensures all public APIs are automatically available.

**✅ GOOD - Wildcard exports:**
```typescript
// src/delta/index.ts
export * from "./apply-delta.js";
export * from "./checksum-obj.js";
export * from "./create-delta.js";
export * from "./types.js";
```

**❌ BAD - Named exports:**
```typescript
// src/delta/index.ts
export { applyDelta } from "./apply-delta.js";
export { ChecksumObj } from "./checksum-obj.js";
export { createDelta, createDeltaAsync } from "./create-delta.js";
export type { DeltaRange, DeltaOp } from "./types.js";
```

### Main Entry Point

The main `src/index.ts` file re-exports from all top-level module folders:

```typescript
// src/index.ts
export * from "./common/index.js";
export * from "./delta/index.js";
export * from "./patch/index.js";
export * from "./text-diff/index.js";
```

## Import Conventions

### Internal Imports Must Use Folder Index

When importing from another folder within the same package, always import through the folder's `index.js` file rather than directly from specific files.

**✅ GOOD - Import from folder index:**
```typescript
// src/text-diff/binary-comparator.ts
import { weakChecksum } from "../delta/index.js";
```

**❌ BAD - Direct file import:**
```typescript
// src/text-diff/binary-comparator.ts
import { weakChecksum } from "../delta/create-fossil-ranges.js";
```

### Same-folder Imports

Imports within the same folder can reference specific files directly:

```typescript
// src/patch/patch-applier.ts
import { FileHeader, PatchType } from "./types.js";
import { parsePatch } from "./patch.js";
```

### External Package Imports

When importing from the package itself (e.g., in tests), use the main entry point:

```typescript
// tests/patch/patch-applier.test.ts
import {
  PatchApplier,
  parsePatch,
  NodeCompressionProvider
} from "../../src/index.js";
```

Or import from specific module folders when needed:

```typescript
// tests/patch/crypto.test.ts
import {
  sha1,
  sha256,
  gitObjectHash,
  WebCryptoProvider
} from "../../src/common/crypto/index.js";
```

## Benefits of This Pattern

### Clean Public API
The wildcard export pattern creates a clear separation between public API (what's in index.ts) and internal implementation (other files). Consumers can import from the module folder without knowing internal file structure.

### Refactoring Flexibility
You can reorganize internal files without breaking imports. As long as the same symbols are re-exported from index.ts, consumers don't need to update their imports.

### Reduced Import Verbosity
Instead of deep imports like `from "../delta/create-fossil-ranges.js"`, you use `from "../delta/index.js"`, which is cleaner and more maintainable.

### Automatic Tree-Shaking
Modern bundlers (like Rolldown) can still tree-shake unused exports when using wildcard exports, so there's no bundle size penalty.

## File Extensions

All imports must use the `.js` extension (not `.ts`) even in TypeScript files. This follows ES module conventions and ensures compatibility with both TypeScript and bundlers.

```typescript
// Correct
import { foo } from "./bar.js";
export * from "./baz.js";

// Incorrect
import { foo } from "./bar";
import { foo } from "./bar.ts";
```

## Migration Checklist

When adding a new module or refactoring existing code:

1. **Create index.ts** in each folder
2. **Use wildcard exports** (`export *`) in all index.ts files
3. **Import from folder index** for cross-folder imports
4. **Use .js extensions** for all import paths
5. **Test the build** to ensure everything resolves correctly
