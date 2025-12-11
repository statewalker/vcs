import { describe, expect, it } from "vitest";
import { RawText } from "../../../src/diff/text-diff/raw-text.js";

describe("RawText", () => {
  it("should handle empty text", () => {
    const text = new RawText("");
    expect(text.size()).toBe(0);
  });

  it("should count lines correctly", () => {
    const text = new RawText("a\nb\nc\n");
    expect(text.size()).toBe(3);
  });

  it("should handle text without trailing newline", () => {
    const text = new RawText("a\nb\nc");
    expect(text.size()).toBe(3);
    expect(text.isMissingNewlineAtEnd()).toBe(true);
  });

  it("should handle text with trailing newline", () => {
    const text = new RawText("a\nb\nc\n");
    expect(text.size()).toBe(3);
    expect(text.isMissingNewlineAtEnd()).toBe(false);
  });

  it("should get line string correctly", () => {
    const text = new RawText("hello\nworld\n");
    expect(text.getString(0)).toBe("hello");
    expect(text.getString(1)).toBe("world");
  });

  it("should get raw line bytes correctly", () => {
    const text = new RawText("a\nb\n");
    const line0 = text.getRawString(0);
    expect(line0.length).toBe(1);
    expect(line0[0]).toBe(97); // 'a'
  });

  it("should detect binary content", () => {
    const binaryData = new Uint8Array([0x00, 0x01, 0x02]);
    expect(RawText.isBinary(binaryData)).toBe(true);

    const textData = new Uint8Array([0x61, 0x62, 0x63]); // 'abc'
    expect(RawText.isBinary(textData)).toBe(false);
  });

  it("should accept Uint8Array input", () => {
    const bytes = new TextEncoder().encode("line1\nline2\n");
    const text = new RawText(bytes);
    expect(text.size()).toBe(2);
    expect(text.getString(0)).toBe("line1");
  });

  it("should handle single line without newline", () => {
    const text = new RawText("single");
    expect(text.size()).toBe(1);
    expect(text.getString(0)).toBe("single");
  });
});
