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

  /**
   * JGit parity tests for whitespace comparison modes.
   * Ported from RawTextIgnoreAllWhitespaceTest.java, RawTextIgnoreTrailingWhitespaceTest.java,
   * RawTextIgnoreLeadingWhitespaceTest.java, and RawTextIgnoreWhitespaceChangeTest.java.
   *
   * TODO: These comparator modes are not yet implemented.
   * JGit provides: WS_IGNORE_ALL, WS_IGNORE_TRAILING, WS_IGNORE_LEADING, WS_IGNORE_CHANGE
   * Our RawTextComparator only has DEFAULT (exact byte comparison).
   */
  describe("whitespace comparison modes (JGit parity)", () => {
    /**
     * JGit: RawTextIgnoreAllWhitespaceTest.testEqualsWithWhitespace
     * Tests WS_IGNORE_ALL mode - all whitespace is ignored in comparison.
     *
     * TODO: Requires implementing RawTextComparator.WS_IGNORE_ALL
     */
    describe.skip("WS_IGNORE_ALL mode", () => {
      it("should treat whitespace-only line as equal to empty line", () => {
        // "         " == ""
        const _a = new RawText("foo-a\n         \n");
        const _b = new RawText("foo-a\n\n");

        // With WS_IGNORE_ALL, line 1 of a (all spaces) equals line 1 of b (empty)
        // Currently not implemented - need RawTextComparator.WS_IGNORE_ALL
      });

      it("should ignore internal whitespace differences", () => {
        // " a b c" == "ab  c" when ignoring all whitespace
        const _a = new RawText(" a b c\n");
        const _b = new RawText("ab  c\n");

        // With WS_IGNORE_ALL, these lines should be equal
        // Currently not implemented
      });

      it("should ignore trailing whitespace", () => {
        // "a      " == "a" when ignoring all whitespace
        const _a = new RawText("a      \n");
        const _b = new RawText("a\n");

        // With WS_IGNORE_ALL, these lines should be equal
        // Currently not implemented
      });
    });

    /**
     * JGit: RawTextIgnoreTrailingWhitespaceTest.testEqualsWithWhitespace
     * Tests WS_IGNORE_TRAILING mode - only trailing whitespace is ignored.
     *
     * TODO: Requires implementing RawTextComparator.WS_IGNORE_TRAILING
     */
    describe.skip("WS_IGNORE_TRAILING mode", () => {
      it("should treat whitespace-only line as equal to empty line", () => {
        // "         " == "" (trailing whitespace ignored)
        const _a = new RawText("foo-a\n         \n");
        const _b = new RawText("foo-a\n\n");

        // With WS_IGNORE_TRAILING, line 1 of a equals line 1 of b
      });

      it("should NOT ignore leading whitespace", () => {
        // "    b" != "b" (leading whitespace matters)
        const _a = new RawText("    b\n");
        const _b = new RawText("b\n");

        // With WS_IGNORE_TRAILING, these lines should NOT be equal
      });

      it("should NOT ignore internal whitespace", () => {
        // " a b c" != "ab  c" (internal whitespace matters)
        const _a = new RawText(" a b c\n");
        const _b = new RawText("ab  c\n");

        // With WS_IGNORE_TRAILING, these lines should NOT be equal
      });

      it("should ignore trailing whitespace only", () => {
        // "a      " == "a"
        const _a = new RawText("a      \n");
        const _b = new RawText("a\n");

        // With WS_IGNORE_TRAILING, these lines should be equal
      });
    });

    /**
     * JGit: RawTextIgnoreLeadingWhitespaceTest.testEqualsWithWhitespace
     * Tests WS_IGNORE_LEADING mode - only leading whitespace is ignored.
     *
     * TODO: Requires implementing RawTextComparator.WS_IGNORE_LEADING
     */
    describe.skip("WS_IGNORE_LEADING mode", () => {
      it("should ignore leading whitespace", () => {
        // "    b" == "b" (leading whitespace ignored)
        const _a = new RawText("    b\n");
        const _b = new RawText("b\n");

        // With WS_IGNORE_LEADING, these lines should be equal
      });

      it("should NOT ignore trailing whitespace", () => {
        // "a      " != "a" (trailing whitespace matters)
        const _a = new RawText("a      \n");
        const _b = new RawText("a\n");

        // With WS_IGNORE_LEADING, these lines should NOT be equal
      });
    });

    /**
     * JGit: RawTextIgnoreWhitespaceChangeTest
     * Tests WS_IGNORE_CHANGE mode - whitespace changes are ignored but presence matters.
     *
     * TODO: Requires implementing RawTextComparator.WS_IGNORE_CHANGE
     */
    describe.skip("WS_IGNORE_CHANGE mode", () => {
      it("should treat multiple spaces as equal to single space", () => {
        // "a    b" == "a b" (whitespace amount changed but not added/removed)
        const _a = new RawText("a    b\n");
        const _b = new RawText("a b\n");

        // With WS_IGNORE_CHANGE, these lines should be equal
      });

      it("should NOT treat added whitespace as equal", () => {
        // "ab" != "a b" (whitespace was added where none existed)
        const _a = new RawText("ab\n");
        const _b = new RawText("a b\n");

        // With WS_IGNORE_CHANGE, these lines should NOT be equal
      });
    });
  });
});
