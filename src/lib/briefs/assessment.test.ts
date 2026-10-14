import { describe, expect, it } from "vitest";

import type { Assessment, BriefCriterion, CriterionResult, MatchResult } from "@/lib/db/types";

import {
  BORDERLINE_MIN_SCORE,
  bucketResults,
  decisionOf,
  enforceAssessment,
  FIT_MIN_SCORE,
  firstMissingRequirement,
  mostMissingRequirement,
  REQUIRED_NO_SCORE_CAP,
  REQUIRED_UNKNOWN_SCORE_CAP,
  requirementRows,
  ROLE_NO_SCORE_CAP,
  ROLE_PARTIAL_SCORE_CAP,
  ROLE_UNKNOWN_SCORE_CAP,
  type ModelAssessmentAnswer,
} from "./assessment";

const criteria: BriefCriterion[] = [
  { id: "skill", kind: "skill", label: "Contrôle de gestion", value: "contrôle de gestion", required: true, weight: 3 },
  { id: "lang", kind: "language", label: "Anglais C1", value: "anglais C1", required: true, weight: 2 },
  { id: "sap", kind: "skill", label: "SAP", value: "sap", required: false, weight: 1 },
];

const role: BriefCriterion = {
  id: "role",
  kind: "role",
  label: "Business Developer",
  value: "Commercial : prospection de nouveaux comptes, vente et négociation…",
  required: true,
  weight: 3,
};

/** The same brief with its role kept last, as a row added by hand in the editor would be. */
const withRole: BriefCriterion[] = [...criteria, role];

const none: CriterionResult[] = [];

function answer(partial: Partial<ModelAssessmentAnswer> = {}): ModelAssessmentAnswer {
  return {
    requirements: partial.requirements ?? [
      { criterionId: "skill", met: "yes", evidence: "Contrôleur de gestion chez X (2018-2024)" },
      { criterionId: "lang", met: "yes", evidence: "Anglais (C1)" },
      { criterionId: "sap", met: "yes", evidence: "SAP FI/CO" },
    ],
    decision: partial.decision ?? "fit",
    score: partial.score ?? 88,
    summary: partial.summary ?? "Le profil couvre le contrôle de gestion et l'anglais. SAP est cité.",
  };
}

function result(id: string, partial: Partial<MatchResult> & { assessment?: Assessment } = {}): MatchResult {
  const base: MatchResult = {
    candidateId: id,
    score: partial.score ?? 50,
    coverage: partial.coverage ?? 1,
    blocked: partial.blocked ?? false,
    verdicts: partial.verdicts ?? [],
    why: null,
    retrieval: { textRank: null, vectorRank: null },
  };
  return partial.assessment ? { ...base, assessment: partial.assessment } : base;
}

function assessed(decision: Assessment["decision"], score: number, requirements: Assessment["requirements"] = []): Assessment {
  return { decision, score, summary: "s", requirements, model: "m" };
}

describe("enforceAssessment", () => {
  it("keeps a clean fit as the model answered it and names the model", () => {
    const assessment = enforceAssessment(criteria, none, answer(), "mistral-large-latest");
    expect(assessment.decision).toBe("fit");
    expect(assessment.score).toBe(88);
    expect(assessment.model).toBe("mistral-large-latest");
    expect(assessment.requirements.map((row) => row.met)).toEqual(["yes", "yes", "yes"]);
    expect(assessment.summary).toBe("Le profil couvre le contrôle de gestion et l'anglais. SAP est cité.");
  });

  it("gives every criterion a row, in the brief's order, unknown when the model skipped it or answered nonsense", () => {
    const assessment = enforceAssessment(
      criteria,
      none,
      answer({
        requirements: [
          { criterionId: "sap", met: "yes", evidence: "SAP" },
          { criterionId: "ghost", met: "yes", evidence: "nope" },
          { criterionId: "skill", met: "maybe", evidence: "x" },
        ],
      }),
      "m",
    );
    expect(assessment.requirements.map((row) => row.criterionId)).toEqual(["skill", "lang", "sap"]);
    expect(assessment.requirements[0]).toEqual({ criterionId: "skill", met: "unknown", evidence: null });
    expect(assessment.requirements[1]).toEqual({ criterionId: "lang", met: "unknown", evidence: null });
    expect(assessment.requirements[2]?.met).toBe("yes");
  });

  it("clips the evidence to 200 and the summary to 600 characters", () => {
    const assessment = enforceAssessment(
      criteria,
      none,
      answer({
        requirements: [{ criterionId: "skill", met: "yes", evidence: ` ${"e".repeat(300)} ` }],
        summary: "s".repeat(1000),
      }),
      "m",
    );
    expect(assessment.requirements[0]?.evidence).toHaveLength(200);
    expect(assessment.summary).toHaveLength(600);
  });

  it("turns a yes without evidence into a partial", () => {
    const assessment = enforceAssessment(
      criteria,
      none,
      answer({ requirements: [{ criterionId: "sap", met: "yes", evidence: "  " }, { criterionId: "lang", met: "yes" }] }),
      "m",
    );
    expect(assessment.requirements[2]).toEqual({ criterionId: "sap", met: "partial", evidence: null });
    expect(assessment.requirements[1]?.met).toBe("partial");
  });

  it("turns a no without evidence into an unknown unless the deterministic pass found the thing missing with evidence", () => {
    const verdicts: CriterionResult[] = [
      { criterionId: "skill", verdict: "not_stated", evidence: null },
      { criterionId: "lang", verdict: "not_stated", evidence: null },
    ];
    const assessment = enforceAssessment(
      criteria,
      verdicts,
      answer({
        requirements: [
          { criterionId: "skill", met: "yes", evidence: "Contrôleur de gestion" },
          { criterionId: "lang", met: "no" },
          { criterionId: "sap", met: "no", evidence: " " },
        ],
        decision: "fit",
        score: 80,
      }),
      "m",
    );
    // The CV says nothing the deterministic pass could read: not a lack, a blank.
    expect(assessment.requirements[1]).toEqual({ criterionId: "lang", met: "unknown", evidence: null });
    // No deterministic verdict at all reads the same way.
    expect(assessment.requirements[2]).toEqual({ criterionId: "sap", met: "unknown", evidence: null });
    // The profile lands in "to check", not in "set aside".
    expect(assessment.decision).toBe("borderline");
    expect(assessment.score).toBe(REQUIRED_UNKNOWN_SCORE_CAP);
    // A no the deterministic pass agrees with, with evidence of its own, stands with that evidence and sets the profile aside.
    const agreed = enforceAssessment(
      criteria,
      [{ criterionId: "lang", verdict: "missing", evidence: "Espagnol (C1), Italien (B2)" }],
      answer({ requirements: [{ criterionId: "lang", met: "no" }] }),
      "m",
    );
    expect(agreed.requirements[1]).toEqual({ criterionId: "lang", met: "no", evidence: "Espagnol (C1), Italien (B2)" });
    expect(agreed.decision).toBe("no_fit");
    // A deterministic "missing" with nothing to show is not enough: the profile is never set aside without evidence.
    const bare = enforceAssessment(
      criteria,
      [{ criterionId: "lang", verdict: "missing", evidence: null }],
      answer({ requirements: [{ criterionId: "lang", met: "no" }] }),
      "m",
    );
    expect(bare.requirements[1]).toEqual({ criterionId: "lang", met: "unknown", evidence: null });
    expect(bare.decision).toBe("borderline");
    // So does a no with a quote, whatever the deterministic pass read.
    const quoted = enforceAssessment(
      criteria,
      verdicts,
      answer({ requirements: [{ criterionId: "lang", met: "no", evidence: "Anglais (A2)" }] }),
      "m",
    );
    expect(quoted.requirements[1]).toEqual({ criterionId: "lang", met: "no", evidence: "Anglais (A2)" });
  });

  it("drops the evidence of an unknown", () => {
    const assessment = enforceAssessment(
      criteria,
      none,
      answer({ requirements: [{ criterionId: "sap", met: "unknown", evidence: "invented" }] }),
      "m",
    );
    expect(assessment.requirements[2]).toEqual({ criterionId: "sap", met: "unknown", evidence: null });
  });

  it("forces no_fit and caps the score at 39 when a required requirement is not met", () => {
    const assessment = enforceAssessment(
      criteria,
      none,
      answer({
        requirements: [
          { criterionId: "skill", met: "yes", evidence: "x" },
          { criterionId: "lang", met: "no", evidence: "Anglais (A2)" },
          { criterionId: "sap", met: "yes", evidence: "SAP" },
        ],
        decision: "fit",
        score: 92,
      }),
      "m",
    );
    expect(assessment.decision).toBe("no_fit");
    expect(assessment.score).toBe(REQUIRED_NO_SCORE_CAP);
  });

  it("caps the decision at borderline and the score at 69 when a required requirement is unknown", () => {
    const assessment = enforceAssessment(
      criteria,
      none,
      answer({
        requirements: [
          { criterionId: "skill", met: "yes", evidence: "x" },
          { criterionId: "lang", met: "unknown" },
          { criterionId: "sap", met: "yes", evidence: "SAP" },
        ],
        decision: "fit",
        score: 95,
      }),
      "m",
    );
    expect(assessment.decision).toBe("borderline");
    expect(assessment.score).toBe(REQUIRED_UNKNOWN_SCORE_CAP);
    // A score already under the cap stays as answered.
    const low = enforceAssessment(
      criteria,
      none,
      answer({ requirements: [{ criterionId: "lang", met: "unknown" }], decision: "borderline", score: 50 }),
      "m",
    );
    expect(low.score).toBe(50);
  });

  it("caps a fit at borderline when a required requirement is only met in part", () => {
    const assessment = enforceAssessment(
      criteria,
      none,
      answer({
        requirements: [
          { criterionId: "skill", met: "yes", evidence: "x" },
          { criterionId: "lang", met: "partial", evidence: "Anglais (B2)" },
          { criterionId: "sap", met: "yes", evidence: "SAP" },
        ],
        decision: "fit",
        score: 85,
      }),
      "m",
    );
    expect(assessment.decision).toBe("borderline");
    expect(assessment.score).toBe(85);
  });

  it("needs 70 for a fit and 45 for a borderline, whatever the model said", () => {
    expect(enforceAssessment(criteria, none, answer({ decision: "fit", score: FIT_MIN_SCORE - 1 }), "m").decision).toBe("borderline");
    expect(enforceAssessment(criteria, none, answer({ decision: "fit", score: FIT_MIN_SCORE }), "m").decision).toBe("fit");
    expect(enforceAssessment(criteria, none, answer({ decision: "fit", score: BORDERLINE_MIN_SCORE - 1 }), "m").decision).toBe("no_fit");
    expect(enforceAssessment(criteria, none, answer({ decision: "borderline", score: 44 }), "m").decision).toBe("no_fit");
    expect(enforceAssessment(criteria, none, answer({ decision: "borderline", score: 45 }), "m").decision).toBe("borderline");
  });

  it("never raises the model's own no_fit or borderline", () => {
    expect(enforceAssessment(criteria, none, answer({ decision: "no_fit", score: 90 }), "m").decision).toBe("no_fit");
    expect(enforceAssessment(criteria, none, answer({ decision: "borderline", score: 90 }), "m").decision).toBe("borderline");
  });

  it("derives the decision from the score when the model's is not one it knows, and clamps the score", () => {
    expect(enforceAssessment(criteria, none, answer({ decision: "maybe", score: 80 }), "m").decision).toBe("fit");
    expect(enforceAssessment(criteria, none, answer({ decision: "maybe", score: 50 }), "m").decision).toBe("borderline");
    expect(enforceAssessment(criteria, none, answer({ decision: "maybe", score: 10 }), "m").decision).toBe("no_fit");
    expect(enforceAssessment(criteria, none, answer({ score: 140 }), "m").score).toBe(100);
    expect(enforceAssessment(criteria, none, answer({ score: -3 }), "m").score).toBe(0);
    expect(enforceAssessment(criteria, none, answer({ score: Number.NaN }), "m").score).toBe(0);
    expect(enforceAssessment(criteria, none, answer({ score: 71.6 }), "m").score).toBe(72);
  });

  it("downgrades a yes the deterministic pass contradicts with evidence on a required criterion, appending that evidence", () => {
    const verdicts: CriterionResult[] = [
      { criterionId: "lang", verdict: "missing", evidence: "Espagnol (C1), Italien (B2)" },
      { criterionId: "sap", verdict: "missing", evidence: "Oracle" },
    ];
    const assessment = enforceAssessment(criteria, verdicts, answer(), "m");
    const lang = assessment.requirements[1];
    expect(lang?.met).toBe("partial");
    expect(lang?.evidence).toBe("Anglais (C1) · Espagnol (C1), Italien (B2)");
    // The disagreement sends the profile to "to check", not to "fit".
    expect(assessment.decision).toBe("borderline");
    // An optional criterion is left to the model's reading.
    expect(assessment.requirements[2]).toEqual({ criterionId: "sap", met: "yes", evidence: "SAP FI/CO" });
  });

  it("leaves a yes alone when the deterministic pass found nothing or has no evidence", () => {
    const verdicts: CriterionResult[] = [
      { criterionId: "skill", verdict: "not_stated", evidence: null },
      { criterionId: "lang", verdict: "missing", evidence: null },
    ];
    const assessment = enforceAssessment(criteria, verdicts, answer(), "m");
    expect(assessment.requirements.map((row) => row.met)).toEqual(["yes", "yes", "yes"]);
    expect(assessment.decision).toBe("fit");
  });

  it("takes the first entry when the model answers a criterion twice", () => {
    const assessment = enforceAssessment(
      criteria,
      none,
      answer({
        requirements: [
          { criterionId: "sap", met: "no", evidence: "Oracle" },
          { criterionId: "sap", met: "yes", evidence: "SAP" },
        ],
      }),
      "m",
    );
    expect(assessment.requirements[2]?.met).toBe("no");
  });
});

describe("enforceAssessment: the role comes first", () => {
  const roleAt = (met: string, evidence: string | null = "Directeur SAV : pilotage du service après-vente (2015-2024)") =>
    answer({
      requirements: [
        { criterionId: "skill", met: "yes", evidence: "x" },
        { criterionId: "lang", met: "yes", evidence: "Anglais (C1)" },
        { criterionId: "sap", met: "yes", evidence: "SAP" },
        { criterionId: "role", met, evidence },
      ],
      decision: "fit",
      score: 100,
    });

  it("forces no_fit and caps the score at 25 when the métier is another one, whatever the other requirements", () => {
    const assessment = enforceAssessment(withRole, none, roleAt("no"), "m");
    expect(assessment.decision).toBe("no_fit");
    expect(assessment.score).toBe(ROLE_NO_SCORE_CAP);
    expect(assessment.requirements[3]).toEqual({ criterionId: "role", met: "no", evidence: "Directeur SAV : pilotage du service après-vente (2015-2024)" });
    // The role sets aside on its own, even when the team unticked "required".
    const optional = enforceAssessment([...criteria, { ...role, required: false }], none, roleAt("no"), "m");
    expect(optional.decision).toBe("no_fit");
    expect(optional.score).toBe(ROLE_NO_SCORE_CAP);
    expect(ROLE_NO_SCORE_CAP).toBeLessThan(REQUIRED_NO_SCORE_CAP);
  });

  it("caps the decision at borderline and the score at 65 for an adjacent métier", () => {
    const assessment = enforceAssessment(withRole, none, roleAt("partial", "Account manager : fidélisation, pas de conquête"), "m");
    expect(assessment.decision).toBe("borderline");
    expect(assessment.score).toBe(ROLE_PARTIAL_SCORE_CAP);
    // A score already under the cap stays as answered; a stricter decision stands.
    const low = enforceAssessment(withRole, none, { ...roleAt("partial"), decision: "borderline", score: 50 }, "m");
    expect(low.decision).toBe("borderline");
    expect(low.score).toBe(50);
  });

  it("caps the decision at borderline and the score at 60 when no experience says what the métier is", () => {
    const assessment = enforceAssessment(withRole, none, roleAt("unknown", null), "m");
    expect(assessment.decision).toBe("borderline");
    expect(assessment.score).toBe(ROLE_UNKNOWN_SCORE_CAP);
    // So does a role the model skipped.
    const skipped = enforceAssessment(withRole, none, answer({ decision: "fit", score: 90 }), "m");
    expect(skipped.requirements[3]).toEqual({ criterionId: "role", met: "unknown", evidence: null });
    expect(skipped.decision).toBe("borderline");
    expect(skipped.score).toBe(ROLE_UNKNOWN_SCORE_CAP);
  });

  it("reads a yes on the role without evidence as partial, and a no without evidence as unknown: never set aside on nothing", () => {
    const bare = enforceAssessment(withRole, none, roleAt("yes", null), "m");
    expect(bare.requirements[3]?.met).toBe("partial");
    expect(bare.decision).toBe("borderline");
    expect(bare.score).toBe(ROLE_PARTIAL_SCORE_CAP);
    const silent = enforceAssessment(withRole, none, roleAt("no", "  "), "m");
    expect(silent.requirements[3]?.met).toBe("unknown");
    expect(silent.decision).toBe("borderline");
    expect(silent.score).toBe(ROLE_UNKNOWN_SCORE_CAP);
  });

  it("keeps a fit when the métier is the role with evidence, and still applies the other rules after it", () => {
    const fit = enforceAssessment(withRole, none, roleAt("yes", "Ingénieur d'affaires : conquête de comptes grands groupes (2018-2024)"), "m");
    expect(fit.decision).toBe("fit");
    expect(fit.score).toBe(100);
    const missingLanguage = enforceAssessment(
      withRole,
      none,
      {
        ...roleAt("yes", "Ingénieur d'affaires : conquête de comptes"),
        requirements: [
          { criterionId: "role", met: "yes", evidence: "Ingénieur d'affaires : conquête de comptes" },
          { criterionId: "lang", met: "no", evidence: "Anglais (A2)" },
        ],
      },
      "m",
    );
    expect(missingLanguage.decision).toBe("no_fit");
    expect(missingLanguage.score).toBe(REQUIRED_NO_SCORE_CAP);
  });

  it("changes nothing for a brief without a role criterion", () => {
    const before = enforceAssessment(criteria, none, answer({ decision: "fit", score: 88 }), "m");
    expect(before.decision).toBe("fit");
    expect(before.score).toBe(88);
    expect(before.requirements).toHaveLength(3);
  });
});

describe("decisionOf and bucketResults", () => {
  it("reads the decision, unassessed when no model answered", () => {
    expect(decisionOf(result("a"))).toBe("unassessed");
    expect(decisionOf(result("a", { assessment: assessed("fit", 80) }))).toBe("fit");
  });

  it("sorts fit and borderline by assessed score then deterministic score, keeps the unassessed in order", () => {
    const results = [
      result("u1", { score: 10 }),
      result("b1", { score: 30, assessment: assessed("borderline", 50) }),
      result("f1", { score: 20, assessment: assessed("fit", 80) }),
      result("n1", { score: 70, assessment: assessed("no_fit", 20) }),
      result("f2", { score: 60, assessment: assessed("fit", 80) }),
      result("f3", { score: 90, assessment: assessed("fit", 95) }),
      result("u2", { score: 90 }),
      result("b2", { score: 10, assessment: assessed("borderline", 60) }),
    ];
    const buckets = bucketResults(results);
    expect(buckets.fit.map((item) => item.candidateId)).toEqual(["f3", "f2", "f1"]);
    expect(buckets.borderline.map((item) => item.candidateId)).toEqual(["b2", "b1"]);
    expect(buckets.noFit.map((item) => item.candidateId)).toEqual(["n1"]);
    expect(buckets.unassessed.map((item) => item.candidateId)).toEqual(["u1", "u2"]);
  });

  it("answers four empty lists for no results", () => {
    expect(bucketResults([])).toEqual({ fit: [], borderline: [], noFit: [], unassessed: [] });
  });
});

describe("mostMissingRequirement", () => {
  it("names the required requirement most often at no, the first on a tie, null when none", () => {
    const rows = (lang: "yes" | "no", skill: "yes" | "no", sap: "yes" | "no") => [
      { criterionId: "skill", met: skill, evidence: null },
      { criterionId: "lang", met: lang, evidence: null },
      { criterionId: "sap", met: sap, evidence: null },
    ];
    const results = [
      result("a", { assessment: assessed("no_fit", 10, rows("no", "yes", "no")) }),
      result("b", { assessment: assessed("no_fit", 10, rows("no", "no", "no")) }),
      result("c", { assessment: assessed("fit", 90, rows("yes", "yes", "no")) }),
      result("d"),
    ];
    expect(mostMissingRequirement(criteria, results)?.id).toBe("lang");
    const tie = [result("a", { assessment: assessed("no_fit", 10, rows("no", "no", "yes")) })];
    expect(mostMissingRequirement(criteria, tie)?.id).toBe("skill");
    expect(mostMissingRequirement(criteria, [result("x"), result("c", { assessment: assessed("fit", 90, rows("yes", "yes", "no")) })])).toBeNull();
    expect(mostMissingRequirement([], results)).toBeNull();
  });

  it("counts the role like the others, first on a tie wherever the brief keeps it, required or not", () => {
    const rows = (roleMet: "yes" | "no", lang: "yes" | "no") => [
      { criterionId: "lang", met: lang, evidence: null },
      { criterionId: "role", met: roleMet, evidence: null },
    ];
    const tie = [result("a", { assessment: assessed("no_fit", 10, rows("no", "no")) })];
    expect(mostMissingRequirement(withRole, tie)?.id).toBe("role");
    expect(mostMissingRequirement([...criteria, { ...role, required: false }], tie)?.id).toBe("role");
    const language = [
      result("a", { assessment: assessed("no_fit", 10, rows("no", "no")) }),
      result("b", { assessment: assessed("no_fit", 10, rows("yes", "no")) }),
    ];
    expect(mostMissingRequirement(withRole, language)?.id).toBe("lang");
  });
});

describe("requirementRows", () => {
  it("maps the assessment's rows in the brief's order with the label and the required flag", () => {
    const rows = requirementRows(
      criteria,
      result("a", {
        verdicts: [{ criterionId: "skill", verdict: "missing", evidence: "ignored" }],
        assessment: assessed("fit", 80, [
          { criterionId: "lang", met: "partial", evidence: "Anglais (B2)" },
          { criterionId: "skill", met: "yes", evidence: "Contrôleur de gestion" },
        ]),
      }),
    );
    expect(rows).toEqual([
      { id: "skill", kind: "skill", label: "Contrôle de gestion", required: true, met: "yes", evidence: "Contrôleur de gestion" },
      { id: "lang", kind: "language", label: "Anglais C1", required: true, met: "partial", evidence: "Anglais (B2)" },
      { id: "sap", kind: "skill", label: "SAP", required: false, met: "unknown", evidence: null },
    ]);
  });

  it("puts the role first whatever its position in the brief, with its kind and its label as the team wrote it", () => {
    const rows = requirementRows(
      withRole,
      result("a", {
        verdicts: [{ criterionId: "role", verdict: "partial", evidence: "Développeur business unit" }],
        assessment: assessed("no_fit", 20, [{ criterionId: "role", met: "no", evidence: "Directeur SAV" }]),
      }),
    );
    expect(rows.map((row) => row.id)).toEqual(["role", "skill", "lang", "sap"]);
    expect(rows[0]).toEqual({ id: "role", kind: "role", label: "Business Developer", required: true, met: "no", evidence: "Directeur SAV" });
    // Without an assessment the deterministic reading of the titles is the row.
    const deterministic = requirementRows(withRole, result("b", { verdicts: [{ criterionId: "role", verdict: "partial", evidence: "Développeur business unit" }] }));
    expect(deterministic[0]).toMatchObject({ id: "role", met: "partial", evidence: "Développeur business unit" });
  });

  it("falls back on the deterministic verdicts: match → yes, partial → partial, missing → no, not_stated → unknown", () => {
    const rows = requirementRows(
      criteria,
      result("a", {
        verdicts: [
          { criterionId: "skill", verdict: "match", evidence: "contrôle de gestion" },
          { criterionId: "lang", verdict: "missing", evidence: null },
          { criterionId: "sap", verdict: "partial", evidence: "sap" },
        ],
      }),
    );
    expect(rows.map((row) => row.met)).toEqual(["yes", "no", "partial"]);
    expect(rows[0]?.evidence).toBe("contrôle de gestion");
    const sparse = requirementRows(criteria, result("b", { verdicts: [{ criterionId: "sap", verdict: "not_stated", evidence: null }] }));
    expect(sparse.map((row) => row.met)).toEqual(["unknown", "unknown", "unknown"]);
  });
});

describe("firstMissingRequirement", () => {
  it("names the first required requirement at no, null when unassessed or none", () => {
    const missing = result("a", {
      assessment: assessed("no_fit", 10, [
        { criterionId: "sap", met: "no", evidence: null },
        { criterionId: "skill", met: "yes", evidence: null },
        { criterionId: "lang", met: "no", evidence: null },
      ]),
    });
    expect(firstMissingRequirement(criteria, missing)?.id).toBe("lang");
    expect(firstMissingRequirement(criteria, result("b"))).toBeNull();
    expect(firstMissingRequirement(criteria, result("c", { assessment: assessed("fit", 80, []) }))).toBeNull();
  });

  it("names the role before any other requirement, required or not, wherever the brief keeps it", () => {
    const both = result("a", {
      assessment: assessed("no_fit", 10, [
        { criterionId: "lang", met: "no", evidence: "Anglais (A2)" },
        { criterionId: "role", met: "no", evidence: "Directeur SAV" },
      ]),
    });
    expect(firstMissingRequirement(withRole, both)?.id).toBe("role");
    expect(firstMissingRequirement([...criteria, { ...role, required: false }], both)?.id).toBe("role");
    const adjacent = result("b", {
      assessment: assessed("borderline", 60, [
        { criterionId: "role", met: "partial", evidence: "Account manager" },
        { criterionId: "sap", met: "no", evidence: "Oracle" },
      ]),
    });
    expect(firstMissingRequirement(withRole, adjacent)).toBeNull();
  });
});
