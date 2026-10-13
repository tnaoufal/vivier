import { describe, expect, it } from "vitest";

import { seatsAvailable, seatsLeft } from "./seats";

describe("seatsAvailable", () => {
  it("allows one more seat below the limit and refuses at it", () => {
    expect(seatsAvailable(0, 3)).toBe(true);
    expect(seatsAvailable(2, 3)).toBe(true);
    expect(seatsAvailable(3, 3)).toBe(false);
    expect(seatsAvailable(5, 3)).toBe(false);
  });

  it("treats an unreadable count as full", () => {
    expect(seatsAvailable(Number.NaN, 3)).toBe(false);
    expect(seatsAvailable(1, Number.NaN)).toBe(false);
    expect(seatsAvailable(-1, 3)).toBe(false);
  });
});

describe("seatsLeft", () => {
  it("never goes below zero", () => {
    expect(seatsLeft(1, 3)).toBe(2);
    expect(seatsLeft(3, 3)).toBe(0);
    expect(seatsLeft(7, 3)).toBe(0);
    expect(seatsLeft(Number.NaN, 3)).toBe(0);
  });
});
