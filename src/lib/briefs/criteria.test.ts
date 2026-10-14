import { describe, expect, it } from "vitest";

import {
  cleanCriteria,
  countProtected,
  CRITERION_KINDS,
  emptyCriterion,
  hasSimilar,
  isComplete,
  isCriterionKind,
  parseCriteria,
  protectedCriterion,
  roleCriterion,
  roleCriterionOf,
  roleFirst,
  roleFromTitle,
  sameCriteria,
  toWeight,
  VALUE_MAX,
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

  it("reads a role, keeps its definition up to 600 characters, and keeps one role only", () => {
    const definition = "d".repeat(700);
    const parsed = parseCriteria([
      { id: "s", kind: "skill", label: "SAP", value: "sap", required: false, weight: 2 },
      { id: "r1", kind: "role", label: "Business Developer", value: definition, required: true, weight: 3 },
      { id: "r2", kind: "role", label: "Account manager", value: "autre", required: true, weight: 3 },
    ]);
    expect(parsed.map((criterion) => criterion.id)).toEqual(["s", "r1"]);
    expect(parsed[1]?.value).toHaveLength(VALUE_MAX);
    expect(VALUE_MAX).toBe(600);
  });

  it("leaves out a stored row about a protected characteristic, and counts it for the server's log", () => {
    const stored = [
      { id: "1", kind: "skill", label: "SAP", value: "sap", required: true, weight: 3 },
      { id: "2", kind: "other", label: "Âge", value: "moins de 35 ans", required: false, weight: 2 },
      { id: "3", kind: "other", label: "Nationalité", value: "française", required: true, weight: 2 },
      { id: "4", kind: "other", label: "", value: "enfants", required: false, weight: 2 },
    ];
    expect(parseCriteria(stored).map((criterion) => criterion.id)).toEqual(["1"]);
    // The blank row is not a criterion at all: only the two readable ones count.
    expect(countProtected(stored)).toBe(2);
    expect(countProtected(null)).toBe(0);
  });

  it("keeps a stored role whose definition names the job's domain, and still drops any other kind on the same words", () => {
    const stored = [
      { id: "r", kind: "role", label: "Business Developer", value: "Famille de métiers : commercial. Politique commerciale, prospection.", required: true, weight: 3 },
      { id: "s", kind: "skill", label: "Politique commerciale", value: "politique commerciale", required: false, weight: 2 },
    ];
    expect(parseCriteria(stored).map((criterion) => criterion.id)).toEqual(["r"]);
    expect(countProtected(stored)).toBe(1);
  });
});

describe("protectedCriterion", () => {
  it("drops age, gender, origin, family, health, religion, politics", () => {
    expect(protectedCriterion("Âge", "moins de 30 ans")).toBe(true);
    expect(protectedCriterion("Femme", "femme")).toBe(true);
    expect(protectedCriterion("Nationalité française", "française")).toBe(true);
    expect(protectedCriterion("Sans enfants", "enfants")).toBe(true);
    expect(protectedCriterion("Handicap", "rqth")).toBe(true);
    expect(protectedCriterion("Religion", "x")).toBe(true);
    expect(protectedCriterion("Opinion politique", "x")).toBe(true);
  });

  it("keeps ordinary criteria", () => {
    expect(protectedCriterion("Coverage ratio", "coverage")).toBe(false);
    expect(protectedCriterion("Stage de fin d'études", "stage")).toBe(false);
    expect(protectedCriterion("Secteur santé", "sante")).toBe(false);
    expect(protectedCriterion("Anglais courant", "anglais B2")).toBe(false);
  });

  it("reads a role on the core list only: a job's domain is written with words that say nothing about a person", () => {
    const definition = "Famille de métiers : commercial. Missions : prospection de nouveaux comptes, vente, négociation.";
    expect(protectedCriterion("Business Developer", definition, "role")).toBe(false);
    expect(protectedCriterion("Responsable famille de produits", "achats : pilotage d'une famille de produits", "role")).toBe(false);
    expect(protectedCriterion("Chargé de mission politique de la ville", "politique de la ville, politique commerciale", "role")).toBe(false);
    expect(protectedCriterion("Photographe", "photographie de produits, studio photo", "role")).toBe(false);
    expect(protectedCriterion("Auxiliaire de puériculture", "accueil des enfants en crèche", "role")).toBe(false);
    // Any other kind, or none given, still refuses those words.
    expect(protectedCriterion("Business Developer", definition, "skill")).toBe(true);
    expect(protectedCriterion("Business Developer", definition)).toBe(true);
    // The core list binds the role like every other criterion.
    expect(protectedCriterion("Business Developer", "moins de 35 ans, nationalité française", "role")).toBe(true);
    expect(protectedCriterion("Vendeuse", "femme, sans handicap", "role")).toBe(true);
    expect(protectedCriterion("Business Developer", "âge : 25-30", "role")).toBe(true);
  });
});

describe("roleFromTitle", () => {
  it("makes the title stand for the label and the definition, or the first line of the description", () => {
    expect(roleFromTitle({ title: " Business Developer ", description: "Conquête de comptes." }, "r")).toEqual({
      id: "r",
      kind: "role",
      label: "Business Developer",
      value: "Business Developer",
      required: true,
      weight: 3,
    });
    expect(roleFromTitle({ title: "", description: "Business Developer\nConquête de comptes." })?.label).toBe("Business Developer");
    expect(roleFromTitle({ title: "Responsable famille de produits", description: "" })?.value).toBe("Responsable famille de produits");
    expect(roleFromTitle({ title: " ", description: "" })).toBeNull();
  });

  it("answers null for a title that names a protected characteristic: saved, it would be dropped on the next read and derived again on every run", () => {
    const role = roleFromTitle({ title: "Hôtesse d'accueil, nationalité française", description: "" });
    expect(role).toBeNull();
    // What the parser would do with such a row, had it been saved.
    const stored = [{ id: "r", kind: "role", label: "Hôtesse d'accueil, nationalité française", value: "Hôtesse d'accueil, nationalité française", required: true, weight: 3 }];
    expect(parseCriteria(stored)).toEqual([]);
    expect(countProtected(stored)).toBe(1);
  });
});


describe("helpers", () => {
  it("knows the kinds and the weights, the role first", () => {
    expect(CRITERION_KINDS[0]).toBe("role");
    expect(isCriterionKind("role")).toBe(true);
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

  it("cleans and compares lists, and never saves a row about a protected characteristic", () => {
    const rows = [
      withId({ kind: "skill", label: " SAP ", value: "sap", required: false, weight: 2 }, "a"),
      withId({ kind: "skill", label: "", value: "x", required: false, weight: 2 }, "b"),
      withId({ kind: "other", label: "Sans enfants", value: "sans enfants", required: true, weight: 3 }, "c"),
    ];
    const clean = cleanCriteria(rows);
    expect(clean).toHaveLength(1);
    expect(clean[0]?.label).toBe("SAP");
    // A role is read on the core list: its definition may name the job's domain.
    const role = roleCriterionOf("Business Developer", "Famille de métiers : commercial, prospection.", "r");
    expect(cleanCriteria([role, ...rows]).map((criterion) => criterion.id)).toEqual(["r", "a"]);
    expect(cleanCriteria([roleCriterionOf("Vendeuse", "femme de moins de 30 ans", "p")])).toEqual([]);
    expect(sameCriteria(clean, clean)).toBe(true);
    expect(sameCriteria(clean, rows)).toBe(false);
    expect(sameCriteria(clean, clean.map((criterion) => ({ ...criterion, weight: 3 as const })))).toBe(false);
  });

  it("spots a similar criterion", () => {
    const rows = [withId({ kind: "language", label: "Anglais", value: "Anglais", required: false, weight: 2 }, "a")];
    expect(hasSimilar(rows, { kind: "language", value: "anglais" })).toBe(true);
    expect(hasSimilar(rows, { kind: "skill", value: "anglais" })).toBe(false);
  });
});

describe("the role criterion", () => {
  it("is required and essential by default, trimmed and capped", () => {
    const role = roleCriterionOf("  Business Developer ", ` ${"d".repeat(700)} `, "r");
    expect(role).toMatchObject({ id: "r", kind: "role", label: "Business Developer", required: true, weight: 3 });
    expect(role.value).toHaveLength(VALUE_MAX);
    expect(roleCriterionOf("x", "y").id).toMatch(/[0-9a-f-]{36}/);
  });

  it("is found wherever the brief keeps it and put first", () => {
    const skill = withId({ kind: "skill", label: "SAP", value: "sap", required: false, weight: 2 }, "s");
    const role = roleCriterionOf("Business Developer", "def", "r");
    expect(roleCriterion([skill, role])).toBe(role);
    expect(roleCriterion([skill])).toBeNull();
    expect(roleFirst([skill, role]).map((criterion) => criterion.id)).toEqual(["r", "s"]);
    expect(roleFirst([skill]).map((criterion) => criterion.id)).toEqual(["s"]);
  });

  it("is saved once: the clean-up keeps the first role and the rows after it", () => {
    const rows = [
      withId({ kind: "skill", label: "SAP", value: "sap", required: false, weight: 2 }, "s"),
      roleCriterionOf("Business Developer", "def", "r1"),
      roleCriterionOf("Account manager", "autre", "r2"),
      withId({ kind: "language", label: "Anglais", value: "anglais", required: false, weight: 2 }, "l"),
    ];
    expect(cleanCriteria(rows).map((criterion) => criterion.id)).toEqual(["s", "r1", "l"]);
  });
});
