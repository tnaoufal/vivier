import { describe, expect, it } from "vitest";

import { countProtected, parseCriteria, VALUE_MAX } from "./criteria";

// The parser of a stored criteria column is the web app's (zod); the
// rules it applies are the shared package's, tested next to it
// (packages/analysis/src/criteria.test.ts).
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
    expect(parsed).toEqual([
      { id: "1", kind: "skill", label: "SAP", value: "sap", required: true, weight: 3 },
    ]);
  });

  it("answers an empty list for anything but an array", () => {
    expect(parseCriteria(null)).toEqual([]);
    expect(parseCriteria("[]")).toEqual([]);
    expect(parseCriteria({ id: "1" })).toEqual([]);
  });

  it("reads a role, keeps its definition up to 600 characters, and keeps one role only", () => {
    const definition = "d".repeat(700);
    const parsed = parseCriteria([
      { id: "s", kind: "skill", label: "SAP", value: "sap", required: false, weight: 2 },
      {
        id: "r1",
        kind: "role",
        label: "Business Developer",
        value: definition,
        required: true,
        weight: 3,
      },
      {
        id: "r2",
        kind: "role",
        label: "Account manager",
        value: "autre",
        required: true,
        weight: 3,
      },
    ]);
    expect(parsed.map((criterion) => criterion.id)).toEqual(["s", "r1"]);
    expect(parsed[1]?.value).toHaveLength(VALUE_MAX);
    expect(VALUE_MAX).toBe(600);
  });

  it("leaves out a stored row about a protected characteristic, and counts it for the server's log", () => {
    const stored = [
      { id: "1", kind: "skill", label: "SAP", value: "sap", required: true, weight: 3 },
      {
        id: "2",
        kind: "other",
        label: "Âge",
        value: "moins de 35 ans",
        required: false,
        weight: 2,
      },
      {
        id: "3",
        kind: "other",
        label: "Nationalité",
        value: "française",
        required: true,
        weight: 2,
      },
      { id: "4", kind: "other", label: "", value: "enfants", required: false, weight: 2 },
    ];
    expect(parseCriteria(stored).map((criterion) => criterion.id)).toEqual(["1"]);
    // The blank row is not a criterion at all: only the two readable ones count.
    expect(countProtected(stored)).toBe(2);
    expect(countProtected(null)).toBe(0);
  });

  it("keeps a stored role whose definition names the job's domain, and still drops any other kind on the same words", () => {
    const stored = [
      {
        id: "r",
        kind: "role",
        label: "Business Developer",
        value: "Famille de métiers : commercial. Politique commerciale, prospection.",
        required: true,
        weight: 3,
      },
      {
        id: "s",
        kind: "skill",
        label: "Politique commerciale",
        value: "politique commerciale",
        required: false,
        weight: 2,
      },
    ];
    expect(parseCriteria(stored).map((criterion) => criterion.id)).toEqual(["r"]);
    expect(countProtected(stored)).toBe(1);
  });
});

describe("roleFromTitle, as the parser reads what it refuses", () => {
  it("drops a stored role that names a protected characteristic, and counts it", () => {
    // What the parser does with such a row, had it been saved (roleFromTitle itself answers null for it).
    const stored = [
      {
        id: "r",
        kind: "role",
        label: "Hôtesse d'accueil, nationalité française",
        value: "Hôtesse d'accueil, nationalité française",
        required: true,
        weight: 3,
      },
    ];
    expect(parseCriteria(stored)).toEqual([]);
    expect(countProtected(stored)).toBe(1);
  });
});
