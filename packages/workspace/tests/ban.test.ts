import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

const here = import.meta.dirname;
const srcDir = path.resolve(here, "../src");
const packagesDir = path.resolve(here, "../..");

function readSrc(dir: string): string {
  let out = "";
  for (const name of readdirSync(dir)) {
    const p = path.join(dir, name);
    if (name.endsWith(".ts")) out += readFileSync(p, "utf8");
  }
  return out;
}

/** Collect the `@statewalker/...` specifiers imported anywhere under a src dir. */
function importsOf(dir: string): Set<string> {
  const src = readSrc(dir);
  const found = new Set<string>();
  for (const m of src.matchAll(/from\s+["'](@statewalker\/[\w-]+)/g)) found.add(m[1]);
  return found;
}

describe("the hard cross-axis ban holds", () => {
  it("workspace/src composes BOTH axes — file axis directly, history axis only structurally", () => {
    const imports = importsOf(srcDir);
    // Axis A (files) + large-object store are imported for real calls.
    expect(imports.has("@statewalker/files-sync")).toBe(true);
    expect(imports.has("@statewalker/content-store")).toBe(true);
    // The git engine is NOT imported: the history axis is reached only through the
    // structural Repository / GitRemote interfaces, so workspace cannot link the
    // two engines together.
    expect(imports.has("@statewalker/vcs-core")).toBe(false);
    expect(imports.has("@statewalker/vcs-working-tree")).toBe(false);
    expect(imports.has("@statewalker/vcs-transport")).toBe(false);
  });

  it("files-sync/src never imports vcs-core, and vcs-core never imports files-sync", () => {
    const filesSync = importsOf(path.join(packagesDir, "files-sync", "src"));
    expect(filesSync.has("@statewalker/vcs-core")).toBe(false);
    expect([...filesSync].some((s) => s.startsWith("@statewalker/vcs-"))).toBe(false);

    // vcs-core's facade dir must not reach into files-sync.
    const vcsCore = importsOf(path.join(packagesDir, "core", "src", "vcs-core"));
    expect(vcsCore.has("@statewalker/files-sync")).toBe(false);
  });
});
