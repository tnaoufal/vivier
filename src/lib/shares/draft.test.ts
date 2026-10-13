import { describe, expect, it } from "vitest";

import type { ShareItem } from "@/lib/db/types";

import {
  cleanItems,
  latestDocumentByCandidate,
  mergeDraft,
  orderedCandidates,
  plainDraft,
  plainItem,
  summaryAnswer,
  summaryMaxTokens,
  summaryPayload,
  summarySystemPrompt,
  type DraftCandidate,
} from "./draft";

const ana: DraftCandidate = {
  id: "11111111-1111-4111-8111-111111111111",
  full_name: "  Ana Costa ",
  headline: "Développeuse back-end",
  summary: "Huit ans sur des API Node.",
  skills: ["Node.js", "PostgreSQL", " ", "Docker", "Kubernetes", "Terraform", "Go", "Rust"],
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

describe("plainItem", () => {
  it("copies the profile, trims, keeps five skills as strengths and no attention point", () => {
    const item = plainItem(ana, "doc-1", "fr");
    expect(item.name).toBe("Ana Costa");
    expect(item.headline).toBe("Développeuse back-end");
    expect(item.summary).toBe("Huit ans sur des API Node.");
    expect(item.strengths).toEqual(["Node.js", "PostgreSQL", "Docker", "Kubernetes", "Terraform"]);
    expect(item.attention).toEqual([]);
    expect(item.documentId).toBe("doc-1");
  });

  it("names a nameless profile in the organisation's language and leaves the rest empty", () => {
    expect(plainItem(anon, null, "fr").name).toBe("Candidat");
    const item = plainItem(anon, null, "en");
    expect(item.name).toBe("Candidate");
    expect(item.headline).toBeNull();
    expect(item.summary).toBe("");
    expect(item.strengths).toEqual([]);
  });
});

describe("orderedCandidates", () => {
  it("follows the ids given, once each, skipping unknown ones", () => {
    const rows = orderedCandidates([anon.id, "nope", ana.id, anon.id], [ana, anon]);
    expect(rows.map((row) => row.id)).toEqual([anon.id, ana.id]);
  });
});

describe("latestDocumentByCandidate", () => {
  it("keeps the first row per candidate (rows come newest first)", () => {
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
});

describe("plainDraft", () => {
  it("builds one item per candidate with its latest document", () => {
    const items = plainDraft([ana, anon], new Map([[ana.id, "d3"]]), "fr");
    expect(items).toHaveLength(2);
    expect(items[0]?.documentId).toBe("d3");
    expect(items[1]?.documentId).toBeNull();
  });
});

describe("summaryPayload", () => {
  it("sends only what the profile gave and the brief's criteria", () => {
    const payload = summaryPayload(
      { title: "Back-end senior", description: "API Node en prod.", criteria: [{ id: "c1", kind: "skill", label: "Node", value: "node", required: true, weight: 3 }] },
      [ana, anon],
    );
    expect(payload.brief.criteria).toEqual([{ label: "Node", value: "node", required: true, weight: 3 }]);
    const first = payload.candidates[0] ?? {};
    expect(first["candidateId"]).toBe(ana.id);
    expect(first["languages"]).toEqual(["Français (native)", "Anglais (C1)"]);
    expect(first["yearsExperience"]).toBe(8);
    expect("availability" in first).toBe(false);
    const second = payload.candidates[1] ?? {};
    expect(Object.keys(second)).toEqual(["candidateId"]);
  });
});

describe("summarySystemPrompt", () => {
  it("asks for the organisation's language and forbids protected characteristics", () => {
    expect(summarySystemPrompt("fr")).toContain("in French");
    expect(summarySystemPrompt("en")).toContain("in English");
    expect(summarySystemPrompt("fr")).toMatch(/protected characteristic/);
    expect(summarySystemPrompt("fr")).toMatch(/JSON only/);
  });
});

describe("summaryAnswer", () => {
  it("fills what the model left out", () => {
    const parsed = summaryAnswer.parse({ items: [{ candidateId: ana.id }] });
    expect(parsed.items[0]).toEqual({ candidateId: ana.id, summary: "", strengths: [], attention: [] });
  });
});

describe("summaryMaxTokens", () => {
  it("grows with the candidates and stays bounded", () => {
    expect(summaryMaxTokens(1)).toBe(860);
    expect(summaryMaxTokens(30)).toBe(8000);
  });
});

describe("mergeDraft", () => {
  const items = plainDraft([ana, anon], new Map(), "fr");

  it("takes the model's summary, strengths and attention for the candidates it answered", () => {
    const merged = mergeDraft(items, {
      items: [
        {
          candidateId: ana.id,
          summary: "  Huit ans d'API Node.  Maîtrise PostgreSQL. ",
          strengths: ["Node.js en production", "PostgreSQL", "Anglais C1", "Lyon", "Un de trop"],
          attention: ["Le CV ne mentionne pas Kubernetes en production", "", "Disponibilité non précisée", "Un de trop", "Deux de trop"],
        },
      ],
    });
    expect(merged[0]?.summary).toBe("Huit ans d'API Node. Maîtrise PostgreSQL.");
    expect(merged[0]?.strengths).toEqual(["Node.js en production", "PostgreSQL", "Anglais C1", "Lyon"]);
    expect(merged[0]?.attention).toEqual(["Le CV ne mentionne pas Kubernetes en production", "Disponibilité non précisée", "Un de trop"]);
    expect(merged[1]).toEqual(items[1]);
  });

  it("keeps the plain draft where the model answered nothing", () => {
    const merged = mergeDraft(items, { items: [{ candidateId: ana.id, summary: "", strengths: [], attention: [] }] });
    expect(merged[0]?.summary).toBe(items[0]?.summary);
    expect(merged[0]?.strengths).toEqual(items[0]?.strengths);
    expect(merged[0]?.attention).toEqual([]);
  });
});

describe("cleanItems", () => {
  it("trims, drops empty points and nameless items, and keeps the document id", () => {
    const raw: ShareItem[] = [
      { candidateId: ana.id, name: " Ana ", headline: " ", summary: " ok ", strengths: ["a", " ", "a", "b"], attention: [""], documentId: "d3" },
      { candidateId: anon.id, name: "   ", headline: null, summary: "", strengths: [], attention: [], documentId: null },
    ];
    const cleaned = cleanItems(raw);
    expect(cleaned).toHaveLength(1);
    expect(cleaned[0]).toEqual({ candidateId: ana.id, name: "Ana", headline: null, summary: "ok", strengths: ["a", "b"], attention: [], documentId: "d3" });
  });
});
