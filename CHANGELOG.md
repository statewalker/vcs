# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/).

## [Unreleased]

### Added

- **New Store Interfaces** (`@statewalker/vcs-core`)
  - `Blobs`, `Trees`, `Commits`, `Tags`, `Refs` — unified interfaces with consistent naming
  - `History` facade composing all typed stores
  - `HistoryWithOperations` extending History with delta and serialization APIs
  - `HistoryBackendFactory` pattern for pluggable storage creation
  - `createMemoryHistoryWithOperations()`, `createGitFilesHistory()` factory functions
  - `createHistory(type, config)` — registry-based creation from backend type string

- **Transport FSM v2** (`@statewalker/vcs-transport`)
  - Complete rewrite using explicit finite state machine architecture
  - Client/server fetch and push FSMs (`packages/transport/src/fsm/`)
  - Error recovery FSM with automatic retry and backoff
  - Protocol V2 FSMs for modern Git protocol support
  - High-level HTTP operations: `fetch()`, `clone()`, `push()`, `lsRemote()`
  - Socket operations: `createGitSocketClient()`, `handleGitSocketConnection()`, `createGitHttpServer()`
  - MessagePort utilities for WebSocket/WebRTC communication

- **WebRTC P2P Sync** (`apps/demos/webrtc-p2p-sync`)
  - PeerJS Duplex adapter with close marker protocol and service-type handshake
  - Ref remapping (refs/heads/* to refs/remotes/peer/*)
  - 4 integration tests passing

- **Native Git Interoperability** (`@statewalker/vcs-transport`)
  - Integration tests validating VCS HTTP transport against `git-http-backend`
  - Tests validating VCS HTTP server against native `git` client
  - 45/45 transport tests passing with zero skips

- **Multi-platform Publishing**
  - MIT LICENSE added to all packages
  - NPM publishing configured with Changesets + GitHub Actions
  - JSR configs for 11 browser-compatible packages
  - ESM exports compatible with JSPM and ESM.sh CDNs
  - Documentation at `docs/publishing.md`

- **API Documentation**
  - Updated `ARCHITECTURE.md` with current API design
  - JSDoc documentation for public APIs
  - Example apps: `09-repository-access`, `10-custom-storage`, `11-delta-strategies`

### Changed

- **Store API Migration**
  - Replaced `BlobStore`/`TreeStore`/`CommitStore`/`TagStore` with `Blobs`/`Trees`/`Commits`/`Tags`
  - Replaced `StorageBackend` pattern with `HistoryBackendFactory`
  - All packages migrated: core, commands, store-sql, store-kv, store-mem, transport-adapters
  - SQL stores implement new interfaces directly (no adapter layer)

- **Transport Layer**
  - Migrated from callback-based to FSM-based transport
  - PeerJS/WebRTC sessions rewritten to use `fetchOverDuplex`/`pushOverDuplex`
  - Mock HTTP tests replaced with real `createFetchHandler` servers

### Removed

- **Deprecated Code Cleanup**
  - Removed `SQLStorageBackend` class (replaced by `SQLHistoryFactory`)
  - Removed legacy store adapters (`BlobsAdapter`, `CommitsAdapter`, `TreesAdapter`, `TagsAdapter`)
  - Removed `createSimpleHistoryFromLegacyStores()` and `SimpleHistoryLegacyOptions`
  - Removed deprecated `mock-stores.ts` test helper (replaced by `mock-history.ts`)

- **Dead Code Removal**
  - Removed unused `BackendConfig` interface (superseded by `BaseBackendConfig`)
  - Removed unused `BackendType` type alias (superseded by `HistoryBackendType`)
  - Removed unused `encodeHeader()`, `encodeObjectHeaderFromCode()`, `stripHeader()` functions
  - Removed legacy store type exports from history index files

### Fixed

- 63 failing `@statewalker/vcs-commands` tests (commit `3744dfd`)
- Pack pipeline bugs: `GitBlobs.has()` type confusion, sideband report-status encoding
- Command parsing `split()` gotcha (use `indexOf` + `slice` for first-occurrence splitting)
- Capability null-byte separator in HTTP client
- PeerJS close signaling (close marker `[0x00, 0xFF]` protocol)
- Sideband flush handling in client fetch FSM
- API mismatches in example apps (`headRef?.id` to `headRef?.objectId`, etc.)
