import { describe, expect, it } from "vitest";

import { briefOf, inList, itemsOf, orgOf } from "./shares.server";

/** The columns are JSON: what a row holds may not match the type, which is the point of the guards. */
const json = (value: unknown): never => value as never;

const before = {
  candidateId: "11111111-1111-4111-8111-111111111111",
  name: "Ana Costa",
  headline: "Développeuse back-end",
  summary: "Huit ans sur des API Node.",
  strengths: ["Node.js"],
  attention: [],
  documentId: "33333333-3333-4333-8333-333333333333",
};

const dossier = {
  ...before,
  location: "Lyon",
  yearsExperience: 8,
  availability: "Un mois",
  skills: ["Node.js", 4, "PostgreSQL"],
  languages: ["Anglais (C1)"],
  score: 68.2,
  decision: "borderline",
  requirements: [
    { label: "Node.js en production", required: true, met: "yes", evidence: "API Node depuis 2018" },
    { label: "Anglais courant", required: "yes", met: "partial", evidence: "" },
    { label: "Kubernetes", required: false, met: "maybe", evidence: null },
    { label: " ", required: false, met: "no", evidence: null },
    "not a row",
  ],
};

describe("itemsOf", () => {
  it("defaults the dossier's fields for a share created before it", () => {
    const [item] = itemsOf({ items: json([before]), include_cvs: true });
    expect(item).toEqual({
      ...before,
      location: null,
      yearsExperience: null,
      availability: null,
      skills: [],
      languages: [],
      score: null,
      decision: null,
      requirements: [],
    });
  });

  it("reads the dossier's fields, guarded, and drops the rows it cannot read", () => {
    const [item] = itemsOf({ items: json([dossier]), include_cvs: true });
    expect(item?.location).toBe("Lyon");
    expect(item?.yearsExperience).toBe(8);
    expect(item?.availability).toBe("Un mois");
    expect(item?.skills).toEqual(["Node.js", "PostgreSQL"]);
    expect(item?.languages).toEqual(["Anglais (C1)"]);
    expect(item?.score).toBe(68);
    expect(item?.decision).toBe("borderline");
    expect(item?.requirements).toEqual([
      { label: "Node.js en production", required: true, met: "yes", evidence: "API Node depuis 2018" },
      { label: "Anglais courant", required: false, met: "partial", evidence: null },
    ]);
  });

  it("keeps the CV link only when the share includes the CVs", () => {
    expect(itemsOf({ items: json([dossier]), include_cvs: true })[0]?.documentId).toBe(before.documentId);
    expect(itemsOf({ items: json([dossier]), include_cvs: false })[0]?.documentId).toBeNull();
  });

  it("nulls a score or a decision it does not know and skips what is not an item", () => {
    const items = itemsOf({
      items: json([{ ...before, score: "high", decision: "great" }, { name: "no id" }, null, 3]),
      include_cvs: false,
    });
    expect(items).toHaveLength(1);
    expect(items[0]?.score).toBeNull();
    expect(items[0]?.decision).toBeNull();
    expect(itemsOf({ items: json("nope"), include_cvs: false })).toEqual([]);
  });
});

describe("briefOf", () => {
  it("reads the snapshot and drops a requirement without a label", () => {
    expect(
      briefOf({
        brief: json({
          title: "Back-end senior",
          summary: "API Node en prod.",
          requirements: [{ label: "Node.js", required: true }, { label: "", required: false }, { required: true }, "x"],
        }),
      }),
    ).toEqual({ title: "Back-end senior", summary: "API Node en prod.", requirements: [{ label: "Node.js", required: true }] });
  });

  it("answers null for a share created before the dossier or a column it cannot read", () => {
    expect(briefOf({ brief: null })).toBeNull();
    expect(briefOf({ brief: json({}) })).toBeNull();
    expect(briefOf({ brief: json([]) })).toBeNull();
    expect(briefOf({ brief: json({ title: 3, requirements: "x" }) })).toBeNull();
  });
});

describe("orgOf and inList", () => {
  it("reads an embedded organisation as an object or the first row of an array", () => {
    expect(orgOf({ organizations: { name: "Lumière RH", locale: "fr" } })).toEqual({ name: "Lumière RH", locale: "fr" });
    expect(orgOf({ organizations: [{ name: "Lumière RH", locale: "en" }] })?.locale).toBe("en");
    expect(orgOf({ organizations: [] })).toBeNull();
    expect(orgOf({ organizations: null })).toBeNull();
  });

  it("writes a PostgREST in filter", () => {
    expect(inList(["a", "b"])).toBe("in.(a,b)");
  });
});
