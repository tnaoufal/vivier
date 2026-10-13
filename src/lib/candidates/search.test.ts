import { describe, expect, it } from "vitest";

import { cleanSearch, searchOrFilter } from "./search";

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
