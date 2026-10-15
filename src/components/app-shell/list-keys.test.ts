import { describe, expect, it } from "vitest";

import { moveIndex } from "./list-keys";

describe("moveIndex", () => {
  it("moves down and up and holds at the ends", () => {
    expect(moveIndex("ArrowDown", 0, 3)).toBe(1);
    expect(moveIndex("ArrowDown", 2, 3)).toBe(2);
    expect(moveIndex("ArrowUp", 2, 3)).toBe(1);
    expect(moveIndex("ArrowUp", 0, 3)).toBe(0);
  });

  it("selects the first row from nothing, whichever arrow", () => {
    expect(moveIndex("ArrowDown", -1, 3)).toBe(0);
    expect(moveIndex("ArrowUp", -1, 3)).toBe(0);
  });

  it("jumps to the ends", () => {
    expect(moveIndex("Home", 2, 5)).toBe(0);
    expect(moveIndex("End", 0, 5)).toBe(4);
  });

  it("answers null for another key or an empty list", () => {
    expect(moveIndex("Enter", 1, 3)).toBeNull();
    expect(moveIndex("ArrowDown", 0, 0)).toBeNull();
    expect(moveIndex("ArrowDown", 0, Number.NaN)).toBeNull();
  });

  it("reads an odd index as a row of the list", () => {
    expect(moveIndex("ArrowDown", 9, 3)).toBe(2);
    expect(moveIndex("ArrowDown", 1.7, 3)).toBe(2);
    expect(moveIndex("ArrowUp", Number.NaN, 3)).toBe(0);
  });
});
