import { describe, expect, it } from "vitest";

import type { Assessment, AssessmentTier, BriefCriterion, MatchResult } from "./types.js";

import { NOTE_MAX } from "./assessment.js";
import {
  applyRanking,
  RANK_GROUP_MAX,
  RANK_GROUP_MIN,
  rankingPayload,
  rankingSheets,
  rankingSystemPrompt,
  sortByTier,
} from "./ranking.js";

function assessed(
  decision: Assessment["decision"],
  score: number,
  extra: Partial<Assessment> = {},
): Assessment {
  return { decision, score, summary: "s", requirements: [], model: "m", ...extra };
}

function result(id: string, assessment?: Assessment, score = 50): MatchResult {
  const base: MatchResult = {
    candidateId: id,
    score,
    coverage: 1,
    blocked: false,
    verdicts: [],
    why: null,
    retrieval: { textRank: null, vectorRank: null },
  };
  return assessment ? { ...base, assessment } : base;
}

const results: MatchResult[] = [
  result("f1", assessed("fit", 90)),
  result("f2", assessed("fit", 80)),
  result("b1", assessed("borderline", 60)),
  result("n1", assessed("no_fit", 20)),
  result("u1"),
];

function tiers(ranked: readonly MatchResult[]): Record<string, AssessmentTier | undefined> {
  return Object.fromEntries(ranked.map((entry) => [entry.candidateId, entry.assessment?.tier]));
}

describe("applyRanking", () => {
  it("gives a fit the tier answered, with the note, and turns a C into borderline, never no_fit", () => {
    const ranked = applyRanking(results, {
      ranking: [
        { candidateId: "f1", tier: "A", note: "Le seul avec la conquête grands comptes." },
        { candidateId: "f2", tier: "C", note: "En retrait sur la séniorité." },
      ],
    });
    expect(ranked[0]?.assessment).toMatchObject({
      decision: "fit",
      tier: "A",
      rankNote: "Le seul avec la conquête grands comptes.",
    });
    expect(ranked[1]?.assessment).toMatchObject({
      decision: "borderline",
      tier: "C",
      rankNote: "En retrait sur la séniorité.",
    });
    expect(ranked[1]?.assessment?.score).toBe(80);
  });

  it("never gives a borderline an A, nor a no_fit an A or a B, and leaves their decisions alone", () => {
    const ranked = applyRanking(results, {
      ranking: [
        { candidateId: "b1", tier: "A" },
        { candidateId: "n1", tier: "B" },
      ],
    });
    expect(ranked[2]?.assessment).toMatchObject({
      decision: "borderline",
      tier: "B",
      rankNote: null,
    });
    expect(ranked[3]?.assessment).toMatchObject({ decision: "no_fit", tier: "C", rankNote: null });
    const kept = applyRanking(results, { ranking: [{ candidateId: "b1", tier: "C" }] });
    expect(kept[2]?.assessment).toMatchObject({ decision: "borderline", tier: "C" });
  });

  it("ignores unknown ids, unknown tiers, unassessed results, and takes the first entry per id", () => {
    const ranked = applyRanking(results, {
      ranking: [
        { candidateId: "ghost", tier: "A" },
        { candidateId: "f1", tier: "S" },
        { candidateId: "u1", tier: "A" },
        { candidateId: "f2", tier: "B" },
        { candidateId: "f2", tier: "A" },
      ],
    });
    expect(tiers(ranked)).toEqual({
      f1: undefined,
      f2: "B",
      b1: undefined,
      n1: undefined,
      u1: undefined,
    });
    expect(ranked[4]?.assessment).toBeUndefined();
    // The order given is kept; the untouched entries are the same objects.
    expect(ranked.map((entry) => entry.candidateId)).toEqual(["f1", "f2", "b1", "n1", "u1"]);
    expect(ranked[0]).toBe(results[0]);
    expect(applyRanking(results, { ranking: [] })).toEqual(results);
  });

  it("clips the note and drops one that names what no sentence may", () => {
    const long = applyRanking(results, {
      ranking: [{ candidateId: "f1", tier: "A", note: `  ${"n".repeat(300)}  ` }],
    });
    expect(long[0]?.assessment?.rankNote).toHaveLength(NOTE_MAX);
    const forbidden = applyRanking(results, {
      ranking: [
        { candidateId: "f1", tier: "A", note: "Plus jeune que les autres (âge)." },
        { candidateId: "f2", tier: "B", note: "Un trou de deux ans dans le parcours." },
      ],
    });
    // A withheld note is counted, so the card says the reading is incomplete.
    expect(forbidden[0]?.assessment).toMatchObject({ tier: "A", rankNote: null, withheld: 1 });
    expect(forbidden[1]?.assessment).toMatchObject({ tier: "B", rankNote: null, withheld: 1 });
    expect("withheld" in (long[0]?.assessment ?? {})).toBe(false);
    const counted = applyRanking([result("w", { ...assessed("fit", 80), withheld: 2 })], {
      ranking: [{ candidateId: "w", tier: "A", note: "Sa famille habite loin." }],
    });
    expect(counted[0]?.assessment).toMatchObject({ tier: "A", rankNote: null, withheld: 3 });
    // A recruiter's words about the job are not withheld.
    const kept = applyRanking(results, {
      ranking: [
        { candidateId: "f1", tier: "A", note: "Le seul à avoir défini la politique commerciale." },
        { candidateId: "f2", tier: "B", note: "Seniority gap next to the others." },
      ],
    });
    expect(kept[0]?.assessment?.rankNote).toBe("Le seul à avoir défini la politique commerciale.");
    expect(kept[1]?.assessment?.rankNote).toBe("Seniority gap next to the others.");
  });

  it("keeps the second opinion and the dimensions the assessment already holds", () => {
    const challenged = result(
      "f3",
      assessed("fit", 85, {
        challenge: { verdict: "confirmed", reason: "r", evidence: null },
        strengths: ["s"],
      }),
    );
    const ranked = applyRanking([challenged], { ranking: [{ candidateId: "f3", tier: "A" }] });
    expect(ranked[0]?.assessment).toMatchObject({
      tier: "A",
      challenge: { verdict: "confirmed" },
      strengths: ["s"],
    });
  });
});

describe("sortByTier", () => {
  it("orders A, B, C, then no tier, and by score inside a tier", () => {
    const ranked = applyRanking(results, {
      ranking: [
        { candidateId: "f2", tier: "A" },
        { candidateId: "b1", tier: "B" },
        { candidateId: "n1", tier: "C" },
      ],
    });
    expect(sortByTier(ranked).map((entry) => entry.candidateId)).toEqual([
      "f2",
      "b1",
      "n1",
      "f1",
      "u1",
    ]);
    const twoAs = applyRanking(results, {
      ranking: [
        { candidateId: "f2", tier: "A" },
        { candidateId: "f1", tier: "A" },
      ],
    });
    expect(
      sortByTier(twoAs)
        .map((entry) => entry.candidateId)
        .slice(0, 2),
    ).toEqual(["f1", "f2"]);
  });
});

describe("rankingSheets and rankingPayload", () => {
  it("writes one sheet per assessed result, with the dimension scores and the doubt's reason, never a name or a text", () => {
    const rich = result(
      "f4",
      assessed("fit", 77, {
        dimensions: {
          role: { score: 90, note: "n", evidence: "e" },
          seniority: { score: 70, note: "n", evidence: null },
          context: { score: 50, note: "n", evidence: null },
          trajectory: { score: 80, note: "n", evidence: null },
          achievements: { score: 60, note: "n", evidence: null },
        },
        strengths: ["Conquête de 12 comptes"],
        concerns: ["Pas de management"],
        challenge: {
          verdict: "doubt",
          reason: "Les dates se chevauchent.",
          evidence: "2019-2021 et 2020-2022",
        },
      }),
    );
    const confirmed = result(
      "f5",
      assessed("fit", 70, { challenge: { verdict: "confirmed", reason: "tient", evidence: null } }),
    );
    const sheets = rankingSheets([rich, confirmed, result("u2")]);
    expect(sheets).toHaveLength(2);
    expect(sheets[0]).toEqual({
      candidateId: "f4",
      decision: "fit",
      score: 77,
      dimensions: { role: 90, seniority: 70, context: 50, trajectory: 80, achievements: 60 },
      requirements: [],
      seniority: "n",
      strengths: ["Conquête de 12 comptes"],
      concerns: ["Pas de management"],
      challenge: "Les dates se chevauchent.",
    });
    expect(sheets[1]).toMatchObject({
      candidateId: "f5",
      dimensions: null,
      requirements: [],
      seniority: null,
      strengths: [],
      concerns: [],
      challenge: null,
    });
    const payload = rankingPayload(
      {
        title: " Business Developer ",
        criteria: [
          {
            id: "r",
            kind: "role",
            label: "BD",
            value: "Commercial : conquête…",
            required: true,
            weight: 3,
          },
        ],
        roleProfile: null,
      },
      sheets,
    );
    expect(payload.brief).toEqual({
      title: "Business Developer",
      role: "Commercial : conquête…",
      mustHaves: [],
    });
    expect(payload.candidates).toEqual(sheets);
    const json = JSON.stringify(payload);
    expect(json).not.toContain("summary");
    expect(json).not.toContain("full_name");
  });

  it("carries the requirement rows joined with the criteria, the role first and the required ones marked, and the seniority note", () => {
    const criteria: BriefCriterion[] = [
      { id: "a", kind: "language", label: "Anglais", value: "anglais", required: true, weight: 2 },
      { id: "r", kind: "role", label: "BD", value: "Commercial…", required: true, weight: 3 },
      { id: "s", kind: "skill", label: "SAP", value: "sap", required: false, weight: 1 },
    ];
    const sheets = rankingSheets(
      [
        result(
          "f6",
          assessed("borderline", 60, {
            requirements: [
              { criterionId: "a", met: "unknown", evidence: null },
              { criterionId: "r", met: "yes", evidence: "e" },
              { criterionId: "ghost", met: "no", evidence: null },
            ],
            dimensions: {
              role: { score: 90, note: "n", evidence: "e" },
              seniority: { score: 60, note: "Au-dessus du niveau demandé.", evidence: null },
              context: { score: 50, note: "", evidence: null },
              trajectory: { score: 50, note: "", evidence: null },
              achievements: { score: 50, note: "", evidence: null },
            },
          }),
        ),
      ],
      criteria,
    );
    expect(sheets[0]?.requirements).toEqual([
      { label: "BD", required: true, met: "yes" },
      { label: "Anglais", required: true, met: "unknown" },
    ]);
    expect(sheets[0]?.seniority).toBe("Au-dessus du niveau demandé.");
    expect(JSON.stringify(sheets)).not.toContain("evidence");
  });

  it("says what the tiers mean, anchored on the brief, and compares within the group", () => {
    const prompt = rankingSystemPrompt();
    expect(prompt).toContain('"tier":"A|B|C"');
    expect(prompt).toContain("tier A: present now");
    expect(prompt).toContain("whatever the others");
    expect(prompt).toContain("tier B: worth a deeper look");
    expect(prompt).toContain("tier C: do not present");
    expect(prompt).toContain("a C is still a profile the team may present");
    expect(prompt).toContain("The tier is a judgement of the profile against the brief");
    expect(prompt).toContain(
      'A required requirement at "unknown" or "partial" is a reservation to check: tier B at most',
    );
    expect(prompt).toContain(
      "the requirement rows (met, partly, not met, not stated; required ones marked)",
    );
    expect(prompt).toContain("RELATIVE TO THE OTHERS");
    expect(prompt).toContain("not quotas");
    // The bounds the code applies are told, so an A on a borderline is not wasted and a C is explained.
    expect(prompt).toContain('A candidate whose decision is "borderline" can be B at most');
    expect(prompt).toContain('A "fit" you put at C is sent back to the team as "to check"');
    expect(prompt).not.toContain("seniority gap");
    expect(prompt).toContain("protected characteristic");
    expect(prompt).toContain("never a career break");
    expect(RANK_GROUP_MAX).toBe(8);
    expect(RANK_GROUP_MIN).toBe(2);
  });
});
