import { describe, expect, it } from "vitest";

import type { BriefCriterion } from "@/lib/db/types";

import {
  ASSESSMENT_PAYLOAD_MAX,
  assessmentPayload,
  assessmentSystemPrompt,
  extractionSystemPrompt,
  extractionUserPrompt,
  FULL_POOL_MAX,
  queryTextOf,
  redactIdentity,
  RETRIEVAL_LIMIT,
  ROLE_DEFINITION_MAX,
  ROLE_DEFINITION_QUERY_TERMS,
  roleDefinitionPrompt,
  TEXT_QUERY_MAX_TERMS,
  textQueryOf,
  type AssessmentProfile,
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

  it("keeps the other criteria ahead of the role, whose definition lends its first terms before the title and the rest after", () => {
    const definition = Array.from({ length: 60 }, (_, index) => `mission${index}`).join(" ");
    const role: BriefCriterion = { id: "r", kind: "role", label: "Business Developer", value: definition, required: true, weight: 3 };
    const terms = textQueryOf({ ...brief, criteria: [role, ...criteria] }).split(" OR ");
    expect(terms).toHaveLength(TEXT_QUERY_MAX_TERMS);
    // The skill and the language the brief asks for make the query although the role is saved first.
    expect(terms.slice(0, 4)).toEqual(["controle", "gestion", "anglais", "courant"]);
    expect(terms.slice(4, 6)).toEqual(["business", "developer"]);
    expect(terms.indexOf("mission0")).toBe(6);
    expect(terms.indexOf(`mission${ROLE_DEFINITION_QUERY_TERMS - 1}`)).toBeLessThan(terms.indexOf("controleur"));
    expect(terms.indexOf("lyon")).toBeLessThan(terms.indexOf(`mission${ROLE_DEFINITION_QUERY_TERMS}`));
    expect(terms).toContain("mois");
    expect(terms).not.toContain("mission59");
    expect(ROLE_DEFINITION_QUERY_TERMS).toBe(12);
  });
});

describe("prompts", () => {
  it("say the rules once", () => {
    const system = extractionSystemPrompt();
    expect(system).toContain('"criteria"');
    expect(system).toContain("protected characteristic");
    expect(system).toContain("At most 12");
    expect(extractionUserPrompt({ title: " T ", description: "" })).toBe("Title: T\n\nBrief:\n(no description)");
    const assessment = assessmentSystemPrompt();
    expect(assessment).toContain("senior recruitment consultant");
    expect(assessment).toContain('"unknown", not "no"');
    expect(assessment).toContain("never invented");
    expect(assessment).toContain("dated experiences");
    expect(assessment).toContain("No praise");
    expect(assessment).toContain("protected characteristic");
    expect(assessment).toContain("The team reviews your reading and decides");
  });

  it("ask for the role first: the extraction opens with it, the assessment judges it before anything else", () => {
    const system = extractionSystemPrompt();
    expect(system).toContain('"kind":"role|skill|');
    expect(system).toContain("The FIRST criterion is always the role, exactly one");
    expect(system).toContain(`up to ${ROLE_DEFINITION_MAX} characters`);
    expect(system).toContain("equivalent titles");
    expect(ROLE_DEFINITION_MAX).toBe(600);
    const assessment = assessmentSystemPrompt();
    expect(assessment).toContain("The role comes first.");
    expect(assessment).toContain("Judge what the person DID");
    expect(assessment).toContain("every company names a job differently");
    expect(assessment).toContain('met "unknown" only when the profile holds no experience at all');
    expect(assessment).toContain('a role at "no" is "no_fit" whatever the rest');
    expect(assessment).toContain('A role at "partial" is at most "borderline"');
    expect(assessment).toContain("The first sentence says whether the candidate's métier is the role");
  });

  it("write the role's definition from the job as it is in the market, in words the guard lets through", () => {
    // "Famille de métiers" would read as a family situation to the wider guard; the definition names the job's domain instead.
    for (const system of [extractionSystemPrompt(), roleDefinitionPrompt({ title: "T", description: "" }).system]) {
      expect(system).toContain("the domain of the job");
      expect(system).not.toContain("job family");
      expect(system).toContain('not "family" or "famille"');
      expect(system).toContain("from what this job is in the market");
    }
    // The extraction's "nothing the brief does not say" makes the role definition its one exception.
    expect(extractionSystemPrompt()).toContain("except the role definition, which you write from your knowledge of the job");
  });

  it("make the role the exception to the silence rule, judge it on the career as a whole, and ask for it as the first entry", () => {
    const assessment = assessmentSystemPrompt();
    // A career of other missions is a "no" with those missions as evidence, never an "unknown".
    expect(assessment).toContain("a CV full of other missions is not silence");
    expect(assessment).toContain('a "no" without evidence is not accepted');
    expect(assessment).toContain("Silence is never a lack for the other requirements (the role has its own rule above)");
    expect(assessment).toContain('"unknown", not "no"');
    // Recency, duration, side missions; titles without a description; managers of the job; the sector.
    expect(assessment).toContain("most recent positions and on those held longest");
    expect(assessment).toContain("a side task of another job");
    expect(assessment).toContain("a comptable général keeps the books");
    expect(assessment).toContain("When a position carries no description, read its title");
    expect(assessment).toContain("examples, not a closed list");
    expect(assessment).toContain("led, not done");
    expect(assessment).toContain("narrows the role only when the brief insists on it");
    // The role travels apart in the payload, so the answer's shape is spelled out.
    expect(assessment).toContain('Answer the role as the FIRST entry of "requirements", with "criterionId" equal to brief.role.id');
    expect(assessment).toContain("before how the positions were titled");
    expect(assessment).not.toContain("never how the positions were titled");
  });

  it("derive the role of a brief written before the role existed with the title and the text", () => {
    const prompt = roleDefinitionPrompt({ title: " Business Developer ", description: "Conquête de nouveaux comptes." });
    expect(prompt.system).toContain('{"label":"...","value":"..."}');
    expect(prompt.system).toContain("the job title as the brief names it");
    expect(prompt.system).toContain("equivalent titles");
    expect(prompt.system).toContain("never a protected characteristic");
    expect(prompt.user).toBe("Title: Business Developer\n\nBrief:\nConquête de nouveaux comptes.");
  });

  it("reads the whole pool up to 200 candidates, else 120 retrieved rows", () => {
    expect(FULL_POOL_MAX).toBe(200);
    expect(RETRIEVAL_LIMIT).toBe(120);
  });
});

function profile(partial: Partial<AssessmentProfile> = {}): AssessmentProfile {
  return {
    id: partial.id ?? "c1",
    full_name: partial.full_name === undefined ? "Jean Dupont" : partial.full_name,
    headline: partial.headline ?? "Contrôleur de gestion",
    summary: partial.summary ?? "s".repeat(1000),
    skills: partial.skills ?? ["SAP", " ", "Excel"],
    languages: partial.languages ?? [{ name: "Anglais", level: "C1" }, { name: "", level: null }],
    location: partial.location ?? "Lyon",
    years_experience: partial.years_experience ?? 7,
    availability: partial.availability ?? null,
    education: partial.education ?? [{ degree: "Master CCA", school: "IAE", year: null }],
    experiences: partial.experiences ?? [
      { title: "Contrôleur de gestion", company: "Acme", start: "2019-01", end: null, description: "d".repeat(900) },
      { title: "", company: null, start: null, end: null, description: null },
    ],
    // An explicit null stays null: `??` would put the text back.
    search_text:
      partial.search_text === undefined ? "Jean Dupont jean.dupont@example.com 06 12 34 56 78 contrôleur de gestion" : partial.search_text,
  };
}

describe("assessmentPayload", () => {
  it("sends the brief's requirements and a structured profile with its dated experiences, clipped", () => {
    const payload = assessmentPayload(brief, profile());
    expect(payload.brief.title).toBe(brief.title);
    // A brief analysed before the role existed: no role, the requirements alone.
    expect(payload.brief.role).toBeNull();
    expect(payload.brief.requirements).toEqual([
      { id: "a", label: "Contrôle de gestion", value: "contrôle de gestion", required: true, weight: 3 },
      { id: "b", label: "Anglais courant", value: "anglais B2", required: false, weight: 2 },
    ]);
    expect(payload.candidate.summary).toHaveLength(600);
    expect(payload.candidate.skills).toEqual(["SAP", "Excel"]);
    expect(payload.candidate.languages).toEqual(["Anglais (C1)"]);
    expect(payload.candidate.education).toEqual(["Master CCA — IAE"]);
    expect(payload.candidate.yearsExperience).toBe(7);
    expect(payload.candidate.experiences).toHaveLength(1);
    expect(payload.candidate.experiences[0]).toMatchObject({ title: "Contrôleur de gestion", company: "Acme", start: "2019-01", end: null });
    expect(payload.candidate.experiences[0]?.description).toHaveLength(500);
  });

  it("names the role first and apart from the other requirements, wherever the brief keeps it", () => {
    const role: BriefCriterion = { id: "r", kind: "role", label: "Contrôleur de gestion", value: "Finance : budgets, reporting…", required: true, weight: 3 };
    const payload = assessmentPayload({ ...brief, criteria: [...criteria, role] }, profile());
    expect(Object.keys(payload.brief)).toEqual(["title", "description", "role", "requirements"]);
    expect(payload.brief.role).toEqual({ id: "r", label: "Contrôleur de gestion", definition: "Finance : budgets, reporting…" });
    expect(payload.brief.requirements.map((requirement) => requirement.id)).toEqual(["a", "b"]);
  });

  it("never carries the candidate's id, name, email or phone: only the CV's text as the processor indexed it", () => {
    const payload = assessmentPayload(brief, profile({ id: "cand-9f3a", search_text: "contrôleur de gestion chez Acme" }));
    const json = JSON.stringify(payload);
    expect(json).not.toContain("cand-9f3a");
    expect(json).not.toContain("full_name");
    expect(json).not.toContain("email");
    expect(json).not.toContain("phone");
    expect(json).not.toContain("org_id");
    expect(Object.keys(payload.candidate)).toEqual([
      "headline",
      "summary",
      "skills",
      "languages",
      "location",
      "yearsExperience",
      "availability",
      "experiences",
      "education",
      "extra",
    ]);
    expect(payload.candidate.extra).toBe("contrôleur de gestion chez Acme");
  });

  it("strips the name, the e-mail and the phone out of every text, the CV's indexed text included", () => {
    // The default fixture's text starts with the name and the contact details, as the processor writes it.
    const payload = assessmentPayload(
      brief,
      profile({
        headline: "Jean Dupont, contrôleur de gestion",
        summary: "Jean Dupont est contrôleur de gestion ; Jean a sept ans d'expérience.",
        experiences: [
          {
            title: "Contrôleur de gestion",
            company: "Cabinet DUPONT",
            start: "2019-01",
            end: null,
            description: "Reporting mensuel. Contact : jean.dupont@example.com",
          },
        ],
      }),
    );
    const json = JSON.stringify(payload);
    expect(json).not.toContain("Jean");
    expect(json).not.toContain("Dupont");
    expect(json).not.toContain("DUPONT");
    expect(json).not.toContain("jean.dupont@example.com");
    expect(json).not.toContain("06 12 34 56 78");
    expect(payload.candidate.headline).toBe(", contrôleur de gestion");
    expect(payload.candidate.summary).toBe("est contrôleur de gestion ; a sept ans d'expérience.");
    expect(payload.candidate.experiences[0]?.company).toBe("Cabinet");
    expect(payload.candidate.experiences[0]?.description).toBe("Reporting mensuel. Contact :");
    expect(payload.candidate.extra).toBe("contrôleur de gestion");
    // Without a name on the row, the contact details still go.
    const nameless = assessmentPayload(brief, profile({ full_name: null }));
    expect(nameless.candidate.extra).toBe("Jean Dupont contrôleur de gestion");
  });

  it("clips the description to 4000, the experiences to 12, and the CV text to what keeps the payload under the budget", () => {
    const many = Array.from({ length: 20 }, (_, index) => ({
      title: `Poste ${index}`,
      company: null,
      start: null,
      end: null,
      description: null,
    }));
    const payload = assessmentPayload(
      { ...brief, description: "x".repeat(10_000) },
      profile({ experiences: many, search_text: "t".repeat(20_000) }),
    );
    expect(payload.brief.description).toHaveLength(4000);
    expect(payload.candidate.experiences).toHaveLength(12);
    expect(payload.candidate.extra?.length ?? 0).toBeGreaterThan(0);
    expect(JSON.stringify(payload).length).toBeLessThanOrEqual(ASSESSMENT_PAYLOAD_MAX);
  });

  it("redacts before it clips, so no name survives at the edge of a clip", () => {
    const payload = assessmentPayload(brief, profile({ summary: `${"s".repeat(595)} Jean Dupont ${"t".repeat(100)}` }));
    expect(payload.candidate.summary).toHaveLength(600);
    expect(payload.candidate.summary).not.toContain("Jean");
    expect(payload.candidate.summary).not.toContain("Dup");
  });

  it("leaves the CV text out when the structured part already fills the budget", () => {
    const heavy = Array.from({ length: 12 }, (_, index) => ({
      title: `Poste ${index}`,
      company: "Acme",
      start: "2010-01",
      end: "2011-01",
      description: "d".repeat(500),
    }));
    const payload = assessmentPayload({ ...brief, description: "x".repeat(4000) }, profile({ experiences: heavy }));
    expect(payload.candidate.extra).toBeNull();
    expect(assessmentPayload(brief, profile({ search_text: null })).candidate.extra).toBeNull();
  });
});

describe("redactIdentity", () => {
  it("removes the name whatever its case or order, and its parts of three letters or more", () => {
    expect(redactIdentity("JEAN DUPONT\nDupont Jean\nJean est contrôleur chez Acme", "Jean Dupont")).toBe("est contrôleur chez Acme");
    expect(redactIdentity("Jean-Pierre Martin, dit Jean-Pierre", " Jean-Pierre Martin ")).toBe(", dit");
    // Two-letter parts stay as words (they are everywhere), the whole name still goes.
    expect(redactIdentity("Li Wu\nli wu works at Li & Fung", "Li Wu")).toBe("works at Li & Fung");
    // A name inside a longer word is left alone.
    expect(redactIdentity("Dupontel", "Jean Dupont")).toBe("Dupontel");
  });

  it("masks e-mails and phone numbers, keeps date ranges and short figures", () => {
    expect(redactIdentity("Contact : jean.dupont@example.com ou 06 12 34 56 78 / +33 (0)6 12 34 56 78", null)).toBe("Contact : ou /");
    expect(redactIdentity("0612345678", null)).toBe("");
    expect(redactIdentity("Contrôleur de gestion, 2019-01 - 2021-06 puis 2021-2024 ; budget 1 500 000 €", null)).toBe(
      "Contrôleur de gestion, 2019-01 - 2021-06 puis 2021-2024 ; budget 1 500 000 €",
    );
  });

  it("leaves a text without identity alone", () => {
    expect(redactIdentity("SAP FI/CO, Excel 2016, SQL", null)).toBe("SAP FI/CO, Excel 2016, SQL");
    expect(redactIdentity("SAP FI/CO", "  ")).toBe("SAP FI/CO");
    expect(redactIdentity("ligne 1\n\nligne 2", undefined)).toBe("ligne 1\nligne 2");
  });
});
