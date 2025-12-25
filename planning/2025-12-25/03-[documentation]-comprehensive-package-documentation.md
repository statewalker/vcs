# Comprehensive Package Documentation Plan

**Date:** 2025-12-25
**Project:** documentation
**Status:** Proposed

## Overview

This plan outlines the creation of comprehensive documentation for the WebRun VCS monorepo. The goal is to provide developers with clear, actionable documentation that explains both the "what" and the "why" of each package, enabling them to understand, use, and extend the codebase effectively.

## Documentation Structure

Each main package will receive two documentation artifacts:

1. **README.md** - User-facing documentation for quick understanding and getting started
2. **ARCHITECTURE.md** - Deep technical documentation for contributors and advanced users

The choice of ARCHITECTURE.md over DETAILS.md is intentional: "Architecture" communicates that the document explains design decisions and system organization, not just implementation details.

## Package Documentation Priority

Based on current documentation gaps and package importance:

| Priority | Package | Current State | README | ARCHITECTURE |
|----------|---------|---------------|--------|--------------|
| P1 | @webrun-vcs/core | No docs | Create | Create |
| P1 | @webrun-vcs/commands | No docs | Create | Create |
| P2 | @webrun-vcs/utils | Has README | Review/Enhance | Create |
| P2 | @webrun-vcs/transport | Has README | Review/Enhance | Create |

---

## Part 1: @webrun-vcs/core Documentation

### 1.1 README.md Structure

The core package is the foundation of the entire VCS system. Its README should communicate this foundational role clearly.

**Sections:**

1. **Overview** (2-3 paragraphs)
   - Position as the foundational type system, interface definitions, and VCS engine
   - Explain relationship with utils (foundation) and storage backends (implementations)
   - Highlight browser/Node.js compatibility

2. **Installation**
   - npm/pnpm install command
   - Peer dependency notes (utils)

3. **Core Concepts**
   - Git object model (blob, tree, commit, tag)
   - Object IDs and content-addressable storage
   - References and branching model

4. **Public API Reference** (table format)
   - Object types: `ObjectType`, `GitObject`, `Blob`, `Tree`, `Commit`, `Tag`
   - Stores: `BlobStore`, `TreeStore`, `CommitStore`, `TagStore`, `RefStore`
   - Operations: staging, status, worktree interfaces
   - Utilities: person identity, file modes, ignore patterns

5. **Usage Examples**
   - Creating and reading objects
   - Working with stores
   - Staging and status operations
   - Reference management

6. **Dependencies**
   - Relationship to @webrun-vcs/utils
   - External dependencies

### 1.2 ARCHITECTURE.md Structure

**Sections:**

1. **Design Philosophy**
   - Separation of interfaces from implementations
   - Storage-agnostic design
   - Browser-first with Node.js compatibility
   - JGit-inspired architecture

2. **Object Model Architecture**
   ```
   GitObject (base)
   ├── Blob - raw file content
   ├── Tree - directory structure (TreeEntry[])
   ├── Commit - snapshot with metadata
   └── Tag - annotated reference
   ```
   - Why content-addressable storage
   - Object ID generation (SHA-1)
   - Serialization format (Git-compatible)

3. **Store Hierarchy**
   ```
   RawStore (low-level key-value)
       ↓
   VirtualStore (object-aware layer)
       ↓
   ├── BlobStore
   ├── TreeStore
   ├── CommitStore
   ├── TagStore
   └── RefStore
   ```
   - Why layered store architecture
   - Store interface contracts
   - Relationship between stores

4. **Directory Structure Deep Dive**
   - `binary/` - Binary object serialization
   - `blob/`, `trees/`, `commits/`, `tags/` - Object-specific operations
   - `delta/` + `delta/strategies/` - Delta compression system
   - `files/` - File mode handling (executable, symlink, etc.)
   - `format/` - Git wire format utilities
   - `id/` - Object ID generation and validation
   - `ignore/` - Gitignore pattern matching
   - `objects/` - Core object type definitions
   - `pack/` - Pack file interfaces
   - `person/` - Author/committer identity
   - `refs/` - Reference management
   - `staging/` - Index/staging area
   - `status/` - Working tree status
   - `worktree/` - Working directory operations

5. **Key Algorithms**
   - Tree comparison and diff
   - Commit graph traversal
   - Reference resolution (symbolic refs, packed refs)

6. **Extension Points**
   - Implementing custom stores
   - Adding new object types
   - Custom staging strategies

7. **Code Examples**
   - Implementing a minimal store
   - Walking commit history
   - Building a tree from files

---

## Part 2: @webrun-vcs/commands Documentation

### 2.1 README.md Structure

**Sections:**

1. **Overview**
   - High-level command abstraction layer
   - Git CLI-like interface for programmatic use
   - Relationship to transport (network ops) and core (data structures)

2. **Installation**
   - Install command
   - Required peer dependencies

3. **Quick Start**
   - Basic Git instance creation
   - Common operations (init, add, commit, status)

4. **API Reference**
   - `Git` class - main entry point
   - `GitCommand` - local command base
   - `TransportCommand` - network command base
   - Command result types

5. **Available Commands** (table)
   - Local: init, add, commit, status, log, branch, checkout, etc.
   - Remote: clone, fetch, push, pull
   - Utility: config, diff, merge

6. **Usage Examples**
   - Repository initialization
   - Commit workflow (add, commit, log)
   - Branching and merging
   - Remote operations

7. **Error Handling**
   - Command error types
   - Error recovery patterns

### 2.2 ARCHITECTURE.md Structure

**Sections:**

1. **Command Pattern Design**
   - Why command pattern for VCS operations
   - Command lifecycle (create, configure, execute)
   - Result/error handling philosophy

2. **Class Hierarchy**
   ```
   GitCommand (abstract base)
   ├── Local Commands
   │   ├── AddCommand
   │   ├── CommitCommand
   │   ├── StatusCommand
   │   └── ...
   └── TransportCommand (network-aware base)
       ├── CloneCommand
       ├── FetchCommand
       ├── PushCommand
       └── ...
   ```

3. **Directory Structure Deep Dive**
   - `commands/` - Individual command implementations
   - `errors/` - Error type definitions
   - `results/` - Result type definitions
   - Root files: Git.ts, GitCommand.ts, TransportCommand.ts

4. **Integration Points**
   - How commands use core stores
   - Transport layer integration
   - Storage backend injection

5. **Adding New Commands**
   - Command interface requirements
   - Registration and discovery
   - Testing patterns

6. **Code Examples**
   - Implementing a custom command
   - Command composition patterns
   - Progress reporting

---

## Part 3: @webrun-vcs/utils Documentation

### 3.1 README.md Review/Enhancement

Current README exists and is comprehensive. Review for:
- Completeness of API reference
- Example coverage for all modules
- Consistency with other package READMEs

### 3.2 ARCHITECTURE.md Structure (New)

**Sections:**

1. **Foundation Role**
   - Zero VCS-specific dependencies
   - Pure algorithmic implementations
   - Browser/Node.js compatibility strategy

2. **Module Architecture**
   ```
   @webrun-vcs/utils
   ├── compression/ - zlib implementation
   ├── hash/
   │   ├── sha1/ - Git object IDs
   │   ├── crc32/ - Pack file checksums
   │   ├── rolling-checksum/ - rsync delta
   │   └── fossil-checksum/ - Fossil VCS compat
   ├── diff/
   │   ├── delta/ - Binary delta
   │   ├── patch/ - Delta application
   │   └── text-diff/ - Myers diff
   ├── cache/ - LRU caching
   └── streams/ - Async stream utilities
   ```

3. **Directory Structure Deep Dive**
   - `compression/` - pako wrapper with browser/Node variants
   - `hash/sha1/` - SHA-1 implementation details
   - `hash/crc32/` - Table-based CRC32
   - `hash/rolling-checksum/` - Adler-32 variant for rsync
   - `diff/delta/` - Binary delta creation
   - `diff/patch/` - Delta application
   - `diff/text-diff/` - Line-based Myers algorithm
   - `cache/` - Generic LRU cache
   - `streams/` - AsyncIterable utilities

4. **Algorithm Deep Dives**
   - SHA-1: Why and implementation notes
   - Rolling checksum: rsync algorithm explanation
   - Myers diff: O(ND) algorithm implementation
   - Delta compression: How binary deltas work

5. **Performance Considerations**
   - Browser vs Node.js performance
   - Memory management in streaming
   - Cache sizing guidelines

6. **Extension Points**
   - Custom hash implementations
   - Alternative compression
   - Cache eviction strategies

---

## Part 4: @webrun-vcs/transport Documentation

### 4.1 README.md Review/Enhancement

Current README is extensive. Review for:
- Protocol v2 coverage completeness
- Server implementation examples
- Error handling patterns

### 4.2 ARCHITECTURE.md Structure (New)

**Sections:**

1. **Protocol Architecture**
   - Git protocol overview (v1 vs v2)
   - HTTP transport vs SSH (HTTP-only support)
   - Stateless vs stateful operations

2. **Component Architecture**
   ```
   @webrun-vcs/transport
   ├── protocol/ - Wire format
   │   ├── pkt-line codec
   │   ├── capabilities
   │   └── pack handling
   ├── negotiation/ - Want/have FSM
   ├── connection/ - HTTP client
   ├── operations/ - fetch/push
   ├── handlers/ - Server-side
   │   ├── UploadPackHandler
   │   └── ReceivePackHandler
   ├── http-server/ - Complete server
   └── storage-adapters/ - VCS integration
   ```

3. **Directory Structure Deep Dive**
   - `protocol/` - Pkt-line encoding/decoding, capability negotiation
   - `negotiation/` - State machine for ref negotiation
   - `connection/` - HTTP connection management
   - `operations/` - High-level fetch/push implementations
   - `handlers/` - Server-side protocol handlers
   - `http-server/` - Complete HTTP Git server
   - `storage-adapters/` - Bridge between storage and protocol
   - `streams/` - Multiplexing and stream utilities

4. **Protocol Deep Dives**
   - Pkt-line format and framing
   - Capability negotiation process
   - Want/have negotiation algorithm
   - Pack file streaming

5. **Server Implementation**
   - Handler architecture
   - Request routing
   - Authentication hooks
   - Storage adapter patterns

6. **Extension Points**
   - Custom authentication
   - Protocol extensions
   - Custom storage adapters

---

## Part 5: Project-Level Documentation

### 5.1 Root ARCHITECTURE.md

A project-level architecture document explaining how all packages fit together.

**Sections:**

1. **System Overview**
   - Monorepo structure
   - Package dependency graph (visual)
   - Design principles

2. **Layer Architecture**
   ```
   Commands Layer (@webrun-vcs/commands)
        ↓
   Transport Layer (@webrun-vcs/transport)
        ↓
   Core Layer (@webrun-vcs/core)
   [Types + VCS Engine + Storage Interfaces]
        ↓
   Utilities (@webrun-vcs/utils)
        ↓
   Storage Backends (storage-*, store-*)
   ```

3. **Data Flow**
   - Read path: storage → core → commands
   - Write path: commands → core → storage
   - Network path: transport → storage

4. **Storage Backend Architecture**
   - Backend interface requirements
   - Available backends comparison
   - Choosing the right backend

5. **Common Use Cases**
   - Browser-based Git client
   - Server-side Git hosting
   - Offline-first applications

---

## Implementation Tasks

### Epic 1: Core Package Documentation
- **Task 1.1**: Write @webrun-vcs/core README.md
- **Task 1.2**: Write @webrun-vcs/core ARCHITECTURE.md
- **Task 1.3**: Add inline JSDoc to key exports

### Epic 2: Commands Package Documentation
- **Task 2.1**: Write @webrun-vcs/commands README.md
- **Task 2.2**: Write @webrun-vcs/commands ARCHITECTURE.md
- **Task 2.3**: Add usage examples to command classes

### Epic 3: Utils Package Documentation
- **Task 3.1**: Review and enhance existing README.md
- **Task 3.2**: Write @webrun-vcs/utils ARCHITECTURE.md
- **Task 3.3**: Add algorithm explanation comments

### Epic 4: Transport Package Documentation
- **Task 4.1**: Review and enhance existing README.md
- **Task 4.2**: Write @webrun-vcs/transport ARCHITECTURE.md
- **Task 4.3**: Add server implementation examples

### Epic 5: Project-Level Documentation
- **Task 5.1**: Write root ARCHITECTURE.md
- **Task 5.2**: Create package dependency diagram
- **Task 5.3**: Write getting started guide

---

## Documentation Standards

All documentation should follow the project's writing style guide:

1. **Write for humans** - Conversational tone, explain as if talking to a colleague
2. **Action-oriented** - Focus on what readers will accomplish
3. **Visual first** - Show examples before explanations
4. **Progressive complexity** - Start simple, reveal depth gradually
5. **Narrative over lists** - Default to prose paragraphs, use lists sparingly

### File Naming
- `README.md` - Package root, standard name
- `ARCHITECTURE.md` - Deep technical documentation

### Code Examples
- Use TypeScript with full type annotations
- Include imports to show module structure
- Provide runnable examples where possible

---

## Success Criteria

Documentation is complete when:

1. Each main package has both README.md and ARCHITECTURE.md
2. A new developer can understand the system from documentation alone
3. All public APIs have usage examples
4. Architecture decisions are explained with rationale
5. Extension points are clearly documented

---

## Notes

- Existing README files in transport and utils packages are well-written and can serve as templates
- The @webrun-vcs/staging package also lacks documentation but is lower priority (P3)
- Consider adding a CONTRIBUTING.md at the root for contributor guidelines
