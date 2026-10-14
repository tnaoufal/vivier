import { describe, expect, it } from "vitest";

import type { BriefCriterion } from "@/lib/db/types";

import { relevantFirst } from "./skills";

function criterion(kind: BriefCriterion["kind"], label: string, value: string): BriefCriterion {
  return { id: `${kind}-${label}`, kind, label, value, required: false, weight: 2 };
}

const cv = ["Gestion de projet", "Excel", "React.js", "Anglais", "Python 3"];

describe("relevantFirst", () => {
  it("keeps the CV's order when the brief names no skill", () => {
    expect(relevantFirst(cv, [])).toEqual(cv);
    expect(relevantFirst(cv, [criterion("language", "Anglais courant", "anglais")])).toEqual(cv);
  });

  it("moves the skills the brief names to the front, each group in the CV's order", () => {
    const criteria = [criterion("skill", "Python", "python"), criterion("skill", "React", "react")];
    expect(relevantFirst(cv, criteria)).toEqual([
      "React.js",
      "Python 3",
      "Gestion de projet",
      "Excel",
      "Anglais",
    ]);
  });

  it("reads a skill named inside a criterion's label", () => {
    const criteria = [criterion("skill", "Maîtrise d'Excel", "excel avancé")];
    expect(relevantFirst(["Scrum", "Excel"], criteria)).toEqual(["Excel", "Scrum"]);
  });

  it("does not let a role's long definition reorder the skills", () => {
    const role = criterion("role", "Chef de projet", "Pilote des projets avec Excel et Python.");
    expect(relevantFirst(cv, [role])).toEqual(cv);
  });

  it("matches whole words only", () => {
    expect(relevantFirst(["React", "R"], [criterion("skill", "R", "r")])).toEqual(["R", "React"]);
    expect(relevantFirst(["C++", "C"], [criterion("skill", "C", "c")])).toEqual(["C", "C++"]);
  });

  it("ignores accents, case and spacing", () => {
    const criteria = [criterion("skill", "negociation commerciale", "")];
    expect(relevantFirst(["Excel", "Négociation  commerciale"], criteria)).toEqual([
      "Négociation  commerciale",
      "Excel",
    ]);
  });
});
