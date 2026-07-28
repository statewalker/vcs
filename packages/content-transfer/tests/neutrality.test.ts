import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

/**
 * Dep-lint: content-transfer is domain-neutral. Its source may import only from
 * itself (relative `./…`), from `@statewalker/content-store`,
 * `@statewalker/webrun-streams`, and `@statewalker/webrun-files`. Any git/vcs/LFS
 * import — or even `@statewalker/files-sync` (a test-only interop dependency) —
 * would leak domain knowledge into the mover.
 */
describe("neutrality (dep-lint)", () => {
  const srcDir = path.resolve(import.meta.dirname, "../src");
  const allowed = new Set([
    "@statewalker/content-store",
    "@statewalker/webrun-streams",
    "@statewalker/webrun-files",
  ]);

  function importsOf(file: string): string[] {
    const text = readFileSync(file, "utf8");
    const specs: string[] = [];
    const re = /(?:import|export)[^;]*?from\s*["']([^"']+)["']/g;
    for (let m = re.exec(text); m !== null; m = re.exec(text)) specs.push(m[1]);
    return specs;
  }

  it("src imports only relative paths, content-store, webrun-streams and webrun-files", () => {
    const files = readdirSync(srcDir).filter((f) => f.endsWith(".ts"));
    expect(files.length).toBeGreaterThan(0);
    for (const f of files) {
      for (const spec of importsOf(path.join(srcDir, f))) {
        const ok = spec.startsWith(".") || allowed.has(spec);
        expect(ok, `${f} imports forbidden module "${spec}"`).toBe(true);
      }
    }
  });
});
