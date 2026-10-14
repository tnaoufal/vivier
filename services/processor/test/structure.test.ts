import { describe, expect, it } from "vitest";

import {
  MAX_SKILLS,
  ModelProfileSchema,
  STRUCTURE_SYSTEM_PROMPT,
  anchorOrganisationOf,
  backfillContacts,
  classificationOfModelAnswer,
  embeddingTextOf,
  emptyProfile,
  findName,
  findPhone,
  fingerprintOf,
  heuristicProfile,
  mergeProfiles,
  nameFromFileName,
  normaliseDate,
  normaliseName,
  normaliseSkill,
  profileOfModelAnswer,
  searchTextOf,
  type Profile,
} from "../src/structure.js";

const SAMPLE_CV = `Marie Dupont
Contrôleuse de gestion senior
Paris, France
marie.dupont@example.com | +33 6 12 34 56 78
linkedin.com/in/mariedupont

Expérience
2019 - 2024 Contrôleuse de gestion, Groupe Alpha, Paris
Pilotage budgétaire, reporting mensuel, SAP et Excel.
2015 - 2019 Analyste financière, Beta Conseil

Formation
2015 Master Contrôle de gestion, Université Paris-Dauphine

Langues
Anglais C1, Espagnol B2`;

function profile(overrides: Partial<Profile> = {}): Profile {
  return { ...emptyProfile(), ...overrides };
}

function experience(company: string | null): Profile["experiences"][number] {
  return { title: "Contrôleuse de gestion", company, start: "2019", end: null, description: null };
}

describe("heuristicProfile", () => {
  it("reads the email, the phone and the name with low confidence, nothing else", () => {
    const result = heuristicProfile(SAMPLE_CV, "cv.pdf");
    expect(result.email).toBe("marie.dupont@example.com");
    expect(result.phone).toBe("+33 6 12 34 56 78");
    expect(result.full_name).toBe("Marie Dupont");
    expect(result.confidence).toEqual({ email: 0.9, phone: 0.6, full_name: 0.3 });
    expect(result.headline).toBeNull();
    expect(result.summary).toBeNull();
    expect(result.skills).toEqual([]);
    expect(result.experiences).toEqual([]);
  });

  it("falls back to the file name when no line looks like a name", () => {
    const text = "CURRICULUM VITAE\nEmail : jp.martin@example.org\nTél : 06 11 22 33 44\n2019 - 2021 Vendeur";
    const result = heuristicProfile(text, "CV_Jean-Pierre_Martin.pdf");
    expect(result.full_name).toBe("Jean Pierre Martin");
    expect(result.phone).toBe("06 11 22 33 44");
    expect(result.confidence.full_name).toBe(0.3);
    expect(nameFromFileName("resume.pdf")).toBeNull();
  });

  it("does not take a year range or a short number for a phone", () => {
    expect(findPhone("Expérience 2019 - 2021 2023 chez X")).toBeNull();
    expect(findPhone("Code postal 75011")).toBeNull();
    expect(findPhone("Tél. 0033 6 12 34 56 78")).toBe("+33 6 12 34 56 78");
    expect(findPhone("Mobile: 06.12.34.56.78")).toBe("06 12 34 56 78");
  });

  it("skips lines with digits, @ or header words when looking for the name", () => {
    expect(findName("Curriculum vitae\nContact details\nAnne Marie Leroy\n")).toBe("Anne Marie Leroy");
    expect(findName("Paris 2024\nanne@example.com\n")).toBeNull();
  });
});

describe("fingerprintOf", () => {
  it("prefers the email, lowercased", () => {
    expect(fingerprintOf(profile({ email: " Marie.Dupont@Example.com " }))).toBe("marie.dupont@example.com");
  });

  it("falls back to the normalised name and the phone digits", () => {
    expect(
      fingerprintOf(profile({ full_name: "Émilie Durand-Le Gall", phone: "+33 6 12 34 56 78" })),
    ).toBe("emilie durand le gall|33612345678");
    expect(normaliseName("  Émilie   DURAND ")).toBe("emilie durand");
  });

  it("falls back to the name and the latest company, else the first school", () => {
    const alpha = profile({ full_name: "Marie Dupont", experiences: [experience("Groupe Alpha")] });
    expect(anchorOrganisationOf(alpha)).toBe("groupe alpha");
    expect(fingerprintOf(alpha)).toBe("marie dupont|groupe alpha");
    const school = profile({
      full_name: "Marie Dupont",
      experiences: [experience(null)],
      education: [{ degree: "Master", school: "Université Paris-Dauphine", year: "2015" }],
    });
    expect(fingerprintOf(school)).toBe("marie dupont|universite paris dauphine");
    const withPhone = profile({ ...alpha, phone: "06 12 34 56 78" });
    expect(fingerprintOf(withPhone)).toBe("marie dupont|0612345678");
    const withEmail = profile({ ...withPhone, email: "marie@example.com" });
    expect(fingerprintOf(withEmail)).toBe("marie@example.com");
  });

  it("never makes a key from a name alone, and keeps namesakes at different companies apart", () => {
    expect(fingerprintOf(profile({ full_name: "Marie Dupont" }))).toBeNull();
    expect(fingerprintOf(profile({ phone: "06 12 34 56 78" }))).toBeNull();
    expect(fingerprintOf(profile({ experiences: [experience("Groupe Alpha")] }))).toBeNull();
    expect(fingerprintOf(profile())).toBeNull();
    const alpha = fingerprintOf(profile({ full_name: "Marie Dupont", experiences: [experience("Groupe Alpha")] }));
    const beta = fingerprintOf(profile({ full_name: "Marie Dupont", experiences: [experience("Beta Conseil")] }));
    expect(alpha).not.toBeNull();
    expect(beta).not.toBeNull();
    expect(alpha).not.toBe(beta);
  });
});

describe("searchTextOf and embeddingTextOf", () => {
  const full = profile({
    full_name: "Marie Dupont",
    email: "marie.dupont@example.com",
    headline: "Contrôleuse de gestion senior",
    location: "Paris",
    summary: "Dix ans de contrôle de gestion.",
    skills: ["SQL", "excel"],
    languages: [{ name: "Anglais", level: "C1" }],
    experiences: [
      { title: "Contrôleuse de gestion", company: "Groupe Alpha", start: "2019", end: null, description: "Reporting mensuel." },
    ],
    education: [{ degree: "Master Contrôle de gestion", school: "Dauphine", year: "2015" }],
    tags: ["sql"],
  });

  it("joins every part once, one per line, without the contact details", () => {
    const text = searchTextOf(full);
    const lines = text.split("\n");
    expect(lines).toContain("Marie Dupont");
    expect(lines).toContain("Groupe Alpha");
    expect(lines).toContain("Dauphine");
    expect(lines).toContain("Anglais");
    expect(lines.filter((line) => line.toLowerCase() === "sql")).toHaveLength(1);
    expect(text).not.toContain("marie.dupont@example.com");
  });

  it("keeps the embedding text compact", () => {
    const text = embeddingTextOf(full);
    expect(text).toContain("Contrôleuse de gestion senior");
    expect(text).toContain("Skills: SQL, excel");
    expect(text).toContain("Contrôleuse de gestion — Groupe Alpha");
    expect(text.length).toBeLessThanOrEqual(4000);
    expect(embeddingTextOf(profile())).toBe("");
  });
});

describe("mergeProfiles", () => {
  const existing = profile({
    full_name: "Marie Dupont",
    headline: null,
    summary: "Ancien résumé.",
    skills: ["SQL", "excel"],
    tags: ["finance"],
    experiences: [{ title: "Analyste", company: "Beta", start: "2015", end: "2019", description: null }],
    confidence: { full_name: 0.3, summary: 0.5, experiences: 0.4 },
  });

  it("keeps a value unless it is empty or the new reading is sure and at least as sure", () => {
    const incoming = profile({
      full_name: "Marie Dupont-Martin",
      headline: "Contrôleuse de gestion",
      summary: "Nouveau résumé.",
      confidence: { full_name: 0.6, headline: 0.9, summary: 0.95 },
    });
    const merged = mergeProfiles(existing, incoming);
    expect(merged.full_name).toBe("Marie Dupont");
    expect(merged.headline).toBe("Contrôleuse de gestion");
    expect(merged.summary).toBe("Nouveau résumé.");
    expect(merged.confidence).toEqual({ full_name: 0.6, headline: 0.9, summary: 0.95, experiences: 0.4 });
  });

  it("replaces a sure value with a surer one and never with a null", () => {
    const sure = mergeProfiles(existing, profile({ full_name: "Marie Dupont-Martin", confidence: { full_name: 0.9 } }));
    expect(sure.full_name).toBe("Marie Dupont-Martin");
    const empty = mergeProfiles(existing, profile({ confidence: { full_name: 1 } }));
    expect(empty.full_name).toBe("Marie Dupont");
  });

  it("keeps a long list an existing candidate holds: the merge unions, it never trims", () => {
    const long = Array.from({ length: 60 }, (_, i) => `skill ${i}`);
    const merged = mergeProfiles(profile({ skills: long }), profile({ skills: ["skill 1", "new skill"] }));
    expect(merged.skills).toHaveLength(61);
    expect(merged.skills[0]).toBe("skill 0");
    expect(merged.skills[60]).toBe("new skill");
  });

  it("unions skills and tags case-insensitively and replaces lists when the new ones are at least as sure", () => {
    const incoming = profile({
      skills: ["sql", "Power BI"],
      tags: ["Finance", "paris"],
      experiences: [{ title: "Contrôleuse", company: "Alpha", start: "2019", end: null, description: null }],
      confidence: { experiences: 0.4 },
    });
    const merged = mergeProfiles(existing, incoming);
    expect(merged.skills).toEqual(["SQL", "excel", "Power BI"]);
    expect(merged.tags).toEqual(["finance", "paris"]);
    expect(merged.experiences.map((e) => e.title)).toEqual(["Contrôleuse"]);
    const lessSure = mergeProfiles(existing, { ...incoming, confidence: { experiences: 0.2 } });
    expect(lessSure.experiences.map((e) => e.title)).toEqual(["Analyste"]);
    const nothing = mergeProfiles(existing, profile({ confidence: { experiences: 1 } }));
    expect(nothing.experiences.map((e) => e.title)).toEqual(["Analyste"]);
  });
});

describe("ModelProfileSchema", () => {
  it("accepts a valid answer and normalises it", () => {
    const result = ModelProfileSchema.safeParse({
      full_name: "  Marie Dupont ",
      email: null,
      phone: "+33 6 12 34 56 78",
      headline: "Contrôleuse de gestion senior",
      location: "Paris",
      years_experience: "9,5",
      availability: null,
      summary: "Contrôleuse de gestion depuis 2015.",
      skills: ["Gestion De Projet", "SQL", "sql", "Excel", "C++"],
      languages: [{ name: "Anglais", level: "C1" }, "Espagnol", { name: "anglais", level: "B2" }],
      experiences: [
        { title: "Contrôleuse de gestion", company: "Groupe Alpha", start: "2019-03-01", end: "present", description: "Reporting." },
        { company: "Sans titre" },
      ],
      education: [{ degree: "Master", school: "Dauphine", year: 2015 }],
      links: [{ label: "LinkedIn", url: "linkedin.com/in/mariedupont" }, "https://example.org", "not a url"],
      tags: [],
      confidence: { full_name: 0.98, skills: 1.4, age: 1, experiences: "0.8" },
    });
    expect(result.success).toBe(true);
    if (!result.success) return;
    const value = profileOfModelAnswer(result.data);
    expect(value.full_name).toBe("Marie Dupont");
    expect(value.email).toBeNull();
    expect(value.years_experience).toBe(9.5);
    expect(value.skills).toEqual(["gestion de projet", "SQL", "excel", "C++"]);
    expect(value.languages).toEqual([
      { name: "Anglais", level: "C1" },
      { name: "Espagnol", level: null },
    ]);
    expect(value.experiences).toEqual([
      { title: "Contrôleuse de gestion", company: "Groupe Alpha", start: "2019-03", end: null, description: "Reporting." },
    ]);
    expect(value.education).toEqual([{ degree: "Master", school: "Dauphine", year: "2015" }]);
    expect(value.links).toEqual([
      { label: "LinkedIn", url: "https://linkedin.com/in/mariedupont" },
      { label: "example.org", url: "https://example.org" },
    ]);
    expect(value.confidence).toEqual({ full_name: 0.98, skills: 1, experiences: 0.8 });
  });

  it("fills missing fields with null or empty lists", () => {
    const result = ModelProfileSchema.safeParse({});
    expect(result.success).toBe(true);
    if (!result.success) return;
    expect(result.data.full_name).toBeNull();
    expect(result.data.skills).toEqual([]);
    expect(result.data.confidence).toEqual({});
  });

  it("reads the document kind, and takes anything but an explicit \"other\" for a CV", () => {
    const other = ModelProfileSchema.safeParse({ document_kind: " Other ", kind_reason: "  A diploma, no experiences. " });
    expect(other.success).toBe(true);
    if (other.success) {
      expect(classificationOfModelAnswer(other.data)).toEqual({ kind: "other", reason: "A diploma, no experiences." });
    }
    for (const value of [{ document_kind: "cv" }, { document_kind: "CV" }, {}, { document_kind: 42 }, { document_kind: null }]) {
      const result = ModelProfileSchema.safeParse(value);
      expect(result.success).toBe(true);
      if (result.success) expect(classificationOfModelAnswer(result.data)).toEqual({ kind: "cv", reason: null });
    }
    expect(STRUCTURE_SYSTEM_PROMPT).toContain('"document_kind"');
    expect(STRUCTURE_SYSTEM_PROMPT).toContain('"kind_reason"');
  });

  it("keeps the first 24 skills, the most central, and asks the model for a recruiter's list", () => {
    const skills = Array.from({ length: 40 }, (_, i) => `skill ${i}`);
    const result = ModelProfileSchema.safeParse({ skills });
    expect(result.success).toBe(true);
    if (!result.success) return;
    expect(MAX_SKILLS).toBe(24);
    expect(result.data.skills).toHaveLength(MAX_SKILLS);
    expect(result.data.skills[0]).toBe("skill 0");
    expect(result.data.skills[23]).toBe("skill 23");
    expect(STRUCTURE_SYSTEM_PROMPT).toContain("8 to 20 skills");
    expect(STRUCTURE_SYSTEM_PROMPT).toContain("from the most central to the least");
    expect(STRUCTURE_SYSTEM_PROMPT).toContain("Never document names");
    expect(STRUCTURE_SYSTEM_PROMPT).toContain('"communication"');
  });

  it("rejects an answer of the wrong shape", () => {
    expect(ModelProfileSchema.safeParse([]).success).toBe(false);
    expect(ModelProfileSchema.safeParse({ skills: "python, sql" }).success).toBe(false);
    expect(ModelProfileSchema.safeParse({ full_name: { first: "Marie" } }).success).toBe(false);
    expect(ModelProfileSchema.safeParse({ confidence: [0.5] }).success).toBe(false);
  });
});

describe("normalisers", () => {
  it("normalises dates to YYYY-MM or YYYY", () => {
    expect(normaliseDate("2019-03-15")).toBe("2019-03");
    expect(normaliseDate("03/2019")).toBe("2019-03");
    expect(normaliseDate("2021")).toBe("2021");
    expect(normaliseDate("mars 2020")).toBe("2020");
    expect(normaliseDate("present")).toBeNull();
    expect(normaliseDate("aujourd'hui")).toBeNull();
    expect(normaliseDate("")).toBeNull();
    expect(normaliseDate("1200")).toBeNull();
  });

  it("lowercases skills except acronyms", () => {
    expect(normaliseSkill("Gestion De Projet")).toBe("gestion de projet");
    expect(normaliseSkill("SQL")).toBe("SQL");
    expect(normaliseSkill("AWS Lambda")).toBe("AWS lambda");
    expect(normaliseSkill("   ")).toBeNull();
  });

  it("backfills an email or a phone the model left out when a regex found it", () => {
    const model = profile({ full_name: "Marie Dupont", confidence: { full_name: 0.9 } });
    const heuristic = heuristicProfile(SAMPLE_CV, "cv.pdf");
    const filled = backfillContacts(model, heuristic);
    expect(filled.email).toBe("marie.dupont@example.com");
    expect(filled.phone).toBe("+33 6 12 34 56 78");
    expect(filled.confidence).toEqual({ full_name: 0.9, email: 0.9, phone: 0.6 });
    expect(model.email).toBeNull();
  });
});
