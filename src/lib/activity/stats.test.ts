import { describe, expect, it } from "vitest";

import { monthStartIso } from "./stats";

describe("monthStartIso", () => {
  it("answers the first instant of the month in the local time zone", () => {
    const now = new Date(2026, 9, 13, 15, 30);
    const start = new Date(monthStartIso(now));
    expect(start.getFullYear()).toBe(2026);
    expect(start.getMonth()).toBe(9);
    expect(start.getDate()).toBe(1);
    expect(start.getHours()).toBe(0);
    expect(start.getMinutes()).toBe(0);
    expect(start.getTime()).toBeLessThanOrEqual(now.getTime());
  });

  it("is a valid ISO instant", () => {
    expect(monthStartIso(new Date(2026, 0, 31))).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/);
  });
});
