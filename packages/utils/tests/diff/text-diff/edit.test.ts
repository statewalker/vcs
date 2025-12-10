import { describe, expect, it } from "vitest";
import { Edit, EditType } from "../../../src/diff/text-diff/edit.js";

describe("Edit", () => {
  it("should create an empty edit", () => {
    const edit = new Edit(0, 0, 0, 0);
    expect(edit.isEmpty()).toBe(true);
    expect(edit.getType()).toBe(EditType.EMPTY);
  });

  it("should create an insert edit", () => {
    const edit = new Edit(0, 0, 0, 2);
    expect(edit.getType()).toBe(EditType.INSERT);
    expect(edit.getLengthA()).toBe(0);
    expect(edit.getLengthB()).toBe(2);
  });

  it("should create a delete edit", () => {
    const edit = new Edit(0, 2, 0, 0);
    expect(edit.getType()).toBe(EditType.DELETE);
    expect(edit.getLengthA()).toBe(2);
    expect(edit.getLengthB()).toBe(0);
  });

  it("should create a replace edit", () => {
    const edit = new Edit(0, 2, 0, 3);
    expect(edit.getType()).toBe(EditType.REPLACE);
    expect(edit.getLengthA()).toBe(2);
    expect(edit.getLengthB()).toBe(3);
  });

  it("should shift edit correctly", () => {
    const edit = new Edit(1, 3, 2, 4);
    edit.shift(5);
    expect(edit.beginA).toBe(6);
    expect(edit.endA).toBe(8);
    expect(edit.beginB).toBe(7);
    expect(edit.endB).toBe(9);
  });

  it("should create before edit correctly", () => {
    const edit1 = new Edit(0, 10, 0, 15);
    const edit2 = new Edit(5, 10, 7, 15);
    const before = edit1.before(edit2);
    expect(before.beginA).toBe(0);
    expect(before.endA).toBe(5);
    expect(before.beginB).toBe(0);
    expect(before.endB).toBe(7);
  });

  it("should create after edit correctly", () => {
    const edit1 = new Edit(0, 10, 0, 15);
    const edit2 = new Edit(0, 5, 0, 7);
    const after = edit1.after(edit2);
    expect(after.beginA).toBe(5);
    expect(after.endA).toBe(10);
    expect(after.beginB).toBe(7);
    expect(after.endB).toBe(15);
  });

  it("should swap edit correctly", () => {
    const edit = new Edit(1, 3, 2, 5);
    edit.swap();
    expect(edit.beginA).toBe(2);
    expect(edit.endA).toBe(5);
    expect(edit.beginB).toBe(1);
    expect(edit.endB).toBe(3);
  });

  it("should test equality correctly", () => {
    const edit1 = new Edit(1, 3, 2, 4);
    const edit2 = new Edit(1, 3, 2, 4);
    const edit3 = new Edit(1, 3, 2, 5);
    expect(edit1.equals(edit2)).toBe(true);
    expect(edit1.equals(edit3)).toBe(false);
  });

  it("should format toString correctly", () => {
    const edit = new Edit(1, 3, 2, 4);
    const str = edit.toString();
    expect(str).toContain("REPLACE");
    expect(str).toContain("1-3");
    expect(str).toContain("2-4");
  });
});
