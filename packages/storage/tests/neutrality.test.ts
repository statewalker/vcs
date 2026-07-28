import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

/**
 * Dep-lint: the storage seam is domain-neutral. Its source may import only from
 * itself (relative `./…`), from Node built-ins, and from `@statewalker/webrun-files`.
 * Any git/vcs/content-store/hashing import would leak domain knowledge into the seam.
 */
describe("neutrality (dep-lint)", () => {
  const srcDir = path.resolve(import.meta.dirname, "../src");

  function importsOf(file: string): string[] {
    const text = readFileSync(file, "utf8");
    const specs: string[] = [];
    const re = /(?:import|export)[^;]*?from\s*["']([^"']+)["']/g;
    for (let m = re.exec(text); m !== null; m = re.exec(text)) specs.push(m[1]);
    return specs;
  }

  it("src imports only relative paths and @statewalker/webrun-files", () => {
    const files = readdirSync(srcDir).filter((f) => f.endsWith(".ts"));
    expect(files.length).toBeGreaterThan(0);
    for (const f of files) {
      for (const spec of importsOf(path.join(srcDir, f))) {
        const ok = spec.startsWith(".") || spec === "@statewalker/webrun-files";
        expect(ok, `${f} imports forbidden module "${spec}"`).toBe(true);
      }
    }
  });
});
