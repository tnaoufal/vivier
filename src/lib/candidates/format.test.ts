import { describe, expect, it } from "vitest";

import {
  confidenceTone,
  dateInputToIso,
  dateInputValue,
  displayName,
  distinctTags,
  documentTone,
  formatBytes,
  formatCount,
  formatDateRange,
  languagesLine,
  needsReview,
  topSkills,
  yearsLabel,
} from "./format";

describe("confidenceTone", () => {
  it("keeps quiet above 0.8 and when the field was never read", () => {
    expect(confidenceTone(0.95)).toBe("none");
    expect(confidenceTone(0.8)).toBe("none");
    expect(confidenceTone(undefined)).toBe("none");
    expect(confidenceTone(null)).toBe("none");
    expect(confidenceTone(Number.NaN)).toBe("none");
  });

  it("asks for a check between 0.5 and 0.8, and doubts below", () => {
    expect(confidenceTone(0.79)).toBe("caution");
    expect(confidenceTone(0.5)).toBe("caution");
    expect(confidenceTone(0.49)).toBe("negative");
    expect(confidenceTone(0)).toBe("negative");
  });
});

describe("needsReview", () => {
  it("flags a profile with any field under 0.6", () => {
    expect(needsReview({ full_name: 0.9, email: 0.55 })).toBe(true);
    expect(needsReview({ full_name: 0.9, email: 0.6 })).toBe(false);
    expect(needsReview({})).toBe(false);
    expect(needsReview(null)).toBe(false);
  });
});

describe("formatBytes", () => {
  it("speaks both languages in powers of 1024", () => {
    expect(formatBytes(12, "en")).toBe("12 B");
    expect(formatBytes(12, "fr")).toBe("12 o");
    expect(formatBytes(1536, "en")).toMatch(/^1\.5 KB$/);
    expect(formatBytes(1536, "fr")).toMatch(/^1,5 Ko$/);
    expect(formatBytes(26214400, "en")).toBe("25 MB");
    expect(formatBytes(26214400, "fr")).toBe("25 Mo");
    expect(formatBytes(-5, "en")).toBe("0 B");
  });
});

describe("formatCount", () => {
  it("groups thousands the way the locale does and never shows a negative count", () => {
    expect(formatCount("en", 10000)).toBe("10,000");
    expect(formatCount("fr", 10000)).toMatch(/^10\s000$/);
    expect(formatCount("en", 7)).toBe("7");
    expect(formatCount("en", -3)).toBe("0");
    expect(formatCount("fr", Number.NaN)).toBe("0");
  });
});

describe("formatDateRange", () => {
  it("shows the years of a range", () => {
    expect(formatDateRange("fr", "2019-03", "2023-01")).toBe("2019 – 2023");
    expect(formatDateRange("en", "2019", "2019")).toBe("2019");
  });

  it("says since / until when one end is missing", () => {
    expect(formatDateRange("fr", "2021-06", null)).toBe("depuis 2021");
    expect(formatDateRange("en", "2021", null)).toBe("since 2021");
    expect(formatDateRange("fr", null, "2023")).toBe("jusqu'en 2023");
    expect(formatDateRange("en", null, "2023")).toBe("until 2023");
    expect(formatDateRange("en", null, null)).toBe("");
    expect(formatDateRange("en", " ", "")).toBe("");
  });

  it("keeps a value that is not a year as written", () => {
    expect(formatDateRange("en", "2020", "present")).toBe("2020 – present");
  });
});

describe("yearsLabel", () => {
  it("agrees the unit with the number", () => {
    expect(yearsLabel("fr", 1)).toBe("1 an");
    expect(yearsLabel("fr", 3)).toBe("3 ans");
    expect(yearsLabel("fr", 2.5)).toBe("2,5 ans");
    expect(yearsLabel("en", 1)).toBe("1 year");
    expect(yearsLabel("en", 0.5)).toBe("0.5 years");
    expect(yearsLabel("en", null)).toBe("");
  });
});

describe("row summaries", () => {
  it("falls back to the placeholder for a nameless profile", () => {
    expect(displayName({ full_name: "  " }, "Sans nom")).toBe("Sans nom");
    expect(displayName({ full_name: " Ana Lu " }, "Sans nom")).toBe("Ana Lu");
  });

  it("lists languages with their level", () => {
    expect(
      languagesLine([
        { name: "Anglais", level: "C1" },
        { name: "Espagnol", level: null },
      ]),
    ).toBe("Anglais (C1), Espagnol");
    expect(languagesLine([])).toBe("");
  });

  it("keeps the first skills only", () => {
    expect(topSkills(["a", " ", "b", "c", "d", "e"], 4)).toEqual(["a", "b", "c", "d"]);
    expect(topSkills(null, 4)).toEqual([]);
  });

  it("collects distinct tags in order", () => {
    expect(distinctTags([{ tags: ["b", "a"] }, { tags: ["a", " c "] }])).toEqual(["b", "a", "c"]);
  });

  it("tones a document status", () => {
    expect(documentTone("processed")).toBe("positive");
    expect(documentTone("failed")).toBe("negative");
    expect(documentTone("needs_ocr")).toBe("caution");
    expect(documentTone("processing")).toBe("primary");
    expect(documentTone("queued")).toBe("neutral");
    // Set aside is not a failure of the service: the file was read and is not a CV.
    expect(documentTone("rejected")).toBe("neutral");
  });
});

describe("date inputs", () => {
  it("round-trips a day", () => {
    expect(dateInputValue("2026-10-13T08:00:00.000Z")).toBe("2026-10-13");
    expect(dateInputValue(null)).toBe("");
    expect(dateInputToIso("2026-10-13")).toBe("2026-10-13T12:00:00.000Z");
    expect(dateInputToIso("")).toBeNull();
    expect(dateInputToIso("13/10/2026")).toBeNull();
  });
});
