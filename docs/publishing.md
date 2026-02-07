# Multi-Platform Publishing Guide

## NPM

All `@statewalker/vcs-*` packages publish to the npm registry via [Changesets](https://github.com/changesets/changesets).

### Creating a Release

```bash
# 1. Create a changeset describing your changes
pnpm changeset

# 2. Version packages (updates package.json versions and changelogs)
pnpm version

# 3. Build and publish
pnpm release
```

### Automated Releases

Merging to `main` triggers the GitHub Actions release workflow:

1. Changesets action detects pending changesets
2. Creates a "Version Packages" PR with bumped versions
3. On merge, publishes all changed packages to npm

**Required secret:** `NPM_TOKEN` in repository settings.

### Installing from NPM

```bash
npm install @statewalker/vcs-core @statewalker/vcs-store-mem
```

```typescript
import { createHistory } from "@statewalker/vcs-core";
import { createMemoryHistory } from "@statewalker/vcs-store-mem";
```

## Deno / JSR

Each package includes a `jsr.json` config pointing to TypeScript sources. No Node.js-specific APIs are used in browser-compatible packages.

### Publishing to JSR

```bash
cd packages/core
deno publish
```

### Using from Deno

```typescript
import { createHistory } from "jsr:@statewalker/vcs-core";
```

Or with an import map:

```json
{
  "imports": {
    "@statewalker/vcs-core": "jsr:@statewalker/vcs-core@0.1"
  }
}
```

**Note:** `@statewalker/vcs-utils-node` is Node.js-specific and not available on JSR.

## JSPM

After publishing to npm, packages are automatically available via the JSPM CDN.

### Using with Import Maps

```html
<script type="importmap">
{
  "imports": {
    "@statewalker/vcs-core": "https://ga.jspm.io/npm:@statewalker/vcs-core@0.1.0/dist/index.js"
  }
}
</script>
<script type="module">
  import { createHistory } from "@statewalker/vcs-core";
</script>
```

### JSPM Generator

```bash
npx jspm install @statewalker/vcs-core @statewalker/vcs-store-mem
```

## ESM.sh

After publishing to npm, packages are automatically available via esm.sh.

### Browser Usage

```html
<script type="module">
  import { createHistory } from "https://esm.sh/@statewalker/vcs-core@0.1.0";
  import { createMemoryHistory } from "https://esm.sh/@statewalker/vcs-store-mem@0.1.0";
</script>
```

### Deno Usage via ESM.sh

```typescript
import { createHistory } from "https://esm.sh/@statewalker/vcs-core@0.1.0";
```

## Package Overview

| Package | Description | Platforms |
|---------|-------------|-----------|
| `@statewalker/vcs-core` | Core VCS interfaces and history management | NPM, JSR, JSPM, ESM.sh |
| `@statewalker/vcs-commands` | Git-like commands (commit, checkout, merge) | NPM, JSR, JSPM, ESM.sh |
| `@statewalker/vcs-transport` | Git transport protocol (fetch, push, clone) | NPM, JSR, JSPM, ESM.sh |
| `@statewalker/vcs-utils` | Hashing, compression, delta encoding | NPM, JSR, JSPM, ESM.sh |
| `@statewalker/vcs-utils-node` | Node.js-specific utilities | NPM only |
| `@statewalker/vcs-store-mem` | In-memory storage backend | NPM, JSR, JSPM, ESM.sh |
| `@statewalker/vcs-store-kv` | Key-value storage backend | NPM, JSR, JSPM, ESM.sh |
| `@statewalker/vcs-store-sql` | SQL-based storage backend | NPM, JSR, JSPM, ESM.sh |
| `@statewalker/vcs-transport-adapters` | Transport adapters | NPM, JSR, JSPM, ESM.sh |
| `@statewalker/vcs-port-peerjs` | PeerJS MessagePort adapter | NPM, JSR, JSPM, ESM.sh |
| `@statewalker/vcs-port-websocket` | WebSocket MessagePort adapter | NPM, JSR, JSPM, ESM.sh |
| `@statewalker/vcs-port-webrtc` | WebRTC MessagePort adapter | NPM, JSR, JSPM, ESM.sh |
