# @statewalker/vcs-store-sql

SQL-based persistent storage using SQLite for long-term data persistence with delta compression.

## Overview

This package stores VCS data in SQLite databases, providing durable persistence with efficient querying capabilities. Use it when you need reliable storage that survives application restarts, benefits from SQL's indexing for fast lookups, or requires the transactional guarantees that databases provide.

The implementation uses sql.js as an optional peer dependency, making it work in both Node.js and browser environments. sql.js compiles SQLite to WebAssembly, giving you a full SQL database without native dependencies. For Node.js applications preferring native SQLite, you can implement a custom adapter following the `DatabaseClient` interface.

Schema migrations handle database evolution automatically. When you upgrade to a new version of this package, the migration system brings your database schema up to date without data loss.

## Installation

```bash
pnpm add @statewalker/vcs-store-sql sql.js
```

Note: `sql.js` is an optional peer dependency. Install it to use the built-in `SqlJsAdapter`.

## Public API

### Factory Function

```typescript
import { createSQLStorage } from "@statewalker/vcs-store-sql";
import { SqlJsAdapter } from "@statewalker/vcs-store-sql/adapters/sql-js";

const db = await SqlJsAdapter.create();
const { storage, close } = await createSQLStorage(db);
```

### Main Exports

| Export | Description |
|--------|-------------|
| `createSQLStorage()` | Factory function for complete storage setup |
| `DatabaseClient` | Database client interface for custom adapters |
| `SQLObjectRepository` | Object repository implementation |
| `SQLDeltaRepository` | Delta repository implementation |
| `SQLMetadataRepository` | Metadata repository implementation |
| `SQLCommitStore` | Commit store implementation |
| `SQLRefStore` | Reference store implementation |
| `SQLStagingStore` | Staging store implementation |
| `SQLTagStore` | Tag store implementation |
| `SQLTreeStore` | Tree store implementation |

### Sub-exports

| Export Path | Description |
|-------------|-------------|
| `@statewalker/vcs-store-sql/adapters/sql-js` | sql.js database adapter |

## Usage Examples

### Basic Usage with sql.js

```typescript
import { createSQLStorage } from "@statewalker/vcs-store-sql";
import { SqlJsAdapter } from "@statewalker/vcs-store-sql/adapters/sql-js";

// Create in-memory database
const db = await SqlJsAdapter.create();
const { storage, close } = await createSQLStorage(db);

// Store content
async function* chunks() {
  yield new TextEncoder().encode("Hello, World!");
}
const id = await storage.objectStore.store(chunks());

// Load content
for await (const chunk of storage.objectStore.load(id)) {
  console.log(new TextDecoder().decode(chunk));
}

// Always close when done
await close();
```

### Persisting to File

sql.js databases can be exported and saved:

```typescript
import { createSQLStorage } from "@statewalker/vcs-store-sql";
import { SqlJsAdapter } from "@statewalker/vcs-store-sql/adapters/sql-js";
import { writeFile, readFile } from "fs/promises";

// Create and use storage
const db = await SqlJsAdapter.create();
const { storage, close } = await createSQLStorage(db);

// ... perform operations ...

// Export database to file
const data = db.export();
await writeFile("repository.db", data);

await close();

// Later: restore from file
const savedData = await readFile("repository.db");
const restoredDb = await SqlJsAdapter.create(savedData);
const restoredStorage = await createSQLStorage(restoredDb);
```

### Using with @statewalker/vcs-commands

```typescript
import { Git, createGitStore } from "@statewalker/vcs-commands";
import { createGitRepository } from "@statewalker/vcs-core";
import { createSQLStorage } from "@statewalker/vcs-store-sql";
import { SqlJsAdapter } from "@statewalker/vcs-store-sql/adapters/sql-js";

const db = await SqlJsAdapter.create();
const { storage, close } = await createSQLStorage(db);

// Create repository and wrap with Git commands
const repository = await createGitRepository();
const store = createGitStore({ repository, staging: storage.stagingStore });
const git = Git.wrap(store);

await git.add().addFilepattern(".").call();
await git.commit().setMessage("Initial commit").call();

// Remember to close
await close();
```

### Implementing a Custom Database Adapter

For native SQLite or other databases:

```typescript
import type { DatabaseClient } from "@statewalker/vcs-store-sql";

class BetterSqlite3Adapter implements DatabaseClient {
  private db: Database;

  constructor(db: Database) {
    this.db = db;
  }

  exec(sql: string): void {
    this.db.exec(sql);
  }

  run(sql: string, params?: unknown[]): { changes: number; lastInsertRowid: number } {
    const stmt = this.db.prepare(sql);
    const result = params ? stmt.run(...params) : stmt.run();
    return {
      changes: result.changes,
      lastInsertRowid: Number(result.lastInsertRowid),
    };
  }

  get<T>(sql: string, params?: unknown[]): T | undefined {
    const stmt = this.db.prepare(sql);
    return params ? stmt.get(...params) : stmt.get();
  }

  all<T>(sql: string, params?: unknown[]): T[] {
    const stmt = this.db.prepare(sql);
    return params ? stmt.all(...params) : stmt.all();
  }
}
```

## Architecture

### Design Decisions

SQLite was chosen for its ubiquity and reliability. It works everywhere, requires no server setup, and provides ACID guarantees. The sql.js WebAssembly build extends this reach to browsers without native code.

The schema design prioritizes query efficiency. Objects are stored with indexed hashes for O(1) lookups. Delta chains use foreign keys to maintain referential integrity. Metadata lives in a separate table to allow efficient scanning without loading object content.

### Implementation Details

**Schema Structure:**
- `objects` table: stores raw object content keyed by SHA-1 hash
- `deltas` table: tracks delta relationships and chains
- `metadata` table: caches object type, size, and delta information
- `refs` table: stores references (branches, tags, HEAD)
- `staging` table: manages staging area entries

**Migrations** live in `src/migrations/` and run automatically when you call `createSQLStorage()`. The migration system tracks which migrations have run and applies pending ones in order.

**Transactions** wrap multi-step operations to ensure consistency. If a commit partially fails, the database rolls back to its previous state.

## JGit References

JGit doesn't include SQL-based storage; this is a StateWalker VCS-specific implementation. However, the concepts map to JGit's storage abstraction:

| StateWalker VCS | JGit Equivalent |
|-----------------|-----------------|
| `SQLObjectRepository` | `ObjectDatabase` (different implementation) |
| `SQLRefStore` | `RefDatabase` (different implementation) |
| Migration system | No direct equivalent |

The SQL backend provides capabilities Git's file-based storage lacks, such as efficient prefix queries and transactional multi-object updates.

## Dependencies

**Runtime:**
- `@statewalker/vcs-core` - Interface definitions
- `@statewalker/vcs-utils` - Hashing, compression utilities
- `@statewalker/vcs-sandbox` - Sandbox utilities

**Peer Dependencies:**
- `sql.js` (optional) - SQLite compiled to WebAssembly

**Development:**
- `@statewalker/vcs-testing` - Test suites for validation
- `vitest` - Testing
- `rolldown` - Bundling
- `typescript` - Type definitions

## License

MIT
