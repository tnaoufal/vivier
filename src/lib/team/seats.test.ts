import { describe, expect, it } from "vitest";

import { seatsAvailable, seatsLeft, usageTone } from "./seats";

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

describe("usageTone", () => {
  it("turns to caution at four fifths and to negative at the limit", () => {
    expect(usageTone(0, 10)).toBe("primary");
    expect(usageTone(7, 10)).toBe("primary");
    expect(usageTone(8, 10)).toBe("caution");
    expect(usageTone(10, 10)).toBe("negative");
    expect(usageTone(12, 10)).toBe("negative");
  });

  it("stays calm on an unreadable pair", () => {
    expect(usageTone(Number.NaN, 10)).toBe("primary");
    expect(usageTone(3, 0)).toBe("primary");
  });
});
