import { describe, expect, it } from "vitest";

import type { ShareItem } from "@/lib/db/types";

import {
  canCreate,
  canPrepare,
  canSend,
  dialogReducer,
  initialState,
  isEmail,
  parseRecipients,
  stepIndex,
  type DialogState,
} from "./dialog-state";

const item = (candidateId: string, name = "Ana"): ShareItem => ({
  candidateId,
  name,
  headline: null,
  location: "Lyon",
  yearsExperience: 8,
  availability: null,
  skills: ["Node.js", "PostgreSQL"],
  languages: ["Anglais (C1)"],
  summary: "",
  strengths: ["Node"],
  attention: [],
  score: 72,
  decision: "fit",
  requirements: [{ label: "Node.js en production", required: true, met: "yes", evidence: "API Node depuis 2018" }],
  documentId: null,
});

const brief = { title: "Back-end senior", summary: "API Node en prod.", requirements: [{ label: "Node.js en production", required: true }] };

function run(state: DialogState, ...actions: Parameters<typeof dialogReducer>[1][]): DialogState {
  return actions.reduce(dialogReducer, state);
}

describe("initialState", () => {
  it("starts on the content step with the brief title and CVs included", () => {
    const state = initialState("Back-end senior");
    expect(state.step).toBe("content");
    expect(state.title).toBe("Back-end senior");
    expect(state.includeCvs).toBe(true);
    expect(state.expiresInDays).toBe(14);
    expect(state.useModel).toBe(false);
  });
});

describe("content step", () => {
  it("ticks and unticks candidates, never twice the same", () => {
    let state = run(initialState("t"), { type: "setSelected", candidateIds: ["a", "b", "a"] });
    expect(state.selected).toEqual(["a", "b"]);
    state = run(state, { type: "toggleCandidate", candidateId: "a" });
    expect(state.selected).toEqual(["b"]);
    state = run(state, { type: "toggleCandidate", candidateId: "c" });
    expect(state.selected).toEqual(["b", "c"]);
  });

  it("caps the selection at thirty", () => {
    const many = Array.from({ length: 35 }, (_, i) => `c${i}`);
    const state = run(initialState("t"), { type: "setSelected", candidateIds: many });
    expect(state.selected).toHaveLength(30);
    expect(run(state, { type: "toggleCandidate", candidateId: "extra" }).selected).toHaveLength(30);
  });

  it("clips the title and needs a selection and a title to prepare", () => {
    const state = run(initialState(""), { type: "setTitle", title: "x".repeat(250) });
    expect(state.title).toHaveLength(200);
    expect(canPrepare(state)).toBe(false);
    const ticked = run(state, { type: "toggleCandidate", candidateId: "a" });
    expect(canPrepare(ticked)).toBe(true);
    expect(canPrepare(run(ticked, { type: "setBusy", value: true }))).toBe(false);
    expect(canPrepare(run(ticked, { type: "setTitle", title: "   " }))).toBe(false);
  });
});

describe("review step", () => {
  const drafted = run(
    initialState("t"),
    { type: "setBusy", value: true },
    { type: "drafted", items: [item("a"), item("b", "Bo")], brief, modelUsed: true, modelFailed: false },
  );

  it("moves to the review with the items, the brief's snapshot, and clears busy", () => {
    expect(drafted.step).toBe("review");
    expect(drafted.items).toHaveLength(2);
    expect(drafted.brief).toEqual(brief);
    expect(drafted.busy).toBe(false);
    expect(drafted.modelUsed).toBe(true);
  });

  it("edits a summary, a headline and the points of one item only, never its assessment", () => {
    const state = run(
      drafted,
      { type: "setItemSummary", index: 1, summary: "Résumé" },
      { type: "setItemHeadline", index: 1, headline: "Titre" },
      { type: "addPoint", index: 1, field: "attention" },
      { type: "setPoint", index: 1, field: "attention", at: 0, value: "Non précisé" },
      { type: "removePoint", index: 1, field: "strengths", at: 0 },
    );
    expect(state.items[1]).toEqual({ ...item("b", "Bo"), summary: "Résumé", headline: "Titre", strengths: [], attention: ["Non précisé"] });
    expect(state.items[1]?.requirements).toEqual(item("b").requirements);
    expect(state.items[1]?.score).toBe(72);
    expect(state.items[0]).toEqual(item("a"));
  });

  it("removes an item and refuses to create without any", () => {
    expect(canCreate(drafted)).toBe(true);
    const one = run(drafted, { type: "removeItem", index: 0 });
    expect(one.items.map((i) => i.candidateId)).toEqual(["b"]);
    const none = run(one, { type: "removeItem", index: 0 });
    expect(canCreate(none)).toBe(false);
  });

  it("refuses to create with a nameless item and goes back to the content step", () => {
    const blank = run(drafted, { type: "drafted", items: [item("a", "  ")], brief: null, modelUsed: false, modelFailed: false });
    expect(canCreate(blank)).toBe(false);
    expect(run(blank, { type: "backToContent" }).step).toBe("content");
    expect(run(initialState("t"), { type: "backToContent" }).step).toBe("content");
  });
});

describe("send step", () => {
  const created = run(
    initialState("t"),
    { type: "drafted", items: [item("a")], brief, modelUsed: false, modelFailed: false },
    { type: "created", share: { shareId: "s1", url: "https://vivier.app/share/x", expiresAt: "2026-10-27T10:00:00Z" } },
  );

  it("moves to the send step with the link", () => {
    expect(created.step).toBe("send");
    expect(created.share?.url).toBe("https://vivier.app/share/x");
    expect(canSend(created)).toBe(false);
  });

  it("turns the typed addresses into chips, keeps the invalid ones in the field, caps at ten", () => {
    const state = run(
      created,
      { type: "setRecipientDraft", value: "Ana@x.fr, bad; ana@x.fr\nbo@y.com nope@" },
      { type: "commitRecipients" },
    );
    expect(state.recipients).toEqual(["ana@x.fr", "bo@y.com"]);
    expect(state.recipientDraft).toBe("bad, nope@");
    expect(canSend(state)).toBe(true);
    const many = Array.from({ length: 12 }, (_, i) => `p${i}@x.fr`).join(" ");
    const capped = run(state, { type: "setRecipientDraft", value: many }, { type: "commitRecipients" });
    expect(capped.recipients).toHaveLength(10);
    expect(run(capped, { type: "removeRecipient", email: "ana@x.fr" }).recipients).not.toContain("ana@x.fr");
  });

  it("records the outcome and clears busy", () => {
    const state = run(created, { type: "setBusy", value: true }, { type: "sent", outcome: { sent: 1, failed: ["bo@y.com"] } });
    expect(state.outcome).toEqual({ sent: 1, failed: ["bo@y.com"] });
    expect(state.busy).toBe(false);
  });

  it("resets everything for the next opening", () => {
    const state = run(created, { type: "reset", title: "Nouveau" });
    expect(state).toEqual(initialState("Nouveau"));
    expect(state.brief).toBeNull();
  });
});

describe("parseRecipients and isEmail", () => {
  it("accepts plain addresses and refuses the rest", () => {
    expect(isEmail("ana@x.fr")).toBe(true);
    expect(isEmail("ana@x")).toBe(false);
    expect(isEmail("ana x@x.fr")).toBe(false);
    expect(isEmail("@x.fr")).toBe(false);
    expect(parseRecipients("")).toEqual({ valid: [], invalid: [] });
    expect(parseRecipients("A@b.co;a@b.co, c")).toEqual({ valid: ["a@b.co"], invalid: ["c"] });
  });
});

describe("stepIndex", () => {
  it("numbers the steps", () => {
    expect(stepIndex("content")).toBe(0);
    expect(stepIndex("review")).toBe(1);
    expect(stepIndex("send")).toBe(2);
  });
});
