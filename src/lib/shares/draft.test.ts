import { describe, expect, it } from "vitest";

import type { Assessment, BriefCriterion, MatchResult, ShareItem } from "@/lib/db/types";

import {
  attentionFrom,
  attentionOf,
  briefSnapshot,
  challengeReason,
  cleanItems,
  languageLabel,
  latestDocumentByCandidate,
  matchByCandidate,
  mergeDraft,
  metCount,
  orderedCandidates,
  plainDraft,
  plainItem,
  questionsOf,
  requirementsOf,
  strengthsFrom,
  strengthsOf,
  summaryAnswer,
  summaryMaxTokens,
  summaryPayload,
  summarySystemPrompt,
  unique,
  type DraftCandidate,
} from "./draft";

const ana: DraftCandidate = {
  id: "11111111-1111-4111-8111-111111111111",
  full_name: "  Ana Costa ",
  headline: "Développeuse back-end",
  summary: "Huit ans sur des API Node.",
  skills: ["Node.js", "PostgreSQL", " ", "Docker", "Kubernetes", "Terraform", "Go", "Rust", "GraphQL", "Redis", "Kafka"],
  languages: [
    { name: "Français", level: "native" },
    { name: "Anglais", level: "C1" },
  ],
  location: "Lyon",
  years_experience: 8,
  availability: null,
};

const anon: DraftCandidate = {
  id: "22222222-2222-4222-8222-222222222222",
  full_name: null,
  headline: null,
  summary: null,
  skills: [],
  languages: [],
  location: null,
  years_experience: null,
  availability: null,
};

const criteria: BriefCriterion[] = [
  { id: "c1", kind: "skill", label: "Node.js en production", value: "node", required: true, weight: 3 },
  { id: "c2", kind: "language", label: "Anglais courant", value: "C1", required: true, weight: 2 },
  { id: "c3", kind: "skill", label: "Kubernetes", value: "kubernetes", required: false, weight: 1 },
  { id: "c4", kind: "availability", label: "Disponible sous un mois", value: "1", required: false, weight: 1 },
];

const brief = { title: "Back-end senior", description: "API Node en prod.", criteria };

const deterministic: MatchResult = {
  candidateId: ana.id,
  score: 75,
  coverage: 0.75,
  blocked: false,
  verdicts: [
    { criterionId: "c1", verdict: "match", evidence: "Node.js, 8 ans" },
    { criterionId: "c2", verdict: "partial", evidence: "Anglais B2" },
    { criterionId: "c3", verdict: "missing", evidence: null },
    { criterionId: "c4", verdict: "not_stated", evidence: null },
  ],
  why: null,
  retrieval: { textRank: 1, vectorRank: null },
};

const assessment: Assessment = {
  decision: "borderline",
  score: 68.4,
  summary: "Huit ans d'API Node en production. L'anglais est noté B2.",
  requirements: [
    { criterionId: "c1", met: "yes", evidence: "API Node en production depuis 2018" },
    { criterionId: "c2", met: "partial", evidence: "Anglais B2" },
    { criterionId: "c3", met: "no", evidence: "Docker seulement" },
  ],
  model: "test-model",
};

const assessed: MatchResult = { ...deterministic, assessment };

/** The senior recruiter's reading, as an assessment carries it since the five dimensions; `assessment` above is one made before. */
const reading: Assessment = {
  ...assessment,
  strengths: ["Huit ans d'API Node en production", " Anglais B2 à l'écrit et à l'oral ", " ", "Huit ans d'API Node en production"],
  concerns: ["Kubernetes vu en formation seulement"],
  questions: ["Quel rôle sur les mises en production ?", "Niveau d'anglais à l'oral"],
  challenge: { verdict: "doubt", reason: "Les trois derniers postes sont en agence, pas en produit", evidence: "2019-2024 : agence" },
};

const read: MatchResult = { ...deterministic, assessment: reading };

/**
 * Two sentences of the model the analysis did not find in Ana's CV, short
 * enough that an attention point would write them after its label.
 */
const nodeClaim = "Node.js en production chez un grand compte";
const kubernetesClaim = "Kubernetes sur plusieurs projets";

/**
 * An assessment whose quotes the analysis could not find in the CV: the
 * brief page shows them marked, the dossier leaves them out. "Anglais
 * courant" and the availability were left to the deterministic verdicts.
 */
const unverified: Assessment = {
  ...assessment,
  requirements: [
    { criterionId: "c1", met: "yes", evidence: nodeClaim, evidenceUnverified: true },
    { criterionId: "c3", met: "partial", evidence: kubernetesClaim, evidenceUnverified: true },
  ],
};

const unquoted: MatchResult = { ...deterministic, assessment: unverified };

const noMatch = { candidate: ana, documentId: "doc-1", match: null };

describe("requirementsOf", () => {
  it("builds one row per criterion from the assessment; a criterion the model skipped reads its deterministic verdict", () => {
    const rows = requirementsOf(criteria, assessed);
    expect(rows).toEqual([
      { label: "Node.js en production", required: true, met: "yes", evidence: "API Node en production depuis 2018" },
      { label: "Anglais courant", required: true, met: "partial", evidence: "Anglais B2" },
      { label: "Kubernetes", required: false, met: "no", evidence: "Docker seulement" },
      { label: "Disponible sous un mois", required: false, met: "unknown", evidence: null },
    ]);
  });

  it("shows what the shortlist board shows for a skipped criterion the deterministic pass found", () => {
    const skippedFirst: MatchResult = { ...deterministic, assessment: { ...assessment, requirements: assessment.requirements.slice(1) } };
    const rows = requirementsOf(criteria, skippedFirst);
    expect(rows[0]).toEqual({ label: "Node.js en production", required: true, met: "yes", evidence: "Node.js, 8 ans" });
    expect(rows[1]?.evidence).toBe("Anglais B2");
    expect(rows.map((row) => row.met)).toEqual(["yes", "partial", "no", "unknown"]);
  });

  it("falls back on the verdicts when the assessment holds no row, and gives no row to a criterion neither speaks of", () => {
    const emptyAssessment: MatchResult = { ...deterministic, assessment: { ...assessment, requirements: [] } };
    expect(requirementsOf(criteria, emptyAssessment).map((row) => row.met)).toEqual(["yes", "partial", "no", "unknown"]);
    // A criterion added to the brief since the analysis was never checked: it is not "not stated", it is absent.
    const onlyFirst: MatchResult = { ...deterministic, verdicts: deterministic.verdicts.slice(0, 1) };
    expect(requirementsOf(criteria, onlyFirst).map((row) => row.label)).toEqual(["Node.js en production"]);
  });

  it("reads the rows against the criteria the match carries, not the brief's current ones", () => {
    const snapshot: MatchResult = {
      ...assessed,
      criteria: [
        { id: "c1", kind: "skill", label: "Node.js (au moment de l'analyse)", value: "node", required: true, weight: 3 },
        { id: "c3", kind: "skill", label: "Kubernetes", value: "kubernetes", required: true, weight: 2 },
      ],
    };
    const renamed = criteria.map((criterion) => ({ ...criterion, label: `${criterion.label} (renommé)` }));
    const rows = requirementsOf(renamed, snapshot);
    expect(rows.map((row) => `${row.label}:${row.met}:${row.required}`)).toEqual([
      "Node.js (au moment de l'analyse):yes:true",
      "Kubernetes:no:true",
    ]);
    // A snapshot the parser cannot read falls back on the brief's criteria.
    const broken = { ...assessed, criteria: "nope" } as unknown as MatchResult;
    expect(requirementsOf(criteria, broken)).toHaveLength(4);
  });

  it("maps the deterministic verdicts when no model answered", () => {
    const rows = requirementsOf(criteria, deterministic);
    expect(rows.map((row) => row.met)).toEqual(["yes", "partial", "no", "unknown"]);
    expect(rows[0]?.evidence).toBe("Node.js, 8 ans");
    expect(rows[3]?.evidence).toBeNull();
  });

  it("keeps the mark of an answer whose sentence the analysis did not find in the CV, and gives it no evidence", () => {
    const rows = requirementsOf(criteria, unquoted);
    expect(rows).toEqual([
      { label: "Node.js en production", required: true, met: "yes", evidence: null },
      { label: "Anglais courant", required: true, met: "partial", evidence: "Anglais B2" },
      { label: "Kubernetes", required: false, met: "partial", evidence: null },
      { label: "Disponible sous un mois", required: false, met: "unknown", evidence: null },
    ]);
    expect(JSON.stringify(rows)).not.toContain(nodeClaim);
    expect(JSON.stringify(rows)).not.toContain(kubernetesClaim);
  });

  it("keeps a quote the analysis found in the CV, and a deterministic verdict's evidence beside an unverified answer", () => {
    const found: MatchResult = {
      ...deterministic,
      assessment: {
        ...assessment,
        requirements: [
          { criterionId: "c1", met: "yes", evidence: "API Node en production depuis 2018", evidenceUnverified: false },
        ],
      },
    };
    expect(requirementsOf(criteria, found)[0]).toEqual({
      label: "Node.js en production",
      required: true,
      met: "yes",
      evidence: "API Node en production depuis 2018",
    });
    // The assessment left "Anglais courant" to the verdicts: the CV's own field stays its evidence.
    expect(requirementsOf(criteria, unquoted)[1]?.evidence).toBe("Anglais B2");
  });

  it("answers nothing without a match or when neither the assessment nor the verdicts hold a row", () => {
    expect(requirementsOf(criteria, null)).toEqual([]);
    expect(requirementsOf(criteria, { ...deterministic, verdicts: [] })).toEqual([]);
    expect(requirementsOf(criteria, { ...deterministic, verdicts: [], assessment: { ...assessment, requirements: [] } })).toEqual([]);
  });

  it("reads a malformed stored match as no analysis instead of failing the dossier", () => {
    const broken = { ...deterministic, verdicts: undefined, assessment: { ...assessment, requirements: undefined } } as unknown as MatchResult;
    expect(requirementsOf(criteria, broken)).toEqual([]);
    expect(plainItem({ candidate: ana, documentId: null, match: broken }, criteria, "fr").requirements).toEqual([]);
    const oddRows = {
      ...deterministic,
      verdicts: [{ criterionId: "c1", verdict: "maybe", evidence: 42 }, { verdict: "match", evidence: "x" }],
    } as unknown as MatchResult;
    expect(requirementsOf(criteria, oddRows)).toEqual([{ label: "Node.js en production", required: true, met: "unknown", evidence: null }]);
  });

  it("names a criterion by its value when it has no label, and leaves out one with neither, as the cover does", () => {
    const rows = requirementsOf([{ ...criteria[0], label: " " } as BriefCriterion], deterministic);
    expect(rows[0]?.label).toBe("node");
    const blank: BriefCriterion = { id: "c5", kind: "other", label: " ", value: " ", required: true, weight: 1 };
    expect(requirementsOf([...criteria, blank], deterministic)).toHaveLength(4);
  });
});

describe("strengthsFrom, attentionFrom and metCount", () => {
  const rows = requirementsOf(criteria, assessed);

  it("reads the strengths off the requirements met", () => {
    expect(strengthsFrom(rows)).toEqual(["Node.js en production"]);
    expect(metCount(rows)).toBe(1);
  });

  it("lists the requirements not met then met in part, with a short evidence, never the not stated ones", () => {
    expect(attentionFrom(rows)).toEqual(["Kubernetes — Docker seulement", "Anglais courant — Anglais B2"]);
    const long = rows.map((row) => (row.met === "no" ? { ...row, evidence: "x".repeat(120) } : row));
    expect(attentionFrom(long)[0]).toBe("Kubernetes");
  });

  it("caps both lists", () => {
    const many = Array.from({ length: 9 }, (_, i) => ({ label: `R${i}`, required: false, met: "yes" as const, evidence: null }));
    expect(strengthsFrom(many)).toHaveLength(5);
    expect(attentionFrom(many.map((row) => ({ ...row, met: "no" as const })))).toHaveLength(5);
  });

  it("never writes into a point a sentence the analysis did not find in the CV, however short", () => {
    const partly = attentionFrom(requirementsOf(criteria, unquoted));
    expect(partly).toEqual(["Anglais courant — Anglais B2", "Kubernetes"]);
    // An unverified "no", as an assessment stored before the analysis dropped such a quote holds it: the label alone.
    const notMet: MatchResult = {
      ...deterministic,
      assessment: {
        ...assessment,
        requirements: [{ criterionId: "c3", met: "no", evidence: kubernetesClaim, evidenceUnverified: true }],
      },
    };
    const missing = attentionFrom(requirementsOf(criteria, notMet));
    expect(missing).toEqual(["Kubernetes", "Anglais courant — Anglais B2"]);
    for (const point of [...partly, ...missing]) {
      expect(point).not.toContain(nodeClaim);
      expect(point).not.toContain(kubernetesClaim);
    }
  });
});

describe("strengthsOf, attentionOf, questionsOf and challengeReason", () => {
  it("reads the recruiter's lists cleaned: trimmed, each once, blanks dropped", () => {
    expect(strengthsOf(reading)).toEqual(["Huit ans d'API Node en production", "Anglais B2 à l'écrit et à l'oral"]);
    expect(questionsOf(reading)).toEqual(["Quel rôle sur les mises en production ?", "Niveau d'anglais à l'oral"]);
  });

  it("adds the second opinion's doubt after the reservations, and nothing when it confirmed or gave no reason", () => {
    expect(challengeReason(reading)).toBe("Les trois derniers postes sont en agence, pas en produit");
    expect(attentionOf(reading)).toEqual([
      "Kubernetes vu en formation seulement",
      "Les trois derniers postes sont en agence, pas en produit",
    ]);
    const confirmed: Assessment = { ...reading, challenge: { verdict: "confirmed", reason: "Rien à redire", evidence: null } };
    expect(challengeReason(confirmed)).toBeNull();
    expect(attentionOf(confirmed)).toEqual(["Kubernetes vu en formation seulement"]);
    const silent: Assessment = { ...reading, challenge: { verdict: "doubt", reason: "  ", evidence: null } };
    expect(challengeReason(silent)).toBeNull();
    expect(attentionOf({ ...reading, concerns: [] })).toEqual(["Les trois derniers postes sont en agence, pas en produit"]);
  });

  it("answers nothing for an assessment made before the reading, none at all, or a malformed stored one", () => {
    expect(strengthsOf(assessment)).toEqual([]);
    expect(attentionOf(assessment)).toEqual([]);
    expect(questionsOf(assessment)).toEqual([]);
    expect(challengeReason(assessment)).toBeNull();
    expect(strengthsOf(null)).toEqual([]);
    expect(questionsOf(undefined)).toEqual([]);
    const odd = { strengths: "Node", concerns: [3, null, "Réserve"], questions: { a: 1 }, challenge: "doubt" } as unknown as Assessment;
    expect(strengthsOf(odd)).toEqual([]);
    expect(attentionOf(odd)).toEqual(["Réserve"]);
    expect(questionsOf(odd)).toEqual([]);
    expect(challengeReason(odd)).toBeNull();
  });

  it("caps the lists: eight points, five questions, three hundred characters each", () => {
    const many = Array.from({ length: 12 }, (_, i) => `P${i}`);
    expect(strengthsOf({ strengths: many })).toHaveLength(8);
    expect(attentionOf({ concerns: many, challenge: { verdict: "doubt", reason: "Doute", evidence: null } })).toHaveLength(8);
    expect(questionsOf({ questions: many })).toHaveLength(5);
    expect(strengthsOf({ strengths: ["x".repeat(400)] })[0]).toHaveLength(300);
  });
});

describe("plainItem", () => {
  it("copies the profile and the assessment: facts, table, score, decision, the model's summary", () => {
    const item = plainItem({ candidate: ana, documentId: "doc-1", match: assessed }, criteria, "fr");
    expect(item.name).toBe("Ana Costa");
    expect(item.headline).toBe("Développeuse back-end");
    expect(item.location).toBe("Lyon");
    expect(item.yearsExperience).toBe(8);
    expect(item.availability).toBeNull();
    expect(item.skills).toEqual(["Node.js", "PostgreSQL", "Docker", "Kubernetes", "Terraform", "Go", "Rust", "GraphQL"]);
    expect(item.languages).toEqual(["Français (native)", "Anglais (C1)"]);
    expect(item.summary).toBe("Huit ans d'API Node en production. L'anglais est noté B2.");
    expect(item.score).toBe(68);
    expect(item.decision).toBe("borderline");
    expect(item.requirements).toHaveLength(4);
    expect(item.strengths).toEqual(["Node.js en production"]);
    expect(item.attention).toEqual(["Kubernetes — Docker seulement", "Anglais courant — Anglais B2"]);
    expect(item.questions).toEqual([]);
    expect(item.documentId).toBe("doc-1");
  });

  it("takes the recruiter's reading when the assessment carries one: strengths, reservations with the doubt last, questions", () => {
    const item = plainItem({ candidate: ana, documentId: null, match: read }, criteria, "fr");
    expect(item.strengths).toEqual(["Huit ans d'API Node en production", "Anglais B2 à l'écrit et à l'oral"]);
    expect(item.attention).toEqual(["Kubernetes vu en formation seulement", "Les trois derniers postes sont en agence, pas en produit"]);
    expect(item.questions).toEqual(["Quel rôle sur les mises en production ?", "Niveau d'anglais à l'oral"]);
    // The table, the score, the decision and the synthesis are the assessment's as before.
    expect(item.requirements).toHaveLength(4);
    expect(item.score).toBe(68);
    expect(item.summary).toBe(reading.summary);
  });

  it("falls back on the table for a reading that lists nothing, and never asks a question of its own", () => {
    const empty: MatchResult = { ...deterministic, assessment: { ...assessment, strengths: [], concerns: [], questions: [] } };
    const item = plainItem({ candidate: ana, documentId: null, match: empty }, criteria, "fr");
    expect(item.strengths).toEqual(["Node.js en production"]);
    expect(item.attention).toEqual(["Kubernetes — Docker seulement", "Anglais courant — Anglais B2"]);
    expect(item.questions).toEqual([]);
    // The doubt alone is an attention point; the strengths still come off the table.
    const doubtOnly: MatchResult = { ...deterministic, assessment: { ...reading, strengths: [], concerns: [] } };
    expect(plainItem({ candidate: ana, documentId: null, match: doubtOnly }, criteria, "fr").attention).toEqual([
      "Les trois derniers postes sont en agence, pas en produit",
    ]);
    expect(plainItem({ candidate: ana, documentId: null, match: doubtOnly }, criteria, "fr").strengths).toEqual(["Node.js en production"]);
  });

  it("falls back on the deterministic verdicts and the profile's summary without an assessment", () => {
    const item = plainItem({ candidate: ana, documentId: null, match: deterministic }, criteria, "fr");
    expect(item.summary).toBe("Huit ans sur des API Node.");
    expect(item.score).toBeNull();
    expect(item.decision).toBeNull();
    expect(item.requirements.map((row) => row.met)).toEqual(["yes", "partial", "no", "unknown"]);
    expect(item.strengths).toEqual(["Node.js en production"]);
    expect(item.attention).toEqual(["Kubernetes", "Anglais courant — Anglais B2"]);
  });

  it("takes the search's reading as the synthesis when a model matched the profile without assessing it", () => {
    const why = "  Profil Node solide ;  l'anglais reste à vérifier. ";
    const item = plainItem({ candidate: ana, documentId: null, match: { ...deterministic, why } }, criteria, "fr");
    expect(item.summary).toBe("Profil Node solide ; l'anglais reste à vérifier.");
    expect(plainItem({ candidate: ana, documentId: null, match: { ...assessed, why } }, criteria, "fr").summary).toBe(assessment.summary);
  });

  it("carries into the sheet no sentence the analysis did not find in the CV: the table and the points keep the marks", () => {
    const item = plainItem({ candidate: ana, documentId: null, match: unquoted }, criteria, "fr");
    expect(item.requirements.map((row) => `${row.label}:${row.met}:${row.evidence}`)).toEqual([
      "Node.js en production:yes:null",
      "Anglais courant:partial:Anglais B2",
      "Kubernetes:partial:null",
      "Disponible sous un mois:unknown:null",
    ]);
    // The mark stays, so the requirement met is still a strength, named by the brief's label, not by the model's sentence.
    expect(item.strengths).toEqual(["Node.js en production"]);
    expect(item.attention).toEqual(["Anglais courant — Anglais B2", "Kubernetes"]);
    expect(JSON.stringify(item)).not.toContain(nodeClaim);
    expect(JSON.stringify(item)).not.toContain(kubernetesClaim);
  });

  it("keeps the first skills as strengths and no attention point when the shortlist holds no analysis", () => {
    const item = plainItem(noMatch, criteria, "fr");
    expect(item.requirements).toEqual([]);
    expect(item.strengths).toEqual(["Node.js", "PostgreSQL", "Docker", "Kubernetes", "Terraform"]);
    expect(item.attention).toEqual([]);
    expect(item.score).toBeNull();
  });

  it("names a nameless profile in the organisation's language and leaves the rest empty or null", () => {
    expect(plainItem({ candidate: anon, documentId: null, match: null }, criteria, "fr").name).toBe("Candidat");
    const item = plainItem({ candidate: anon, documentId: null, match: null }, criteria, "en");
    expect(item.name).toBe("Candidate");
    expect(item.headline).toBeNull();
    expect(item.location).toBeNull();
    expect(item.yearsExperience).toBeNull();
    expect(item.summary).toBe("");
    expect(item.skills).toEqual([]);
    expect(item.languages).toEqual([]);
    expect(item.strengths).toEqual([]);
  });
});

describe("languageLabel", () => {
  it("writes the level in brackets and the name alone otherwise", () => {
    expect(languageLabel({ name: "Anglais", level: "C1" })).toBe("Anglais (C1)");
    expect(languageLabel({ name: " Espagnol ", level: null })).toBe("Espagnol");
    expect(languageLabel({ name: " ", level: "B2" })).toBe("");
  });
});

describe("unique, orderedCandidates, latestDocumentByCandidate, matchByCandidate", () => {
  it("keeps each value once in order", () => {
    expect(unique(["b", "a", "b", "c", "a"])).toEqual(["b", "a", "c"]);
  });

  it("follows the ids given, once each, skipping unknown ones", () => {
    const rows = orderedCandidates([anon.id, "nope", ana.id, anon.id], [ana, anon]);
    expect(rows.map((row) => row.id)).toEqual([anon.id, ana.id]);
  });

  it("keeps the first document per candidate (rows come newest first)", () => {
    const map = latestDocumentByCandidate([
      { id: "d3", candidate_id: ana.id },
      { id: "d2", candidate_id: ana.id },
      { id: "d1", candidate_id: anon.id },
      { id: "d0", candidate_id: null },
    ]);
    expect(map.get(ana.id)).toBe("d3");
    expect(map.get(anon.id)).toBe("d1");
    expect(map.size).toBe(2);
  });

  it("keeps the first match per candidate, null when the item has none", () => {
    const map = matchByCandidate([
      { candidate_id: ana.id, match: assessed },
      { candidate_id: ana.id, match: null },
      { candidate_id: anon.id, match: null },
    ]);
    expect(map.get(ana.id)).toBe(assessed);
    expect(map.get(anon.id)).toBeNull();
  });
});

describe("plainDraft", () => {
  it("builds one item per candidate with its latest document and its match", () => {
    const items = plainDraft([ana, anon], new Map([[ana.id, "d3"]]), new Map([[ana.id, assessed]]), criteria, "fr");
    expect(items).toHaveLength(2);
    expect(items[0]?.documentId).toBe("d3");
    expect(items[0]?.score).toBe(68);
    expect(items[1]?.documentId).toBeNull();
    expect(items[1]?.requirements).toEqual([]);
  });
});

describe("briefSnapshot", () => {
  it("keeps the title, the description with its paragraphs, and the requirements' labels", () => {
    const snapshot = briefSnapshot({ ...brief, description: "Contexte.\r\n\r\n\r\nAttentes :   API   Node." });
    expect(snapshot.title).toBe("Back-end senior");
    expect(snapshot.summary).toBe("Contexte.\n\nAttentes : API Node.");
    expect(snapshot.requirements).toEqual([
      { label: "Node.js en production", required: true },
      { label: "Anglais courant", required: true },
      { label: "Kubernetes", required: false },
      { label: "Disponible sous un mois", required: false },
    ]);
  });

  it("clips and drops what has no label", () => {
    const snapshot = briefSnapshot({
      title: "x".repeat(300),
      description: "y".repeat(2000),
      criteria: [{ id: "c", kind: "other", label: " ", value: " ", required: true, weight: 1 }],
    });
    expect(snapshot.title).toHaveLength(200);
    expect(snapshot.summary).toHaveLength(1500);
    expect(snapshot.requirements).toEqual([]);
  });
});

describe("summaryPayload", () => {
  it("sends only what the profile gave, the brief's requirements and the assessment when there is one", () => {
    const payload = summaryPayload(brief, [ana, anon], new Map([[ana.id, assessed]]));
    expect(payload.brief.requirements[0]).toEqual({ label: "Node.js en production", value: "node", required: true, weight: 3 });
    const first = payload.candidates[0] ?? {};
    expect(first["candidateId"]).toBe(ana.id);
    expect(first["languages"]).toEqual(["Français (native)", "Anglais (C1)"]);
    expect(first["yearsExperience"]).toBe(8);
    expect("availability" in first).toBe(false);
    const assessment = first["assessment"] as { decision: string; score: number; requirements: { label: string; met: string }[] };
    expect(assessment.decision).toBe("borderline");
    expect(assessment.score).toBe(68.4);
    expect(assessment.requirements.map((row) => `${row.label}:${row.met}`)).toEqual([
      "Node.js en production:yes",
      "Anglais courant:partial",
      "Kubernetes:no",
      "Disponible sous un mois:unknown",
    ]);
    const second = payload.candidates[1] ?? {};
    expect(Object.keys(second)).toEqual(["candidateId"]);
  });

  it("sends the model no sentence the analysis did not find in the CV as the evidence quoted from it", () => {
    const payload = summaryPayload(brief, [ana], new Map([[ana.id, unquoted]]));
    const sent = (payload.candidates[0] ?? {})["assessment"] as { requirements: { label: string; evidence: string | null }[] };
    expect(sent.requirements.map((row) => row.evidence)).toEqual([null, "Anglais B2", null, null]);
    expect(JSON.stringify(payload)).not.toContain(nodeClaim);
    expect(JSON.stringify(payload)).not.toContain(kubernetesClaim);
  });

  it("sends no assessment for a candidate the shortlist never analysed", () => {
    const payload = summaryPayload(brief, [ana]);
    expect("assessment" in (payload.candidates[0] ?? {})).toBe(false);
  });

  it("sends the recruiter's reading with the assessment, as the plain draft holds it, and nothing of it for an older one", () => {
    const payload = summaryPayload(brief, [ana], new Map([[ana.id, read]]));
    const sent = (payload.candidates[0] ?? {})["assessment"] as Record<string, unknown>;
    expect(sent["strengths"]).toEqual(["Huit ans d'API Node en production", "Anglais B2 à l'écrit et à l'oral"]);
    expect(sent["concerns"]).toEqual(["Kubernetes vu en formation seulement", "Les trois derniers postes sont en agence, pas en produit"]);
    expect(sent["questions"]).toEqual(["Quel rôle sur les mises en production ?", "Niveau d'anglais à l'oral"]);
    const older = (summaryPayload(brief, [ana], new Map([[ana.id, assessed]])).candidates[0] ?? {})["assessment"] as Record<string, unknown>;
    expect(Object.keys(older)).toEqual(["decision", "score", "summary", "requirements"]);
  });
});

describe("summarySystemPrompt", () => {
  it("asks for the organisation's language, forbids protected characteristics and fixes the table", () => {
    expect(summarySystemPrompt("fr")).toContain("in French");
    expect(summarySystemPrompt("en")).toContain("in English");
    expect(summarySystemPrompt("fr")).toMatch(/protected characteristic/);
    expect(summarySystemPrompt("fr")).toMatch(/JSON only/);
    expect(summarySystemPrompt("fr")).toMatch(/requirement table is fixed/);
  });

  it("asks for the questions and binds the recruiter's lists to their facts", () => {
    const prompt = summarySystemPrompt("fr");
    expect(prompt).toContain('"questions":["..."]');
    expect(prompt).toMatch(/add no fact/);
    expect(prompt).toMatch(/invent no new point/);
  });
});

describe("summaryAnswer", () => {
  it("fills what the model left out", () => {
    const parsed = summaryAnswer.parse({ items: [{ candidateId: ana.id }] });
    expect(parsed.items[0]).toEqual({ candidateId: ana.id, summary: "", strengths: [], attention: [], questions: [] });
  });
});

describe("summaryMaxTokens", () => {
  it("grows with the candidates and stays bounded", () => {
    expect(summaryMaxTokens(1)).toBe(920);
    expect(summaryMaxTokens(30)).toBe(8000);
  });
});

describe("mergeDraft", () => {
  const items = plainDraft([ana, anon], new Map(), new Map([[ana.id, assessed]]), criteria, "fr");

  it("takes the model's summary, strengths and attention and keeps the table, the score and the decision", () => {
    const merged = mergeDraft(items, {
      items: [
        {
          candidateId: ana.id,
          summary: "  Huit ans d'API Node.  Maîtrise PostgreSQL. ",
          strengths: ["Node.js en production", "PostgreSQL", "Anglais C1", "Lyon", "Un de trop"],
          attention: ["Le CV ne mentionne pas Kubernetes en production", "", "Disponibilité non précisée", "Un de trop", "Deux de trop"],
          questions: [],
        },
      ],
    });
    expect(merged[0]?.summary).toBe("Huit ans d'API Node. Maîtrise PostgreSQL.");
    expect(merged[0]?.strengths).toEqual(["Node.js en production", "PostgreSQL", "Anglais C1", "Lyon"]);
    expect(merged[0]?.attention).toEqual(["Le CV ne mentionne pas Kubernetes en production", "Disponibilité non précisée", "Un de trop"]);
    expect(merged[0]?.questions).toEqual([]);
    expect(merged[0]?.requirements).toEqual(items[0]?.requirements);
    expect(merged[0]?.score).toBe(68);
    expect(merged[0]?.decision).toBe("borderline");
    expect(merged[0]?.languages).toEqual(items[0]?.languages);
    expect(merged[1]).toEqual(items[1]);
  });

  it("keeps the plain draft, the recruiter's lists included, where the model answered nothing", () => {
    const merged = mergeDraft(items, { items: [{ candidateId: ana.id, summary: "", strengths: [], attention: [], questions: [] }] });
    expect(merged[0]?.summary).toBe(items[0]?.summary);
    expect(merged[0]?.strengths).toEqual(items[0]?.strengths);
    expect(merged[0]?.attention).toEqual(items[0]?.attention);
    const drafted = plainDraft([ana], new Map(), new Map([[ana.id, read]]), criteria, "fr");
    const kept = mergeDraft(drafted, { items: [{ candidateId: ana.id, summary: "", strengths: [], attention: [], questions: [] }] });
    expect(kept[0]?.attention).toEqual(drafted[0]?.attention);
    expect(kept[0]?.questions).toEqual(drafted[0]?.questions);
  });

  it("takes the model's reworded questions, five at most, and leaves them editable like the other lists", () => {
    const drafted = plainDraft([ana], new Map(), new Map([[ana.id, read]]), criteria, "fr");
    const merged = mergeDraft(drafted, {
      items: [
        {
          candidateId: ana.id,
          summary: "",
          strengths: [],
          attention: [],
          questions: [" Quel a été son rôle dans les mises en production ? ", "", "Niveau d'anglais à l'oral", "Q3", "Q4", "Q5", "Q6"],
        },
      ],
    });
    expect(merged[0]?.questions).toEqual(["Quel a été son rôle dans les mises en production ?", "Niveau d'anglais à l'oral", "Q3", "Q4", "Q5"]);
    expect(merged[0]?.strengths).toEqual(drafted[0]?.strengths);
  });
});

describe("cleanItems", () => {
  const raw = (over: Partial<ShareItem>): ShareItem => ({
    candidateId: ana.id,
    name: " Ana ",
    headline: " ",
    location: null,
    yearsExperience: null,
    availability: null,
    skills: [],
    languages: [],
    summary: " ok ",
    strengths: [],
    attention: [],
    questions: [],
    score: null,
    decision: null,
    requirements: [],
    documentId: "d3",
    ...over,
  });

  it("trims, drops empty points and nameless items, and keeps the document id", () => {
    const cleaned = cleanItems([
      raw({ strengths: ["a", " ", "a", "b"], attention: [""], questions: [" q ", "q"] }),
      raw({ candidateId: anon.id, name: "   ", documentId: null }),
    ]);
    expect(cleaned).toHaveLength(1);
    expect(cleaned[0]).toEqual({
      candidateId: ana.id,
      name: "Ana",
      headline: null,
      location: null,
      yearsExperience: null,
      availability: null,
      skills: [],
      languages: [],
      summary: "ok",
      strengths: ["a", "b"],
      attention: [],
      questions: ["q"],
      score: null,
      decision: null,
      requirements: [],
      documentId: "d3",
    });
  });

  it("keeps five questions of three hundred characters at most", () => {
    const [item] = cleanItems([raw({ questions: Array.from({ length: 7 }, (_, i) => `q${i}`.padEnd(400, "x")) })]);
    expect(item?.questions).toHaveLength(5);
    expect(item?.questions[0]).toHaveLength(300);
  });

  it("clips the facts, the lists, the score and the requirement rows", () => {
    const [item] = cleanItems([
      raw({
        location: ` ${"L".repeat(250)} `,
        yearsExperience: 123.6,
        availability: "  dès   que possible ",
        skills: Array.from({ length: 15 }, (_, i) => `s${i}`.padEnd(70, "x")),
        languages: Array.from({ length: 12 }, (_, i) => `l${i}`),
        score: 101.4,
        decision: "no_fit",
        requirements: [
          ...Array.from({ length: 45 }, (_, i) => ({ label: `R${i}`, required: i % 2 === 0, met: "yes" as const, evidence: "e".repeat(300) })),
          { label: " ", required: true, met: "yes" as const, evidence: null },
          { label: "Bad mark", required: true, met: "maybe" as never, evidence: null },
        ],
      }),
    ]);
    expect(item?.location).toHaveLength(200);
    expect(item?.yearsExperience).toBe(80);
    expect(item?.availability).toBe("dès que possible");
    expect(item?.skills).toHaveLength(12);
    expect(item?.skills[0]).toHaveLength(60);
    expect(item?.languages).toHaveLength(10);
    expect(item?.score).toBe(100);
    expect(item?.decision).toBe("no_fit");
    expect(item?.requirements).toHaveLength(40);
    expect(item?.requirements[0]).toEqual({ label: "R0", required: true, met: "yes", evidence: "e".repeat(200) });
    expect(item?.requirements.some((row) => row.label === "Bad mark")).toBe(false);
  });

  it("nulls a score or a decision it does not know", () => {
    const [item] = cleanItems([raw({ score: Number.NaN, decision: "great" as never })]);
    expect(item?.score).toBeNull();
    expect(item?.decision).toBeNull();
  });
});
