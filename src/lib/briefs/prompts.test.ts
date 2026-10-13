import { describe, expect, it } from "vitest";

import type { BriefCriterion, MatchResult } from "@/lib/db/types";

import type { MatchProfile } from "./matching";
import {
  EXPLANATION_MAX,
  explanationPayload,
  explanationSystemPrompt,
  extractionSystemPrompt,
  extractionUserPrompt,
  protectedCriterion,
  queryTextOf,
  textQueryOf,
} from "./prompts";

const criteria: BriefCriterion[] = [
  { id: "a", kind: "skill", label: "Contrôle de gestion", value: "contrôle de gestion", required: true, weight: 3 },
  { id: "b", kind: "language", label: "Anglais courant", value: "anglais B2", required: false, weight: 2 },
];

const brief = {
  title: "Contrôleur de gestion senior",
  description: "Nous recherchons un contrôleur de gestion senior pour Lyon, anglais courant, disponible sous trois mois.",
  criteria,
};

describe("queryTextOf", () => {
  it("joins the title, the description and the criteria once each", () => {
    const text = queryTextOf(brief);
    const lines = text.split("\n");
    expect(lines[0]).toBe(brief.title);
    expect(lines[1]).toBe(brief.description);
    expect(lines).toContain("Contrôle de gestion");
    expect(lines).toContain("anglais B2");
    expect(lines.filter((line) => line === "Anglais courant")).toHaveLength(1);
  });

  it("skips empty parts and caps the length", () => {
    expect(queryTextOf({ title: "  ", description: "", criteria: [] })).toBe("");
    expect(queryTextOf({ title: "x".repeat(10_000), description: "", criteria: [] })).toHaveLength(6000);
  });
});

describe("textQueryOf", () => {
  it("puts the criteria first, drops stop words and short words, joins with OR", () => {
    const query = textQueryOf(brief);
    const terms = query.split(" OR ");
    expect(terms[0]).toBe("controle");
    expect(terms[1]).toBe("gestion");
    expect(terms).toContain("anglais");
    expect(terms).toContain("lyon");
    expect(terms).not.toContain("nous");
    expect(terms).not.toContain("un");
    expect(terms).not.toContain("recherchons");
    expect(new Set(terms).size).toBe(terms.length);
  });

  it("stops at the cap and answers an empty string for nothing", () => {
    expect(textQueryOf(brief, 2)).toBe("controle OR gestion");
    expect(textQueryOf({ title: "de la", description: "", criteria: [] })).toBe("");
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
});

describe("prompts", () => {
  it("say the rules once", () => {
    const system = extractionSystemPrompt();
    expect(system).toContain('"criteria"');
    expect(system).toContain("protected characteristic");
    expect(system).toContain("At most 12");
    expect(extractionUserPrompt({ title: " T ", description: "" })).toBe("Title: T\n\nBrief:\n(no description)");
    expect(explanationSystemPrompt()).toContain("not_stated");
    expect(explanationSystemPrompt()).toContain("No praise");
  });
});

function profile(id: string): MatchProfile {
  return {
    id,
    headline: "Contrôleur de gestion",
    summary: "s".repeat(1000),
    skills: ["SAP", " ", "Excel"],
    languages: [{ name: "Anglais", level: "C1" }, { name: "", level: null }],
    location: "Lyon",
    years_experience: 7,
    availability: null,
    education: [{ degree: "Master CCA", school: "IAE", year: null }],
    search_text: "never sent",
  };
}

function result(id: string): MatchResult {
  return {
    candidateId: id,
    score: 50,
    coverage: 1,
    blocked: false,
    verdicts: [{ criterionId: "a", verdict: "match", evidence: "e".repeat(300) }, { criterionId: "zz", verdict: "not_stated", evidence: null }],
    why: null,
    retrieval: { textRank: 1, vectorRank: null },
  };
}

describe("explanationPayload", () => {
  it("sends a compact profile with the verdicts named by their label, no name, no contact", () => {
    const payload = explanationPayload(brief, [{ profile: profile("c1"), result: result("c1") }]);
    expect(payload.brief.criteria.map((criterion) => criterion.id)).toEqual(["a", "b"]);
    const candidate = payload.candidates[0]!;
    expect(candidate.candidateId).toBe("c1");
    expect(candidate.summary).toHaveLength(600);
    expect(candidate.skills).toEqual(["SAP", "Excel"]);
    expect(candidate.languages).toEqual(["Anglais (C1)"]);
    expect(candidate.education).toEqual(["Master CCA — IAE"]);
    expect(candidate.verdicts).toEqual([
      { criterion: "Contrôle de gestion", verdict: "match", evidence: "e".repeat(120) },
      { criterion: "zz", verdict: "not_stated", evidence: null },
    ]);
    const json = JSON.stringify(payload);
    expect(json).not.toContain("never sent");
    expect(json).not.toContain("full_name");
    expect(json).not.toContain("email");
  });

  it("explains at most EXPLANATION_MAX candidates", () => {
    const many = Array.from({ length: EXPLANATION_MAX + 5 }, (_, index) => ({ profile: profile(`c${index}`), result: result(`c${index}`) }));
    expect(explanationPayload(brief, many).candidates).toHaveLength(EXPLANATION_MAX);
  });
});
