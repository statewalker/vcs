# ADR-0003 — Large-Object Plane

**Status:** Accepted — 2026-07-29 (implemented)

Companion records: [ADR-0001 — Two-Axis Architecture](0001-two-axis-architecture.md),
[ADR-0002 — Transport Substrate](0002-transport-substrate.md).

## Context

Large files are a problem for both axes: the versioning axis wants Git-LFS/Xet-style
out-of-band storage instead of bloating packs, and the sync axis wants content-defined
chunking for efficient transfer and deduplication. Solving this twice — once inside the git
core and once inside the sync engine — would rebuild the git↔sync weld ADR-0001 just severed,
and would smuggle git/LFS concepts into a component both axes share.

## Decision

**`content-store` is a domain-neutral content-defined-chunk / object store shared by both
axes.** It chunks content, addresses chunks and objects by an **injected content hash
(BLAKE3-class)** with **opaque ids**, and deduplicates. It is **not a third VCS** and holds
**no git and no LFS knowledge** — no pointer format, no `.gitattributes`, no clean/smudge, no
notion of a commit. Both `files-sync` (Axis A) and the git large-object skins (Axis B) reach
the same neutral store.

**Git/LFS compatibility is confined to an optional skin at the git boundary.** The following
live **only** in `vcs-working-tree` / `vcs-transport-lfs`, never in `content-store`:

- the **LFS pointer** file format;
- **`.gitattributes`** filter configuration;
- **clean / smudge** conversion, run inside the TypeScript pipeline (no native git-lfs binary);
- **whole-file SHA-256**, which is **authoritative for the LFS pointer**.

So `content-store` gives every axis chunk-level dedup and transfer with opaque ids, while the
git-specific identity (whole-file SHA-256 in an LFS pointer) and Git's filter machinery stay a
thin, optional skin over that neutral core. `vcs-transport-xet` is a second such skin
(Xet-style chunk dedup) over the same `content-store`.

## Consequences

- One large-object engine serves both axes; there is no second content store to keep in sync.
- Turning LFS on or off is adding or removing a skin, not touching `content-store`.
- Because ids are opaque and the hash is injected, `content-store` is reusable outside VCS and
  is not tied to any one digest.

### As implemented

`content-store` uses an **injected `hashContent`** (opaque ids), *not* intrinsic BLAKE3 — the
BLAKE3-class hash is a parameter, keeping the store digest-agnostic. This is consistent with
ADR-0001's note that on the versioning axis **sha256 is deferred** (`VcsCore.hash` returns
`"sha1"`); the whole-file SHA-256 described here is the LFS-skin identity, authoritative for
the LFS pointer, and independent of the git object hash. `content-store`, `content-transfer`,
`vcs-transport-lfs`, and `vcs-transport-xet` are all built and tested.
