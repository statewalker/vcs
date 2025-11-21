import { buildGreeting } from "@webrun-vcs/core";
import { describe, expect, it } from "vitest";

describe("@webrun-vcs/core", () => {
  it("buildGreeting returns a greeting", () => {
    const result = buildGreeting({ name: "webrun-vcs" });
    expect(result).toBe("Hello from core, webrun-vcs!");
  });
});
