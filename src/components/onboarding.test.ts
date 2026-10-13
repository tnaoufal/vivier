import { describe, expect, it } from "vitest";

import { slugOf } from "./onboarding";

describe("slugOf", () => {
  it("writes a lower-case ascii slug with a tail", () => {
    expect(slugOf("Groupe Lumière RH", "ab12")).toBe("groupe-lumiere-rh-ab12");
    expect(slugOf("   ", "ab12")).toBe("org-ab12");
    expect(slugOf("A".repeat(80), "x1")).toMatch(/^a{30}-x1$/);
  });
});
