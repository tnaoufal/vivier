import { describe, expect, it } from "vitest";

import {
  BATCH_FAILURES_MAX,
  BATCH_MIN,
  isThinCard,
  lotsOf,
  settlesUnknown,
  splitBatch,
  THIN_CARD_REASON,
  UNREADABLE_REASON,
} from "./funnel.js";
import type { TriageCard } from "./triage.js";

function card(extra: Partial<TriageCard> = {}): TriageCard {
  return {
    ref: "c1",
    headline: null,
    current: null,
    previous: [],
    years: null,
    education: null,
    skills: [],
    ...extra,
  };
}

describe("isThinCard", () => {
  it("is true for a card with no headline and no titled position, whatever else it carries", () => {
    expect(isThinCard(card())).toBe(true);
    expect(isThinCard(card({ years: 12, skills: ["SAP"], education: "Master" }))).toBe(true);
    // A company without a title is not a position a métier can be read from.
    expect(isThinCard(card({ current: { title: " ", company: "Acme", since: "2020" } }))).toBe(
      true,
    );
    expect(
      isThinCard(card({ previous: [{ title: "", company: "Beta", from: "2018", to: "2020" }] })),
    ).toBe(true);
  });

  it("is false as soon as the headline or a position has a title", () => {
    expect(isThinCard(card({ headline: "Business Developer" }))).toBe(false);
    expect(isThinCard(card({ current: { title: "SDR", company: null, since: null } }))).toBe(false);
    expect(
      isThinCard(card({ previous: [{ title: "SDR", company: null, from: null, to: null }] })),
    ).toBe(false);
    expect(THIN_CARD_REASON).toBe("Fiche sans poste ni intitulé");
  });
});

describe("the batches that fail", () => {
  it("splits a batch in two halves, the first one larger when odd", () => {
    expect(splitBatch([1, 2, 3, 4, 5])).toEqual([
      [1, 2, 3],
      [4, 5],
    ]);
    expect(splitBatch([1, 2])).toEqual([[1], [2]]);
    expect(splitBatch([1])).toEqual([[1], []]);
    expect(splitBatch([])).toEqual([[], []]);
  });

  it("settles a part of BATCH_MIN cards or fewer that failed BATCH_FAILURES_MAX times, never a larger one", () => {
    expect(BATCH_MIN).toBe(10);
    expect(BATCH_FAILURES_MAX).toBe(2);
    expect(settlesUnknown(10, 2)).toBe(true);
    expect(settlesUnknown(3, 5)).toBe(true);
    expect(settlesUnknown(10, 1)).toBe(false);
    expect(settlesUnknown(11, 2)).toBe(false);
    expect(UNREADABLE_REASON).toBe("Fiche illisible par le modèle");
  });

  it("cuts a list into lots of a size, one at least", () => {
    expect(lotsOf([1, 2, 3, 4, 5], 2)).toEqual([[1, 2], [3, 4], [5]]);
    expect(lotsOf([1, 2], 0)).toEqual([[1], [2]]);
    expect(lotsOf([1, 2, 3], Number.NaN)).toEqual([[1], [2], [3]]);
    expect(lotsOf([], 3)).toEqual([]);
  });
});
