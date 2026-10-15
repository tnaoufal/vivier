import { describe, expect, it } from "vitest";

import {
  compareKept,
  enforceScreen,
  PROMOTE_MAX,
  promotable,
  rankKept,
  SCREEN_BATCH_MAX,
  SCREEN_REASON_MAX,
  SCREEN_REASON_WORDS,
  SCREEN_SKILLS_MAX,
  screenCard,
  screenEntries,
  screenPayload,
  screenRequirements,
  screenRoleBrief,
  screenSystemPrompt,
  type KeptRow,
} from "./screen.js";
import type { BriefCriterion, RoleProfile, TriageProfile } from "./types.js";

function profile(id: string, extra: Partial<TriageProfile> = {}): TriageProfile {
  return {
    id,
    full_name: null,
    location: null,
    headline: null,
    years_experience: null,
    experiences: [],
    education: [],
    skills: [],
    ...extra,
  };
}

const roleProfile: RoleProfile = {
  title: "Business Developer",
  domain: "Développement commercial B2B",
  seniority: "confirmed",
  yearsMin: 3,
  yearsMax: null,
  missions: ["Prospecter", "Négocier", "Signer"],
  equivalentTitles: ["Account Executive"],
  adjacentProfiles: ["Account manager : fidélise"],
  context: { sector: "SaaS", product: null, clients: "PME", scope: null },
  mustHaves: ["Anglais courant"],
  niceToHaves: [],
  successFactors: ["Ténacité"],
  questions: [],
  assumptions: [],
  model: "m",
  createdAt: "2026-10-15T00:00:00Z",
};

const criteria: BriefCriterion[] = [
  { id: "r", kind: "role", label: "Business Developer", value: "def", required: true, weight: 3 },
  {
    id: "l",
    kind: "language",
    label: "Anglais courant",
    value: "anglais B2",
    required: true,
    weight: 2,
  },
  { id: "s", kind: "skill", label: "Salesforce", value: "salesforce", required: false, weight: 1 },
];

const rich = profile("p1", {
  full_name: "Camille Durand",
  location: "Lyon, France",
  headline: "Business Developer Lyon",
  years_experience: 6.44,
  experiences: [
    { title: "Business Developer", company: "Acme", start: "2021-03", end: null, description: "x" },
    { title: "SDR", company: "Beta Lyon", start: "2019", end: "2021", description: null },
    { title: "", company: "Gamma", start: null, end: "2018", description: null },
  ],
  education: [{ degree: "Master Vente", school: "IAE Lyon", year: "2018" }],
  skills: Array.from({ length: 15 }, (_, index) => `skill ${index + 1}`),
});

describe("screenCard", () => {
  it("is the triage card with its positions as lines, the years and the first skills always on it, the name and the place taken out", () => {
    const card = screenCard(rich, "c1");
    expect(card).toEqual({
      ref: "c1",
      headline: "Business Developer",
      current: "Business Developer | Acme | since 2021-03",
      previous: ["SDR | Beta | 2019 - 2021", "Gamma | ? - 2018"],
      years: 6.4,
      education: "Master Vente — IAE",
      skills: Array.from({ length: SCREEN_SKILLS_MAX }, (_, index) => `skill ${index + 1}`),
    });
    const json = JSON.stringify(card);
    for (const word of ["Camille", "Durand", "Lyon", "France", "2018 "])
      expect(json).not.toContain(word);
    expect(SCREEN_SKILLS_MAX).toBe(12);
  });

  it("leaves every field of a bare card empty, never invented", () => {
    expect(screenCard(profile("p2"), "c2")).toEqual({
      ref: "c2",
      headline: null,
      current: null,
      previous: [],
      years: null,
      education: null,
      skills: [],
    });
  });

  it("names the cards c1..cN in the order given", () => {
    const entries = screenEntries([profile("b"), profile("a")]);
    expect(entries.map((entry) => entry.candidateId)).toEqual(["b", "a"]);
    expect(entries.map((entry) => entry.card.ref)).toEqual(["c1", "c2"]);
  });
});

describe("the job and the requirements the screening reads", () => {
  it("adds the years asked and the context of the role profile to the triage's reading of the job", () => {
    const role = screenRoleBrief({ title: "BizDev", criteria, role_profile: roleProfile });
    expect(role.title).toBe("Business Developer");
    expect(role.seniority).toBe("confirmed");
    expect(role.yearsMin).toBe(3);
    expect(role.yearsMax).toBeNull();
    expect(role.mustHaves).toEqual(["Anglais courant"]);
    expect(role.definition).toBeNull();
    expect(role.context).toEqual({ sector: "SaaS", product: null, clients: "PME", scope: null });
    // A copy: the payload never shares the profile's object.
    expect(role.context).not.toBe(roleProfile.context);
  });

  it("reads the role criterion and the brief's title without a profile, the years and the context unknown", () => {
    const role = screenRoleBrief({ title: "BizDev", criteria, role_profile: null });
    expect(role.title).toBe("Business Developer");
    expect(role.equivalentTitles).toEqual(["BizDev"]);
    expect(role.definition).toBe("def");
    expect(role.seniority).toBeNull();
    expect(role.yearsMin).toBeNull();
    expect(role.yearsMax).toBeNull();
    expect(role.context).toBeNull();
  });

  it("lists the requirements other than the role, in order, with their weight", () => {
    expect(screenRequirements(criteria)).toEqual([
      { label: "Anglais courant", value: "anglais B2", required: true, weight: 2 },
      { label: "Salesforce", value: "salesforce", required: false, weight: 1 },
    ]);
    expect(screenRequirements([])).toEqual([]);
  });

  it("builds a payload that carries the job, the requirements and the cards, never an id, a name or a contact", () => {
    const role = screenRoleBrief({ title: "BizDev", criteria, role_profile: roleProfile });
    const card = screenCard(rich, "c1");
    const payload = screenPayload(role, screenRequirements(criteria), [card]);
    expect(payload.role).toBe(role);
    expect(payload.requirements).toHaveLength(2);
    expect(payload.cards).toEqual([card]);
    const json = JSON.stringify(payload);
    for (const word of [
      "candidateId",
      "full_name",
      "email",
      "phone",
      "p1",
      "Camille",
      "Durand",
      "Lyon",
    ])
      expect(json).not.toContain(word);
  });

  it("asks for one score per card, the seniority weighed most, twelve words of reason, silence never a lack", () => {
    const system = screenSystemPrompt();
    expect(system).toContain('{"scores":[{"ref":"c1","score":0,"reason":"..."}]}');
    expect(system).toContain("exactly one entry per card");
    expect(system).toContain("Weigh the seniority most");
    expect(system).toContain("silence is never a lack");
    expect(system).toContain(`at most ${SCREEN_REASON_WORDS} words`);
    expect(system).toContain("Never use, infer or mention age");
    expect(system).toContain("never a career break");
    expect(SCREEN_REASON_WORDS).toBe(12);
    expect(SCREEN_BATCH_MAX).toBe(25);
    expect(SCREEN_REASON_MAX).toBe(80);
  });
});

describe("enforceScreen", () => {
  const entries = screenEntries([profile("a"), profile("b"), profile("c"), profile("d")]);

  it("keeps a score in 0..100 rounded, a null for anything else, the first answer per card, and ignores a ref no card carries", () => {
    const out = enforceScreen(entries, {
      scores: [
        { ref: "c1", score: 87.4, reason: "  Poste tenu   depuis 2021 " },
        { ref: " c2 ", score: 120, reason: "x" },
        { ref: "c1", score: 10, reason: "later" },
        { ref: "c9", score: 50, reason: "nobody" },
        { ref: "c3", score: 61, reason: "Mère de deux enfants, poste tenu" },
        { ref: "c4", score: "80" as unknown as number, reason: "r".repeat(100) },
      ],
    });
    expect(out.size).toBe(4);
    expect(out.get("a")).toEqual({ score: 87, reason: "Poste tenu depuis 2021" });
    expect(out.get("b")).toEqual({ score: null, reason: "x" });
    // A reason that names a family situation is withheld; the score stands.
    expect(out.get("c")).toEqual({ score: 61, reason: null });
    expect(out.get("d")).toEqual({ score: null, reason: "r".repeat(SCREEN_REASON_MAX) });
  });

  it("answers a null score and no reason for a card the model left out, and for an answer without a list", () => {
    const silent = enforceScreen(entries, { scores: [] });
    expect([...silent.values()]).toEqual(
      Array.from({ length: 4 }, () => ({ score: null, reason: null })),
    );
    const broken = enforceScreen(entries, { scores: undefined as unknown as [] });
    expect(broken.get("a")).toEqual({ score: null, reason: null });
  });

  it("reads the edges of the range: 100.4 rounds in, 100.5 and a negative score are out, NaN is null", () => {
    const out = enforceScreen(entries, {
      scores: [
        { ref: "c1", score: 100.4 },
        { ref: "c2", score: 100.5 },
        { ref: "c3", score: -1 },
        { ref: "c4", score: Number.NaN },
      ],
    });
    expect(out.get("a")?.score).toBe(100);
    expect(out.get("b")?.score).toBeNull();
    expect(out.get("c")?.score).toBeNull();
    expect(out.get("d")?.score).toBeNull();
  });
});

describe("the order of the kept rows and the promotion", () => {
  const rows: KeptRow[] = [
    { candidate_id: "b", verdict: "close", score: 70 },
    { candidate_id: "a", verdict: "close", score: 70 },
    { candidate_id: "c", verdict: "yes", score: 70 },
    { candidate_id: "d", verdict: "yes", score: null },
    { candidate_id: "e", verdict: "close", score: 90 },
    { candidate_id: "f", verdict: null, score: null },
  ];

  it("ranks by score, nulls last, then yes before close, then the id, and leaves the list given alone", () => {
    expect(rankKept(rows).map((row) => row.candidate_id)).toEqual(["e", "c", "a", "b", "d", "f"]);
    expect(rows[0]?.candidate_id).toBe("b");
    const first = rows[0];
    if (first) expect(compareKept(first, first)).toBe(0);
  });

  it("takes every forced row and the PROMOTE_MAX best of the others", () => {
    const many: KeptRow[] = Array.from({ length: 35 }, (_, index) => ({
      candidate_id: `p${String(index + 1).padStart(2, "0")}`,
      verdict: "close",
      score: 100 - index,
    }));
    const forced: KeptRow = { candidate_id: "zz", verdict: "no", score: null, forced: true };
    const taken = promotable([...many, forced]);
    expect(PROMOTE_MAX).toBe(30);
    expect(taken).toHaveLength(PROMOTE_MAX + 1);
    expect(taken[0]?.candidate_id).toBe("p01");
    expect(taken[taken.length - 1]?.candidate_id).toBe("zz");
    expect(taken.some((row) => row.candidate_id === "p31")).toBe(false);
    expect(promotable(many, 3).map((row) => row.candidate_id)).toEqual(["p01", "p02", "p03"]);
    expect(promotable([], 5)).toEqual([]);
  });
});
