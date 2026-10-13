import { describe, expect, it } from "vitest";

import type { CandidateRow } from "@/lib/db/types";
import { addChips, normalizeChips, parseYears, removeChip, toDraft, toPatch } from "./draft";

const row: CandidateRow = {
  id: "c1",
  org_id: "o1",
  full_name: "Ana Lu",
  email: "Ana@Example.com",
  phone: null,
  headline: "Contrôleuse de gestion",
  location: null,
  years_experience: 6.5,
  availability: null,
  summary: null,
  skills: ["Excel"],
  languages: [{ name: "Anglais", level: "C1" }],
  experiences: [{ title: "Contrôleuse", company: "Acme", start: "2019-03", end: null, description: null }],
  education: [{ degree: "Master CCA", school: null, year: "2018" }],
  links: [{ label: "LinkedIn", url: "https://linkedin.com/in/ana" }],
  tags: [],
  confidence: { full_name: 0.9 },
  source: "upload",
  consent_status: "unknown",
  consent_at: null,
  last_contact_at: null,
  status: "active",
  fingerprint: null,
  search_text: null,
  created_by: null,
  created_at: "2026-10-13T08:00:00Z",
  updated_at: "2026-10-13T08:00:00Z",
};

describe("toDraft", () => {
  it("turns every field into text, nulls into empty strings", () => {
    const draft = toDraft(row);
    expect(draft.phone).toBe("");
    expect(draft.years_experience).toBe("6.5");
    expect(draft.experiences[0]).toEqual({ title: "Contrôleuse", company: "Acme", start: "2019-03", end: "", description: "" });
    expect(draft.education[0]).toEqual({ degree: "Master CCA", school: "", year: "2018" });
  });
});

describe("parseYears", () => {
  it("accepts a decimal with a comma or a dot, within 0..70", () => {
    expect(parseYears("")).toBeNull();
    expect(parseYears(" 3,5 ")).toBe(3.5);
    expect(parseYears("12")).toBe(12);
    expect(parseYears("70")).toBe(70);
    expect(parseYears("71")).toBe("invalid");
    expect(parseYears("abc")).toBe("invalid");
    expect(parseYears("-1")).toBe("invalid");
  });
});

describe("toPatch", () => {
  it("writes null for what is empty and drops empty rows", () => {
    const draft = toDraft(row);
    draft.email = "  Ana@Example.com ";
    draft.experiences.push({ title: "", company: "", start: "", end: "", description: "" });
    draft.links.push({ label: "Site", url: " " });
    draft.languages.push({ name: " ", level: "B2" });
    const result = toPatch(draft);
    if ("invalid" in result) throw new Error("expected a patch");
    expect(result.patch.email).toBe("ana@example.com");
    expect(result.patch.phone).toBeNull();
    expect(result.patch.years_experience).toBe(6.5);
    expect(result.patch.experiences).toHaveLength(1);
    expect(result.patch.links).toEqual([{ label: "LinkedIn", url: "https://linkedin.com/in/ana" }]);
    expect(result.patch.languages).toEqual([{ name: "Anglais", level: "C1" }]);
    expect(Object.keys(result.patch).sort()).toEqual(
      ["availability", "education", "email", "experiences", "full_name", "headline", "languages", "links", "location", "phone", "summary", "years_experience"].sort(),
    );
  });

  it("names an invalid years field instead of guessing", () => {
    const draft = toDraft(row);
    draft.years_experience = "beaucoup";
    expect(toPatch(draft)).toEqual({ invalid: "years_experience" });
  });

  it("labels a link by its url when no label was typed", () => {
    const draft = toDraft({ ...row, links: [] });
    draft.links.push({ label: "", url: "https://x.y" });
    const result = toPatch(draft);
    if ("invalid" in result) throw new Error("expected a patch");
    expect(result.patch.links).toEqual([{ label: "https://x.y", url: "https://x.y" }]);
  });
});

describe("chips", () => {
  it("trims, dedupes without case and splits typed lists", () => {
    expect(normalizeChips([" Excel", "excel", "", "SAP  FI"])).toEqual(["Excel", "SAP FI"]);
    expect(addChips(["Excel"], "Power BI, excel; SQL")).toEqual(["Excel", "Power BI", "SQL"]);
    expect(removeChip(["a", "b"], "a")).toEqual(["b"]);
  });
});
