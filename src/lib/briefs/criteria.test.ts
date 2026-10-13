import { describe, expect, it } from "vitest";

import {
  cleanCriteria,
  emptyCriterion,
  hasSimilar,
  isComplete,
  isCriterionKind,
  parseCriteria,
  sameCriteria,
  toWeight,
  withId,
} from "./criteria";

describe("parseCriteria", () => {
  it("keeps valid rows, trims them and drops the rest", () => {
    const parsed = parseCriteria([
      { id: "1", kind: "skill", label: "  SAP ", value: " sap ", required: true, weight: 3 },
      { id: "2", kind: "age", label: "Moins de 30 ans", value: "30", required: false, weight: 2 },
      { id: "3", kind: "skill", label: "", value: "x", required: false, weight: 2 },
      { id: "4", kind: "skill", label: "Excel", value: "excel", required: false, weight: 4 },
      { id: "1", kind: "skill", label: "Dup", value: "dup", required: false, weight: 1 },
      "nope",
    ]);
    expect(parsed).toEqual([{ id: "1", kind: "skill", label: "SAP", value: "sap", required: true, weight: 3 }]);
  });

  it("answers an empty list for anything but an array", () => {
    expect(parseCriteria(null)).toEqual([]);
    expect(parseCriteria("[]")).toEqual([]);
    expect(parseCriteria({ id: "1" })).toEqual([]);
  });
});

describe("helpers", () => {
  it("knows the kinds and the weights", () => {
    expect(isCriterionKind("language")).toBe(true);
    expect(isCriterionKind("gender")).toBe(false);
    expect(toWeight(3)).toBe(3);
    expect(toWeight(2.4)).toBe(2);
    expect(toWeight(0)).toBe(1);
    expect(toWeight(9)).toBe(3);
    expect(toWeight("3")).toBe(2);
    expect(toWeight(Number.NaN)).toBe(2);
  });

  it("builds rows with ids", () => {
    const row = withId({ kind: "skill", label: "SAP", value: "sap", required: false, weight: 2 }, "fixed");
    expect(row.id).toBe("fixed");
    expect(withId({ kind: "skill", label: "SAP", value: "sap", required: false, weight: 2 }).id).toMatch(/[0-9a-f-]{36}/);
    expect(emptyCriterion("language", "e").kind).toBe("language");
    expect(isComplete(emptyCriterion())).toBe(false);
    expect(isComplete({ label: "a", value: "b" })).toBe(true);
  });

  it("cleans and compares lists", () => {
    const rows = [
      withId({ kind: "skill", label: " SAP ", value: "sap", required: false, weight: 2 }, "a"),
      withId({ kind: "skill", label: "", value: "x", required: false, weight: 2 }, "b"),
    ];
    const clean = cleanCriteria(rows);
    expect(clean).toHaveLength(1);
    expect(clean[0]?.label).toBe("SAP");
    expect(sameCriteria(clean, clean)).toBe(true);
    expect(sameCriteria(clean, rows)).toBe(false);
    expect(sameCriteria(clean, [{ ...clean[0]!, weight: 3 }])).toBe(false);
  });

  it("spots a similar criterion", () => {
    const rows = [withId({ kind: "language", label: "Anglais", value: "Anglais", required: false, weight: 2 }, "a")];
    expect(hasSimilar(rows, { kind: "language", value: "anglais" })).toBe(true);
    expect(hasSimilar(rows, { kind: "skill", value: "anglais" })).toBe(false);
  });
});
