import { describe, expect, it } from "vitest";

import { arrayElement, cleanSearch, searchOrFilter } from "./search";

describe("cleanSearch", () => {
  it("drops the characters that break the filter", () => {
    expect(cleanSearch("ana, lu (paris) 100%")).toBe("ana lu paris 100");
    expect(cleanSearch('"quoted" \\ back')).toBe("quoted back");
    expect(cleanSearch("   ")).toBe("");
  });
});

describe("searchOrFilter", () => {
  it("matches the three columns with one pattern", () => {
    expect(searchOrFilter("ana")).toBe(
      "full_name.ilike.%ana%,headline.ilike.%ana%,location.ilike.%ana%",
    );
  });

  it("answers null when nothing is left", () => {
    expect(searchOrFilter(",,%%")).toBeNull();
    expect(searchOrFilter("")).toBeNull();
  });
});

describe("arrayElement", () => {
  it("quotes a value so it stays one element of the array literal", () => {
    expect(arrayElement("Python")).toBe('"Python"');
    expect(arrayElement("gestion de projet, PMO")).toBe('"gestion de projet, PMO"');
    expect(arrayElement("{x}")).toBe('"{x}"');
  });

  it("escapes quotes and backslashes", () => {
    expect(arrayElement('"Excel" avancé')).toBe('"\\"Excel\\" avancé"');
    expect(arrayElement("a\\b")).toBe('"a\\\\b"');
  });
});
