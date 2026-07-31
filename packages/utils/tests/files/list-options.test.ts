import type { ListOptions as WebrunListOptions } from "@statewalker/webrun-files";
import { describe, expect, it } from "vitest";
import type { FileInfo, ListOptions } from "../../src/files/files-api.js";
import { createInMemoryFilesApi } from "../../src/files/mem-files-api.js";

/**
 * `FilesApi.list()` accepts a `ListOptions` argument.
 *
 * NOTE ON WHAT IS UNDER TEST. The *runtime* half of this suite passes before the
 * widening: `createInMemoryFilesApi()` returns a webrun `MemFilesApi`, which has
 * always honoured `{ recursive: true }`. What is missing is the *declaration* —
 * the vcs `FilesApi` says `list(path: string)`, so every call below is a type
 * error (TS2554) that neither vitest nor `pnpm umbrella build` can see (vitest
 * does not typecheck; the package tsconfig is `include: ["src"]`). The red for
 * this suite is therefore a tsc error, observed through:
 *
 *   ../node_modules/.bin/tsc --noEmit -p tests/tsconfig.typecheck.json
 */

async function paths(entries: AsyncIterable<FileInfo>): Promise<string[]> {
  const out: string[] = [];
  for await (const entry of entries) out.push(entry.path);
  return out.sort();
}

function tree() {
  return createInMemoryFilesApi({
    "/proj/README.md": "readme",
    "/proj/src/index.ts": "index",
    "/proj/src/deep/nested.ts": "nested",
  });
}

describe("FilesApi.list(path, options)", () => {
  it("lists only immediate children when no options are passed", async () => {
    const files = tree();

    expect(await paths(files.list("/proj"))).toEqual(["/proj/README.md", "/proj/src"]);
  });

  it("lists only immediate children when recursive is explicitly false", async () => {
    const files = tree();

    expect(await paths(files.list("/proj", { recursive: false }))).toEqual([
      "/proj/README.md",
      "/proj/src",
    ]);
  });

  it("lists all descendants when recursive is true", async () => {
    const files = tree();

    expect(await paths(files.list("/proj", { recursive: true }))).toEqual([
      "/proj/README.md",
      "/proj/src",
      "/proj/src/deep",
      "/proj/src/deep/nested.ts",
      "/proj/src/index.ts",
    ]);
  });

  it("accepts a ListOptions value built independently of the call site", async () => {
    const files = tree();
    const options: ListOptions = { recursive: true };

    expect(await paths(files.list("/proj/src", options))).toEqual([
      "/proj/src/deep",
      "/proj/src/deep/nested.ts",
      "/proj/src/index.ts",
    ]);
  });
});

/**
 * Drift alarm between the vcs `ListOptions` and the webrun one.
 *
 * vcs deliberately declares its own `ListOptions` rather than re-exporting
 * webrun's, so the two can silently diverge: every `FilesApi` implementation in
 * this repo delegates to webrun, so a field webrun gains (or drops) is a field
 * vcs callers cannot express (or express in vain).
 *
 * The comparison is over the KEY SETS, not mutual assignability. `A extends B`
 * in both directions stays green when either side gains an *optional* field —
 * and since `ListOptions` is all-optional, that is the only realistic drift, so
 * an assignability pair would never ring. A two-way `keyof` comparison does ring
 * (TS2322), for optional and required fields alike.
 */
type SameKeys<A, B> = [keyof A] extends [keyof B]
  ? [keyof B] extends [keyof A]
    ? true
    : false
  : false;

describe("ListOptions conformance with @statewalker/webrun-files", () => {
  it("declares exactly the webrun ListOptions key set", () => {
    // Type-level assertion: goes red (TS2322) the moment either side gains or
    // loses a field. Only the scratch tsconfig above observes it.
    const keysMatch: SameKeys<ListOptions, WebrunListOptions> = true;

    expect(keysMatch).toBe(true);
  });
});
