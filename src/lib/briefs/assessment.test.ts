import { describe, expect, it } from "vitest";

import type { Assessment, BriefCriterion, CriterionResult, MatchResult } from "@/lib/db/types";

import {
  applyChallenge,
  BORDERLINE_MIN_SCORE,
  bucketResults,
  CHALLENGE_DOUBT_SCORE_CAP,
  CONCERNS_MAX,
  decisionOf,
  enforceAssessment,
  EVIDENCE_MAX,
  evidenceGrounded,
  FIT_MIN_SCORE,
  firstMissingRequirement,
  forbiddenSentence,
  GROUNDING_WINDOW,
  mentionsCareerBreak,
  mostMissingRequirement,
  NOTE_MAX,
  QUESTIONS_MAX,
  REQUIRED_NO_SCORE_CAP,
  REQUIRED_UNKNOWN_SCORE_CAP,
  requirementRows,
  ROLE_NO_SCORE_CAP,
  ROLE_PARTIAL_SCORE_CAP,
  ROLE_UNKNOWN_SCORE_CAP,
  STRENGTHS_MAX,
  tierOf,
  type ModelAssessmentAnswer,
} from "./assessment";
import { NEUTRAL_SCORE } from "./scoring";

const criteria: BriefCriterion[] = [
  {
    id: "skill",
    kind: "skill",
    label: "Contrôle de gestion",
    value: "contrôle de gestion",
    required: true,
    weight: 3,
  },
  {
    id: "lang",
    kind: "language",
    label: "Anglais C1",
    value: "anglais C1",
    required: true,
    weight: 2,
  },
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
    summary:
      partial.summary ?? "Le profil couvre le contrôle de gestion et l'anglais. SAP est cité.",
  };
}

function result(
  id: string,
  partial: Partial<MatchResult> & { assessment?: Assessment } = {},
): MatchResult {
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

function assessed(
  decision: Assessment["decision"],
  score: number,
  requirements: Assessment["requirements"] = [],
): Assessment {
  return { decision, score, summary: "s", requirements, model: "m" };
}

describe("enforceAssessment", () => {
  it("keeps a clean fit as the model answered it and names the model", () => {
    const assessment = enforceAssessment(criteria, none, answer(), "mistral-large-latest");
    expect(assessment.decision).toBe("fit");
    expect(assessment.score).toBe(88);
    expect(assessment.model).toBe("mistral-large-latest");
    expect(assessment.requirements.map((row) => row.met)).toEqual(["yes", "yes", "yes"]);
    expect(assessment.summary).toBe(
      "Le profil couvre le contrôle de gestion et l'anglais. SAP est cité.",
    );
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
    expect(assessment.requirements[0]).toEqual({
      criterionId: "skill",
      met: "unknown",
      evidence: null,
    });
    expect(assessment.requirements[1]).toEqual({
      criterionId: "lang",
      met: "unknown",
      evidence: null,
    });
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
      answer({
        requirements: [
          { criterionId: "sap", met: "yes", evidence: "  " },
          { criterionId: "lang", met: "yes" },
        ],
      }),
      "m",
    );
    expect(assessment.requirements[2]).toEqual({
      criterionId: "sap",
      met: "partial",
      evidence: null,
    });
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
    expect(assessment.requirements[1]).toEqual({
      criterionId: "lang",
      met: "unknown",
      evidence: null,
    });
    // No deterministic verdict at all reads the same way.
    expect(assessment.requirements[2]).toEqual({
      criterionId: "sap",
      met: "unknown",
      evidence: null,
    });
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
    expect(agreed.requirements[1]).toEqual({
      criterionId: "lang",
      met: "no",
      evidence: "Espagnol (C1), Italien (B2)",
    });
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
    expect(quoted.requirements[1]).toEqual({
      criterionId: "lang",
      met: "no",
      evidence: "Anglais (A2)",
    });
  });

  it("drops the evidence of an unknown", () => {
    const assessment = enforceAssessment(
      criteria,
      none,
      answer({ requirements: [{ criterionId: "sap", met: "unknown", evidence: "invented" }] }),
      "m",
    );
    expect(assessment.requirements[2]).toEqual({
      criterionId: "sap",
      met: "unknown",
      evidence: null,
    });
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
      answer({
        requirements: [{ criterionId: "lang", met: "unknown" }],
        decision: "borderline",
        score: 50,
      }),
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
    expect(
      enforceAssessment(criteria, none, answer({ decision: "fit", score: FIT_MIN_SCORE - 1 }), "m")
        .decision,
    ).toBe("borderline");
    expect(
      enforceAssessment(criteria, none, answer({ decision: "fit", score: FIT_MIN_SCORE }), "m")
        .decision,
    ).toBe("fit");
    expect(
      enforceAssessment(
        criteria,
        none,
        answer({ decision: "fit", score: BORDERLINE_MIN_SCORE - 1 }),
        "m",
      ).decision,
    ).toBe("no_fit");
    expect(
      enforceAssessment(criteria, none, answer({ decision: "borderline", score: 44 }), "m")
        .decision,
    ).toBe("no_fit");
    expect(
      enforceAssessment(criteria, none, answer({ decision: "borderline", score: 45 }), "m")
        .decision,
    ).toBe("borderline");
  });

  it("never raises the model's own borderline", () => {
    expect(
      enforceAssessment(criteria, none, answer({ decision: "borderline", score: 90 }), "m")
        .decision,
    ).toBe("borderline");
  });

  it("reads a no_fit the model cannot pin on the role or a required requirement as borderline: the team decides", () => {
    // Every requirement met, the role absent: the model's no_fit rests on nothing the rules can name.
    const loose = enforceAssessment(criteria, none, answer({ decision: "no_fit", score: 90 }), "m");
    expect(loose.decision).toBe("borderline");
    expect(loose.score).toBe(90);
    // The role met with evidence, every required requirement met: the same.
    const pinnedOnNothing = enforceAssessment(
      withRole,
      none,
      {
        ...answer({ decision: "no_fit", score: 85 }),
        requirements: [
          {
            criterionId: "role",
            met: "yes",
            evidence: "Ingénieur d'affaires : conquête de comptes",
          },
          { criterionId: "skill", met: "yes", evidence: "x" },
          { criterionId: "lang", met: "yes", evidence: "Anglais (C1)" },
          { criterionId: "sap", met: "yes", evidence: "SAP" },
        ],
      },
      "m",
    );
    expect(pinnedOnNothing.decision).toBe("borderline");
    expect(pinnedOnNothing.score).toBe(85);
    // A composite under 45 still sets the profile aside on the score, which the card names.
    expect(
      enforceAssessment(criteria, none, answer({ decision: "no_fit", score: 30 }), "m").decision,
    ).toBe("no_fit");
    // A no_fit the rules can pin stands: the role at "no", or a required requirement at "no".
    expect(
      enforceAssessment(
        criteria,
        none,
        answer({
          decision: "no_fit",
          score: 90,
          requirements: [{ criterionId: "lang", met: "no", evidence: "Anglais (A2)" }],
        }),
        "m",
      ).decision,
    ).toBe("no_fit");
  });

  it("derives the decision from the score when the model's is not one it knows, and clamps the score", () => {
    expect(
      enforceAssessment(criteria, none, answer({ decision: "maybe", score: 80 }), "m").decision,
    ).toBe("fit");
    expect(
      enforceAssessment(criteria, none, answer({ decision: "maybe", score: 50 }), "m").decision,
    ).toBe("borderline");
    expect(
      enforceAssessment(criteria, none, answer({ decision: "maybe", score: 10 }), "m").decision,
    ).toBe("no_fit");
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
    expect(assessment.requirements[2]).toEqual({
      criterionId: "sap",
      met: "yes",
      evidence: "SAP FI/CO",
    });
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
  const roleAt = (
    met: string,
    evidence: string | null = "Directeur SAV : pilotage du service après-vente (2015-2024)",
  ) =>
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
    expect(assessment.requirements[3]).toEqual({
      criterionId: "role",
      met: "no",
      evidence: "Directeur SAV : pilotage du service après-vente (2015-2024)",
    });
    // The role sets aside on its own, even when the team unticked "required".
    const optional = enforceAssessment(
      [...criteria, { ...role, required: false }],
      none,
      roleAt("no"),
      "m",
    );
    expect(optional.decision).toBe("no_fit");
    expect(optional.score).toBe(ROLE_NO_SCORE_CAP);
    expect(ROLE_NO_SCORE_CAP).toBeLessThan(REQUIRED_NO_SCORE_CAP);
  });

  it("caps the decision at borderline and the score at 65 for an adjacent métier", () => {
    const assessment = enforceAssessment(
      withRole,
      none,
      roleAt("partial", "Account manager : fidélisation, pas de conquête"),
      "m",
    );
    expect(assessment.decision).toBe("borderline");
    expect(assessment.score).toBe(ROLE_PARTIAL_SCORE_CAP);
    // A score already under the cap stays as answered; a stricter decision stands.
    const low = enforceAssessment(
      withRole,
      none,
      { ...roleAt("partial"), decision: "borderline", score: 50 },
      "m",
    );
    expect(low.decision).toBe("borderline");
    expect(low.score).toBe(50);
  });

  it("caps the decision at borderline and the score at 60 when no experience says what the métier is", () => {
    const assessment = enforceAssessment(withRole, none, roleAt("unknown", null), "m");
    expect(assessment.decision).toBe("borderline");
    expect(assessment.score).toBe(ROLE_UNKNOWN_SCORE_CAP);
    // So does a role the model skipped.
    const skipped = enforceAssessment(withRole, none, answer({ decision: "fit", score: 90 }), "m");
    expect(skipped.requirements[3]).toEqual({
      criterionId: "role",
      met: "unknown",
      evidence: null,
    });
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
    const fit = enforceAssessment(
      withRole,
      none,
      roleAt("yes", "Ingénieur d'affaires : conquête de comptes grands groupes (2018-2024)"),
      "m",
    );
    expect(fit.decision).toBe("fit");
    expect(fit.score).toBe(100);
    const missingLanguage = enforceAssessment(
      withRole,
      none,
      {
        ...roleAt("yes", "Ingénieur d'affaires : conquête de comptes"),
        requirements: [
          {
            criterionId: "role",
            met: "yes",
            evidence: "Ingénieur d'affaires : conquête de comptes",
          },
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
    // Before the tiering, every fit is to present and every borderline to dig into.
    expect(buckets.present.map((item) => item.candidateId)).toEqual(["f3", "f2", "f1"]);
    expect(buckets.deeper.map((item) => item.candidateId)).toEqual(["b2", "b1"]);
    expect(buckets.setAside).toBe(buckets.noFit);
  });

  it("reads the tiers: a fit at A or without a tier is to present, at B or C to dig into with the borderlines, tier first then score", () => {
    const results = [
      result("fB", { score: 10, assessment: { ...assessed("fit", 95), tier: "B" } }),
      result("fA", { score: 10, assessment: { ...assessed("fit", 70), tier: "A" } }),
      result("f0", { score: 10, assessment: assessed("fit", 99) }),
      result("fC", { score: 10, assessment: { ...assessed("fit", 90), tier: "C" } }),
      result("bB", { score: 10, assessment: { ...assessed("borderline", 60), tier: "B" } }),
      result("b0", { score: 10, assessment: assessed("borderline", 65) }),
      result("nC", { score: 10, assessment: { ...assessed("no_fit", 20), tier: "C" } }),
      result("n0", { score: 10, assessment: assessed("no_fit", 30) }),
    ];
    const buckets = bucketResults(results);
    expect(buckets.present.map((item) => item.candidateId)).toEqual(["fA", "f0"]);
    expect(buckets.deeper.map((item) => item.candidateId)).toEqual(["fB", "bB", "fC", "b0"]);
    expect(buckets.setAside.map((item) => item.candidateId)).toEqual(["nC", "n0"]);
    expect(buckets.fit.map((item) => item.candidateId)).toEqual(["fA", "fB", "fC", "f0"]);
    expect(tierOf(results[0] as MatchResult)).toBe("B");
    expect(tierOf(result("x"))).toBeNull();
    expect(
      tierOf(result("y", { assessment: { ...assessed("fit", 70), tier: "Z" as never } })),
    ).toBeNull();
  });

  it("answers empty lists for no results", () => {
    expect(bucketResults([])).toEqual({
      present: [],
      deeper: [],
      setAside: [],
      unassessed: [],
      fit: [],
      borderline: [],
      noFit: [],
    });
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
    expect(
      mostMissingRequirement(criteria, [
        result("x"),
        result("c", { assessment: assessed("fit", 90, rows("yes", "yes", "no")) }),
      ]),
    ).toBeNull();
    expect(mostMissingRequirement([], results)).toBeNull();
  });

  it("counts the role like the others, first on a tie wherever the brief keeps it, required or not", () => {
    const rows = (roleMet: "yes" | "no", lang: "yes" | "no") => [
      { criterionId: "lang", met: lang, evidence: null },
      { criterionId: "role", met: roleMet, evidence: null },
    ];
    const tie = [result("a", { assessment: assessed("no_fit", 10, rows("no", "no")) })];
    expect(mostMissingRequirement(withRole, tie)?.id).toBe("role");
    expect(mostMissingRequirement([...criteria, { ...role, required: false }], tie)?.id).toBe(
      "role",
    );
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
      {
        id: "skill",
        kind: "skill",
        label: "Contrôle de gestion",
        required: true,
        met: "yes",
        evidence: "Contrôleur de gestion",
      },
      {
        id: "lang",
        kind: "language",
        label: "Anglais C1",
        required: true,
        met: "partial",
        evidence: "Anglais (B2)",
      },
      { id: "sap", kind: "skill", label: "SAP", required: false, met: "unknown", evidence: null },
    ]);
  });

  it("puts the role first whatever its position in the brief, with its kind and its label as the team wrote it", () => {
    const rows = requirementRows(
      withRole,
      result("a", {
        verdicts: [
          { criterionId: "role", verdict: "partial", evidence: "Développeur business unit" },
        ],
        assessment: assessed("no_fit", 20, [
          { criterionId: "role", met: "no", evidence: "Directeur SAV" },
        ]),
      }),
    );
    expect(rows.map((row) => row.id)).toEqual(["role", "skill", "lang", "sap"]);
    expect(rows[0]).toEqual({
      id: "role",
      kind: "role",
      label: "Business Developer",
      required: true,
      met: "no",
      evidence: "Directeur SAV",
    });
    // Without an assessment the deterministic reading of the titles is the row.
    const deterministic = requirementRows(
      withRole,
      result("b", {
        verdicts: [
          { criterionId: "role", verdict: "partial", evidence: "Développeur business unit" },
        ],
      }),
    );
    expect(deterministic[0]).toMatchObject({
      id: "role",
      met: "partial",
      evidence: "Développeur business unit",
    });
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
    const sparse = requirementRows(
      criteria,
      result("b", { verdicts: [{ criterionId: "sap", verdict: "not_stated", evidence: null }] }),
    );
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
    expect(
      firstMissingRequirement(criteria, result("c", { assessment: assessed("fit", 80, []) })),
    ).toBeNull();
  });

  it("names the role before any other requirement, required or not, wherever the brief keeps it", () => {
    const both = result("a", {
      assessment: assessed("no_fit", 10, [
        { criterionId: "lang", met: "no", evidence: "Anglais (A2)" },
        { criterionId: "role", met: "no", evidence: "Directeur SAV" },
      ]),
    });
    expect(firstMissingRequirement(withRole, both)?.id).toBe("role");
    expect(firstMissingRequirement([...criteria, { ...role, required: false }], both)?.id).toBe(
      "role",
    );
    const adjacent = result("b", {
      assessment: assessed("borderline", 60, [
        { criterionId: "role", met: "partial", evidence: "Account manager" },
        { criterionId: "sap", met: "no", evidence: "Oracle" },
      ]),
    });
    expect(firstMissingRequirement(withRole, adjacent)).toBeNull();
  });
});

// ---------------------------------------------------------------------
// the five dimensions and the composite score
// ---------------------------------------------------------------------

const dimensions: NonNullable<ModelAssessmentAnswer["dimensions"]> = {
  role: {
    score: 90,
    note: "Métier tenu sur les deux derniers postes.",
    evidence: "Business developer chez X (2019-2024)",
  },
  seniority: {
    score: 80,
    note: "Au niveau demandé.",
    evidence: "Responsable contrôle de gestion (2019-2024)",
  },
  context: { score: 50, note: "le CV ne le précise pas", evidence: null },
  trajectory: {
    score: 70,
    note: "Responsabilités croissantes.",
    evidence: "Contrôleur (2015-2019) puis responsable (2019-2024)",
  },
  achievements: { score: 60, note: "Un résultat chiffré.", evidence: "+30 % de CA en 2023" },
};

describe("enforceAssessment: the dimensions", () => {
  it("uses the composite as the score when the model scored the dimensions, keeps the model's score apart, and stores the lists", () => {
    const assessment = enforceAssessment(
      criteria,
      none,
      {
        ...answer({ score: 88 }),
        dimensions,
        strengths: ["Conquête de 12 comptes en 2023", " Anglais C1 "],
        concerns: ["Pas de management d'équipe"],
        questions: ["Quel cycle de vente ?"],
      },
      "m",
    );
    // 36 + 12 + 7.5 + 0.15 × 65 + 15 (every requirement met) = 80.25.
    expect(assessment.score).toBe(80);
    expect(assessment.modelScore).toBe(88);
    expect(assessment.decision).toBe("fit");
    expect(assessment.dimensions).toEqual(dimensions);
    expect(assessment.strengths).toEqual(["Conquête de 12 comptes en 2023", "Anglais C1"]);
    expect(assessment.concerns).toEqual(["Pas de management d'équipe"]);
    expect(assessment.questions).toEqual(["Quel cycle de vente ?"]);
  });

  it("leaves an answer without dimensions on the old path: the model's score, nothing stored for the lists", () => {
    const assessment = enforceAssessment(criteria, none, answer({ score: 88 }), "m");
    expect(assessment.score).toBe(88);
    expect(assessment.modelScore).toBeUndefined();
    expect("dimensions" in assessment).toBe(false);
    expect("strengths" in assessment).toBe(false);
    const nulled = enforceAssessment(
      criteria,
      none,
      { ...answer({ score: 88 }), dimensions: null, strengths: null },
      "m",
    );
    expect(nulled.score).toBe(88);
    expect("dimensions" in nulled).toBe(false);
  });

  it("counts a dimension the model skipped as neutral, with an empty note", () => {
    const assessment = enforceAssessment(
      criteria,
      none,
      {
        ...answer({ score: 10 }),
        dimensions: { role: { score: 100, evidence: "Business developer chez X" } },
      },
      "m",
    );
    // 40 + 7.5 + 7.5 + 7.5 + 15 = 77.5.
    expect(assessment.score).toBe(78);
    expect(assessment.dimensions?.role).toEqual({
      score: 100,
      note: "",
      evidence: "Business developer chez X",
    });
    expect(assessment.dimensions?.seniority).toEqual({
      score: NEUTRAL_SCORE,
      note: "",
      evidence: null,
    });
    expect(assessment.strengths).toEqual([]);
    expect(assessment.questions).toEqual([]);
  });

  it("reads a dimension scored above neutral without evidence as neutral, as it reads a yes without a quote", () => {
    const assessment = enforceAssessment(
      criteria,
      none,
      {
        ...answer({ score: 10 }),
        dimensions: {
          ...dimensions,
          role: { score: 90, note: "Métier tenu.", evidence: "" },
          achievements: { score: 30, note: "Aucun résultat chiffré.", evidence: null },
        },
      },
      "m",
    );
    // The role falls to 50 (no quote, 40 points on nothing); a score under neutral stays: 20 + 12 + 7.5 + 0.15 × 50 + 15 = 62.
    expect(assessment.dimensions?.role).toEqual({
      score: 50,
      note: "Métier tenu.",
      evidence: null,
    });
    expect(assessment.dimensions?.achievements.score).toBe(30);
    expect(assessment.score).toBe(62);
  });

  it("weighs the coverage of the other requirements, an unknown left out", () => {
    const partial = enforceAssessment(
      criteria,
      none,
      {
        ...answer({
          requirements: [
            { criterionId: "skill", met: "yes", evidence: "x" },
            { criterionId: "lang", met: "partial", evidence: "Anglais (B2)" },
            { criterionId: "sap", met: "yes", evidence: "SAP" },
          ],
        }),
        dimensions,
      },
      "m",
    );
    // Coverage (3 + 1 + 1) / 6 = 83: 36 + 12 + 7.5 + 9.75 + 12.45 = 77.7; a required requirement met in part caps the decision.
    expect(partial.score).toBe(78);
    expect(partial.decision).toBe("borderline");
    const silent = enforceAssessment(
      criteria,
      none,
      {
        ...answer({ requirements: [{ criterionId: "sap", met: "yes", evidence: "SAP" }] }),
        dimensions,
      },
      "m",
    );
    // Coverage 100 on the one evaluable requirement; the required unknowns cap the score at 69 and the decision at borderline.
    expect(silent.score).toBe(REQUIRED_UNKNOWN_SCORE_CAP);
    expect(silent.decision).toBe("borderline");
  });

  it("applies the gates to the composite as to any score: the role first, then the required requirements, then the thresholds", () => {
    const other = enforceAssessment(
      withRole,
      none,
      {
        ...answer({
          requirements: [
            { criterionId: "role", met: "no", evidence: "Directeur SAV (2015-2024)" },
            { criterionId: "skill", met: "yes", evidence: "x" },
            { criterionId: "lang", met: "yes", evidence: "Anglais (C1)" },
            { criterionId: "sap", met: "yes", evidence: "SAP" },
          ],
        }),
        dimensions,
      },
      "m",
    );
    expect(other.decision).toBe("no_fit");
    expect(other.score).toBe(ROLE_NO_SCORE_CAP);
    expect(other.modelScore).toBe(88);
    const missing = enforceAssessment(
      criteria,
      none,
      {
        ...answer({ requirements: [{ criterionId: "lang", met: "no", evidence: "Anglais (A2)" }] }),
        dimensions,
      },
      "m",
    );
    expect(missing.decision).toBe("no_fit");
    expect(missing.score).toBe(REQUIRED_NO_SCORE_CAP);
    // A composite under 70 turns the model's fit into a borderline.
    const weak = enforceAssessment(
      criteria,
      none,
      {
        ...answer({ decision: "fit" }),
        dimensions: { ...dimensions, role: { score: 40, note: "n", evidence: "e" } },
      },
      "m",
    );
    // 16 + 12 + 7.5 + 9.75 + 15 = 60.25.
    expect(weak.score).toBe(60);
    expect(weak.decision).toBe("borderline");
    // The model's own no_fit on a profile the rules cannot fault is the team's call: borderline, the composite kept.
    const unpinned = enforceAssessment(
      criteria,
      none,
      { ...answer({ decision: "no_fit" }), dimensions },
      "m",
    );
    expect(unpinned.decision).toBe("borderline");
    expect(unpinned.score).toBe(80);
  });

  it("clips the notes, the evidence and the lists, drops repeats, and keeps at most 5, 4 and 3 entries", () => {
    const assessment = enforceAssessment(
      criteria,
      none,
      {
        ...answer(),
        dimensions: {
          ...dimensions,
          role: { score: 71.6, note: ` ${"n".repeat(300)} `, evidence: "e".repeat(300) },
        },
        strengths: Array.from({ length: 8 }, (_, index) => `force ${index}`),
        concerns: ["a", "a", "b", "c", "d", "e"],
        questions: ["q1", "q2", "q3", "q4"],
      },
      "m",
    );
    expect(assessment.dimensions?.role.score).toBe(72);
    expect(assessment.dimensions?.role.note).toHaveLength(NOTE_MAX);
    expect(assessment.dimensions?.role.evidence).toHaveLength(EVIDENCE_MAX);
    expect(assessment.strengths).toHaveLength(STRENGTHS_MAX);
    expect(assessment.concerns).toEqual(["a", "b", "c", "d"]);
    expect(assessment.concerns).toHaveLength(CONCERNS_MAX);
    expect(assessment.questions).toHaveLength(QUESTIONS_MAX);
  });

  it("never stores a sentence about a protected characteristic or a career break, wherever the model put it", () => {
    const assessment = enforceAssessment(
      criteria,
      none,
      {
        ...answer(),
        dimensions: {
          ...dimensions,
          trajectory: {
            score: 60,
            note: "Un trou de deux ans entre 2019 et 2021.",
            evidence: "2019-2021 : rien",
          },
          seniority: { score: 80, note: "Au niveau.", evidence: "Âge : 45 ans" },
        },
        strengths: ["Dix ans de vente", "Jeune et dynamique (âge)"],
        concerns: ["Congé parental de 2020 à 2021", "Pas de management"],
        questions: ["Situation familiale ?", "Quel cycle de vente ?", "Nationalité ?"],
      },
      "m",
    );
    // A note and its evidence go together: either one forbidden drops both, and a score above neutral falls with its evidence.
    expect(assessment.dimensions?.trajectory).toEqual({ score: 50, note: "", evidence: null });
    expect(assessment.dimensions?.seniority).toEqual({ score: 50, note: "", evidence: null });
    expect(assessment.strengths).toEqual(["Dix ans de vente"]);
    expect(assessment.concerns).toEqual(["Pas de management"]);
    expect(assessment.questions).toEqual(["Quel cycle de vente ?"]);
    // Two dimensions, a strength, a concern and two questions: the card says six sentences were withheld.
    expect(assessment.withheld).toBe(6);
    expect("withheld" in enforceAssessment(criteria, none, { ...answer(), dimensions }, "m")).toBe(
      false,
    );
    expect(mentionsCareerBreak("Un gap de six mois")).toBe(true);
    expect(mentionsCareerBreak("Congé sabbatique")).toBe(true);
    expect(mentionsCareerBreak("Deux ans sans poste")).toBe(true);
    expect(mentionsCareerBreak("Un trou entre 2019 et 2021")).toBe(true);
    expect(mentionsCareerBreak("Trousseau de clés")).toBe(false);
    expect(forbiddenSentence("Date de naissance : 1980")).toBe(true);
    expect(forbiddenSentence("Née en 1975")).toBe(true);
    expect(forbiddenSentence("Mère de trois enfants")).toBe(true);
    expect(forbiddenSentence("Sa famille vit à Lyon")).toBe(true);
    expect(forbiddenSentence("Engagement politique local")).toBe(true);
    expect(forbiddenSentence("Dix ans en contrôle de gestion")).toBe(false);
  });

  it("keeps a recruiter's sentences about the job, where the wider words name a product, a policy or a sector", () => {
    for (const sentence of [
      "A défini la politique commerciale de la BU et doublé le CA",
      "Responsable d'une famille de produits de 12 M€",
      "Fixed race conditions in the scheduler",
      "Traçabilité de l'origine des produits",
      "Seniority gap next to the others",
      "Interruption de service réduite de 40 %",
      "Dix ans en petite enfance",
      "Homme de terrain, 20 % du temps chez les clients",
    ]) {
      expect(forbiddenSentence(sentence)).toBe(false);
      expect(mentionsCareerBreak(sentence)).toBe(false);
    }
    const assessment = enforceAssessment(
      criteria,
      none,
      {
        ...answer(),
        dimensions,
        strengths: [
          "A défini la politique commerciale de la BU",
          "Une famille de produits de 12 M€",
        ],
      },
      "m",
    );
    expect(assessment.strengths).toHaveLength(2);
    expect("withheld" in assessment).toBe(false);
  });
});

// ---------------------------------------------------------------------
// a quote the model was given
// ---------------------------------------------------------------------

const texts = [
  "Contrôleur de gestion",
  "Contrôleur de gestion Acme 2018-01 2024-06 Reporting mensuel, budgets et forecasts pour trois sites",
  "SAP FI/CO, Excel",
  "Anglais (C1)",
  "Lyon",
];

describe("evidenceGrounded", () => {
  it("finds a verbatim quote, case, accents and spacing apart, the whole of a short one", () => {
    expect(evidenceGrounded("Anglais (C1)", texts)).toBe(true);
    expect(evidenceGrounded("anglais c1", texts)).toBe(true);
    expect(evidenceGrounded("SAP FI/CO", texts)).toBe(true);
    expect(evidenceGrounded("CONTROLEUR DE GESTION ACME", texts)).toBe(true);
    expect(evidenceGrounded("Reporting mensuel,  budgets et forecasts", texts)).toBe(true);
    expect(GROUNDING_WINDOW).toBe(12);
  });

  it("accepts a position quoted with its company and its dates, which spans the fields of one experience", () => {
    expect(evidenceGrounded("Contrôleur de gestion chez Acme (2018-2024)", texts)).toBe(true);
  });

  it("refuses a paraphrase, an invention, a blank, and a quote spread over the whole profile", () => {
    expect(evidenceGrounded("Cinq années de pilotage budgétaire", texts)).toBe(false);
    expect(evidenceGrounded("Espagnol courant", texts)).toBe(false);
    expect(evidenceGrounded("Directeur financier chez Globex (2010-2018)", texts)).toBe(false);
    expect(evidenceGrounded("", texts)).toBe(false);
    expect(evidenceGrounded("   ", texts)).toBe(false);
    expect(evidenceGrounded("Anglais (C1)", [])).toBe(false);
    // Words found one here and one there are not a quote: 60% of them must sit in one text.
    expect(evidenceGrounded("Anglais parlé à Lyon avec Excel", texts)).toBe(false);
  });
});

describe("enforceAssessment: the quotes are checked against what the model was given", () => {
  it("keeps a yes whose quote is in the profile, and reads one whose quote is not as partial, marked unverified", () => {
    const grounded = enforceAssessment(criteria, none, answer(), "m", { texts });
    expect(grounded.requirements.map((row) => row.met)).toEqual(["yes", "yes", "yes"]);
    expect(grounded.requirements.some((row) => row.evidenceUnverified)).toBe(false);
    expect(grounded.decision).toBe("fit");
    const paraphrased = enforceAssessment(
      criteria,
      none,
      answer({
        requirements: [
          { criterionId: "skill", met: "yes", evidence: "Cinq années de pilotage budgétaire" },
          { criterionId: "lang", met: "yes", evidence: "Anglais (C1)" },
          { criterionId: "sap", met: "yes", evidence: "SAP FI/CO" },
        ],
      }),
      "m",
      { texts },
    );
    expect(paraphrased.requirements[0]).toEqual({
      criterionId: "skill",
      met: "partial",
      evidence: "Cinq années de pilotage budgétaire",
      evidenceUnverified: true,
    });
    expect(paraphrased.requirements[1]).toEqual({
      criterionId: "lang",
      met: "yes",
      evidence: "Anglais (C1)",
    });
    // A required requirement met only on a claim sends the profile to "to check".
    expect(paraphrased.decision).toBe("borderline");
    // Without the texts nothing is checked, as for an answer read before.
    expect(
      enforceAssessment(
        criteria,
        none,
        answer({
          requirements: [
            { criterionId: "skill", met: "yes", evidence: "Cinq années de pilotage budgétaire" },
          ],
        }),
        "m",
      ).requirements[0]?.met,
    ).toBe("yes");
  });

  it("never sets a profile aside on a quote the profile does not hold: such a no is unknown", () => {
    const invented = enforceAssessment(
      criteria,
      none,
      answer({
        requirements: [
          { criterionId: "skill", met: "yes", evidence: "Contrôleur de gestion Acme" },
          { criterionId: "lang", met: "no", evidence: "Espagnol courant, pas d'anglais" },
          { criterionId: "sap", met: "yes", evidence: "SAP FI/CO" },
        ],
        decision: "no_fit",
        score: 60,
      }),
      "m",
      { texts },
    );
    expect(invented.requirements[1]).toEqual({
      criterionId: "lang",
      met: "unknown",
      evidence: null,
    });
    expect(invented.decision).toBe("borderline");
    expect(invented.score).toBe(60);
    // The deterministic pass's own evidence still stands behind the no.
    const agreed = enforceAssessment(
      criteria,
      [{ criterionId: "lang", verdict: "missing", evidence: "Espagnol (C1), Italien (B2)" }],
      answer({
        requirements: [{ criterionId: "lang", met: "no", evidence: "Espagnol courant" }],
      }),
      "m",
      { texts },
    );
    expect(agreed.requirements[1]).toEqual({
      criterionId: "lang",
      met: "no",
      evidence: "Espagnol (C1), Italien (B2)",
    });
    expect(agreed.decision).toBe("no_fit");
    // A partial keeps its quote, marked.
    const partial = enforceAssessment(
      criteria,
      none,
      answer({
        requirements: [{ criterionId: "sap", met: "partial", evidence: "Oracle Financials" }],
      }),
      "m",
      { texts },
    );
    expect(partial.requirements[2]).toEqual({
      criterionId: "sap",
      met: "partial",
      evidence: "Oracle Financials",
      evidenceUnverified: true,
    });
  });

  it("brings a dimension scored on a quote the profile does not hold down to neutral, the quote kept and marked", () => {
    const assessment = enforceAssessment(
      criteria,
      none,
      {
        ...answer(),
        dimensions: {
          ...dimensions,
          role: {
            score: 90,
            note: "Métier tenu.",
            evidence: "Contrôleur de gestion chez Acme (2018-2024)",
          },
          seniority: {
            score: 80,
            note: "Au niveau.",
            evidence: "Directeur financier chez Globex (2010-2018)",
          },
        },
      },
      "m",
      { texts },
    );
    expect(assessment.dimensions?.role).toEqual({
      score: 90,
      note: "Métier tenu.",
      evidence: "Contrôleur de gestion chez Acme (2018-2024)",
    });
    expect(assessment.dimensions?.seniority).toEqual({
      score: 50,
      note: "Au niveau.",
      evidence: "Directeur financier chez Globex (2010-2018)",
      evidenceUnverified: true,
    });
  });

  it("carries the mark to the requirement rows a card shows", () => {
    const rows = requirementRows(
      criteria,
      result("a", {
        assessment: assessed("borderline", 60, [
          { criterionId: "skill", met: "partial", evidence: "x", evidenceUnverified: true },
          { criterionId: "lang", met: "yes", evidence: "Anglais (C1)" },
        ]),
      }),
    );
    expect(rows[0]).toMatchObject({ id: "skill", met: "partial", evidenceUnverified: true });
    expect("evidenceUnverified" in (rows[1] ?? {})).toBe(false);
  });
});

describe("enforceAssessment: a junior brief", () => {
  const roleAt = (met: string) =>
    answer({
      requirements: [
        { criterionId: "skill", met: "yes", evidence: "x" },
        { criterionId: "lang", met: "yes", evidence: "Anglais (C1)" },
        { criterionId: "sap", met: "yes", evidence: "SAP" },
        { criterionId: "role", met, evidence: null },
      ],
      decision: "fit",
      score: 100,
    });

  it("keeps the score of a role at unknown, the decision still at borderline so the team looks", () => {
    const junior = enforceAssessment(withRole, none, roleAt("unknown"), "m", { junior: true });
    expect(junior.decision).toBe("borderline");
    expect(junior.score).toBe(100);
    const senior = enforceAssessment(withRole, none, roleAt("unknown"), "m", { junior: false });
    expect(senior.score).toBe(ROLE_UNKNOWN_SCORE_CAP);
    expect(enforceAssessment(withRole, none, roleAt("unknown"), "m").score).toBe(
      ROLE_UNKNOWN_SCORE_CAP,
    );
  });
});

// ---------------------------------------------------------------------
// the second opinion
// ---------------------------------------------------------------------

describe("applyChallenge", () => {
  const retained: Assessment = { ...assessed("fit", 85), concerns: ["Pas de management"] };
  const doubt = {
    verdict: "doubt",
    reason: "Les dates des deux derniers postes se chevauchent.",
    evidence: "2019-2022 chez X et 2021-2024 chez Y",
  };

  it("sends a retained profile to borderline on a doubt with evidence, caps the score at 69, appends the reason, stores the challenge", () => {
    const after = applyChallenge(retained, doubt);
    expect(after.decision).toBe("borderline");
    expect(after.score).toBe(CHALLENGE_DOUBT_SCORE_CAP);
    expect(after.concerns).toEqual(["Pas de management", doubt.reason]);
    expect(after.challenge).toEqual({
      verdict: "doubt",
      reason: doubt.reason,
      evidence: doubt.evidence,
    });
    // The rest of the assessment is untouched; the input is not.
    expect(after.summary).toBe("s");
    expect(retained.decision).toBe("fit");
    expect(retained.concerns).toEqual(["Pas de management"]);
    // A score already under the cap stays; a reason already among the concerns is not repeated.
    expect(applyChallenge({ ...retained, score: 60 }, doubt).score).toBe(60);
    expect(applyChallenge({ ...retained, concerns: [doubt.reason] }, doubt).concerns).toEqual([
      doubt.reason,
    ]);
    expect(applyChallenge(assessed("fit", 85), doubt).concerns).toEqual([doubt.reason]);
  });

  it("never raises: a borderline stays borderline, a no_fit stays no_fit", () => {
    expect(applyChallenge(assessed("borderline", 60), doubt).decision).toBe("borderline");
    expect(applyChallenge(assessed("no_fit", 20), doubt).decision).toBe("no_fit");
    expect(applyChallenge(assessed("no_fit", 20), { verdict: "confirmed" }).decision).toBe(
      "no_fit",
    );
  });

  it("treats a doubt without evidence as confirmed and changes nothing: an opinion is not a fact", () => {
    for (const evidence of [undefined, null, "", "   "]) {
      const after = applyChallenge(retained, {
        verdict: "doubt",
        reason: "Je ne le sens pas.",
        evidence,
      });
      expect(after.decision).toBe("fit");
      expect(after.score).toBe(85);
      expect(after.concerns).toEqual(["Pas de management"]);
      expect(after.challenge).toEqual({ verdict: "confirmed", reason: null, evidence: null });
    }
    // Nor is a doubt without a reason.
    expect(
      applyChallenge(retained, { verdict: "doubt", evidence: "2019-2022" }).challenge?.verdict,
    ).toBe("confirmed");
  });

  it("stores a confirmation with its reason and changes nothing else; an unknown verdict reads as confirmed", () => {
    const after = applyChallenge(retained, {
      verdict: "confirmed",
      reason: "Le métier et les impératifs tiennent.",
    });
    expect(after.decision).toBe("fit");
    expect(after.score).toBe(85);
    expect(after.concerns).toEqual(["Pas de management"]);
    expect(after.challenge).toEqual({
      verdict: "confirmed",
      reason: "Le métier et les impératifs tiennent.",
      evidence: null,
    });
    expect(
      applyChallenge(retained, { verdict: "maybe", reason: "r", evidence: "e" }).challenge,
    ).toEqual({ verdict: "confirmed", reason: null, evidence: null });
  });

  it("refuses a doubt whose reason or evidence names a protected characteristic or a career break", () => {
    const aged = applyChallenge(retained, {
      verdict: "doubt",
      reason: "Trop âgé pour le poste (âge).",
      evidence: "Né en 1960",
    });
    expect(aged.decision).toBe("fit");
    expect(aged.challenge).toEqual({ verdict: "confirmed", reason: null, evidence: null });
    // Both sentences withheld: the count says so, on top of what the assessment already counted.
    expect(aged.withheld).toBe(2);
    expect(
      applyChallenge(
        { ...retained, withheld: 3 },
        { verdict: "doubt", reason: "Né en 1960.", evidence: "2019-2022" },
      ).withheld,
    ).toBe(4);
    const gap = applyChallenge(retained, {
      verdict: "doubt",
      reason: "Deux ans sans poste.",
      evidence: "Un trou entre 2019 et 2021",
    });
    expect(gap.decision).toBe("fit");
    expect(gap.challenge?.verdict).toBe("confirmed");
    expect("withheld" in applyChallenge(retained, doubt)).toBe(false);
  });

  it("treats a doubt whose quote is not in what the model was given as confirmed", () => {
    // The texts as payloadTexts() gives them: one per position, then the timeline of both.
    const given = [
      "Business developer X 2019-01 2022-06",
      "Account manager Y 2021-03 2024-01",
      "Business developer X 2019-01 2022-06 ; Account manager Y 2021-03 2024-01",
    ];
    const held = applyChallenge(retained, doubt, { texts: given });
    expect(held.decision).toBe("borderline");
    expect(held.challenge?.verdict).toBe("doubt");
    const invented = applyChallenge(retained, doubt, { texts: ["Contrôleur de gestion Acme"] });
    expect(invented.decision).toBe("fit");
    expect(invented.score).toBe(85);
    expect(invented.challenge).toEqual({ verdict: "confirmed", reason: null, evidence: null });
    expect(invented.concerns).toEqual(["Pas de management"]);
  });

  it("clips the reason and the evidence", () => {
    const after = applyChallenge(retained, {
      verdict: "doubt",
      reason: ` ${"r".repeat(300)} `,
      evidence: "e".repeat(300),
    });
    expect(after.challenge?.reason).toHaveLength(NOTE_MAX);
    expect(after.challenge?.evidence).toHaveLength(EVIDENCE_MAX);
    expect(after.decision).toBe("borderline");
  });
});
