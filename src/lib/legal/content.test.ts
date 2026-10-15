import { describe, expect, it } from "vitest";

import { LEGAL_CONTENT, type LegalKind } from "./content";

const KINDS: LegalKind[] = ["privacy", "terms"];

describe("LEGAL_CONTENT", () => {
  for (const kind of KINDS) {
    const { fr, en } = LEGAL_CONTENT[kind];

    it(`gives ${kind} the same sections and paragraphs in French and in English`, () => {
      expect(en.sections.map((section) => section.p.length)).toEqual(
        fr.sections.map((section) => section.p.length),
      );
    });

    it(`leaves no ${kind} title, heading or paragraph empty`, () => {
      for (const page of [fr, en]) {
        const texts = [
          page.title,
          ...page.sections.flatMap((section) => [section.h, ...section.p]),
        ];
        expect(texts.every((text) => text.trim().length > 0)).toBe(true);
      }
    });

    it(`names each ${kind} section once, since a heading keys its row`, () => {
      for (const page of [fr, en]) {
        const headings = page.sections.map((section) => section.h);
        expect(new Set(headings).size).toBe(headings.length);
      }
    });
  }
});
