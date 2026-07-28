import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

// Axis A hard ban: files-sync must import ONLY webrun-files + merge-core (plus
// node builtins and relative modules). Never git / vcs-core / versioning.
const SRC = path.resolve(import.meta.dirname, "../src");

const ALLOWED_PACKAGES = [/^@statewalker\/webrun-files(\/|$)/, /^@statewalker\/merge-core$/];

function srcFiles(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((e) => {
    const full = path.join(dir, e.name);
    if (e.isDirectory()) return srcFiles(full);
    return e.name.endsWith(".ts") ? [full] : [];
  });
}

function importSpecifiers(source: string): string[] {
  const re = /(?:import|export)[^"']*?from\s*["']([^"']+)["']/g;
  return [...source.matchAll(re)].map((m) => m[1]);
}

describe("neutrality", () => {
  it("imports only webrun-files, merge-core, node builtins, and relative modules", () => {
    for (const file of srcFiles(SRC)) {
      for (const spec of importSpecifiers(readFileSync(file, "utf8"))) {
        const isRelative = spec.startsWith(".");
        const isNode = spec.startsWith("node:");
        const isAllowedPkg = ALLOWED_PACKAGES.some((r) => r.test(spec));
        expect(
          isRelative || isNode || isAllowedPkg,
          `${path.basename(file)} imports disallowed "${spec}"`,
        ).toBe(true);
      }
    }
  });

  it("contains no git / vcs references in source", () => {
    for (const file of srcFiles(SRC)) {
      const text = readFileSync(file, "utf8");
      expect(/\bvcs-core\b/.test(text), `${path.basename(file)} references vcs-core`).toBe(false);
      expect(
        /@statewalker\/vcs/.test(text),
        `${path.basename(file)} imports @statewalker/vcs`,
      ).toBe(false);
    }
  });
});
