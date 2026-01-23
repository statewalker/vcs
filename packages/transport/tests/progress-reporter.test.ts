/**
 * Tests for progress reporting.
 */

import { describe, expect, it } from "vitest";
import { parseProgressMessage } from "../src/streams/pack-receiver.js";
import { formatBytes, formatDuration, ProgressReporter } from "../src/streams/progress-reporter.js";

describe("parseProgressMessage", () => {
  it("should parse percent with current/total", () => {
    const result = parseProgressMessage("Receiving objects:  45% (123/456)");
    expect(result).toEqual({
      stage: "Receiving objects",
      percent: 45,
      current: 123,
      total: 456,
    });
  });

  it("should parse 100% done message", () => {
    const result = parseProgressMessage("Resolving deltas: 100% (456/456), done.");
    // When numbers are present, we parse them even if "done" is in the message
    expect(result).toEqual({
      stage: "Resolving deltas",
      percent: 100,
      current: 456,
      total: 456,
    });
  });

  it("should parse count without total", () => {
    const result = parseProgressMessage("Counting objects: 1234");
    expect(result).toEqual({
      stage: "Counting objects",
      current: 1234,
    });
  });

  it("should strip remote: prefix", () => {
    const result = parseProgressMessage("remote: Counting objects: 100");
    expect(result).toEqual({
      stage: "Counting objects",
      current: 100,
    });
  });

  it("should return null for unparseable message", () => {
    expect(parseProgressMessage("some random text")).toBeNull();
  });

  it("should return null for empty message", () => {
    expect(parseProgressMessage("")).toBeNull();
  });
});

describe("formatDuration", () => {
  it("should format milliseconds", () => {
    expect(formatDuration(500)).toBe("500ms");
    expect(formatDuration(999)).toBe("999ms");
  });

  it("should format seconds", () => {
    expect(formatDuration(1000)).toBe("1.0s");
    expect(formatDuration(5500)).toBe("5.5s");
    expect(formatDuration(59999)).toBe("60.0s");
  });

  it("should format minutes and seconds", () => {
    expect(formatDuration(60000)).toBe("1m 0s");
    expect(formatDuration(90000)).toBe("1m 30s");
    expect(formatDuration(125000)).toBe("2m 5s");
  });
});

describe("formatBytes", () => {
  it("should format bytes", () => {
    expect(formatBytes(0)).toBe("0 B");
    expect(formatBytes(512)).toBe("512 B");
    expect(formatBytes(1023)).toBe("1023 B");
  });

  it("should format kilobytes", () => {
    expect(formatBytes(1024)).toBe("1.0 KB");
    expect(formatBytes(1536)).toBe("1.5 KB");
    expect(formatBytes(1048575)).toBe("1024.0 KB");
  });

  it("should format megabytes", () => {
    expect(formatBytes(1048576)).toBe("1.0 MB");
    expect(formatBytes(52428800)).toBe("50.0 MB");
  });

  it("should format gigabytes", () => {
    expect(formatBytes(1073741824)).toBe("1.0 GB");
    expect(formatBytes(5368709120)).toBe("5.0 GB");
  });
});

describe("ProgressReporter", () => {
  it("should report progress info", () => {
    const messages: string[] = [];
    const reporter = new ProgressReporter((msg) => messages.push(msg));

    reporter.report({
      stage: "Receiving objects",
      current: 50,
      total: 100,
      percent: 50,
    });

    expect(messages).toEqual(["Receiving objects: 50% (50/100)"]);
  });

  it("should calculate percent if not provided", () => {
    const messages: string[] = [];
    const reporter = new ProgressReporter((msg) => messages.push(msg));

    reporter.report({
      stage: "Receiving",
      current: 75,
      total: 150,
    });

    expect(messages[0]).toBe("Receiving: 50% (75/150)");
  });

  it("should report without total", () => {
    const messages: string[] = [];
    const reporter = new ProgressReporter((msg) => messages.push(msg));

    reporter.report({
      stage: "Counting",
      current: 123,
    });

    expect(messages).toEqual(["Counting: 123"]);
  });

  it("should not duplicate messages", () => {
    const messages: string[] = [];
    const reporter = new ProgressReporter((msg) => messages.push(msg));

    reporter.message("hello");
    reporter.message("hello");
    reporter.message("world");

    expect(messages).toEqual(["hello", "world"]);
  });

  it("should report raw messages", () => {
    const messages: string[] = [];
    const reporter = new ProgressReporter((msg) => messages.push(msg));

    reporter.message("  some message with whitespace  ");

    expect(messages).toEqual(["some message with whitespace"]);
  });
});
