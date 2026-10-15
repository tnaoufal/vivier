import { describe, expect, it } from "vitest";

import { readBriefAnswer } from "./prompts";

// The schema of the one reading of a brief is the web app's (zod); the
// prompt, the payloads and the rules are the shared package's, tested
// next to it (packages/analysis/src/prompts.test.ts).
describe("the answer of the one reading of a brief", () => {
  it("wants three missions at least in the answer, and lets the warnings go", () => {
    const profile = { domain: "x", seniority: "senior", missions: ["a", "b", "c"] };
    expect(readBriefAnswer.safeParse({ profile, criteria: [] }).success).toBe(true);
    expect(
      readBriefAnswer.safeParse({
        profile,
        criteria: [{ kind: "skill", label: "l", value: "v" }],
        warnings: ["w"],
      }).success,
    ).toBe(true);
    expect(
      readBriefAnswer.safeParse({ profile: { ...profile, missions: ["a", "b"] }, criteria: [] })
        .success,
    ).toBe(false);
    expect(readBriefAnswer.safeParse({ criteria: [] }).success).toBe(false);
    expect(
      readBriefAnswer.safeParse({ profile, criteria: [{ kind: "skill", label: "l" }] }).success,
    ).toBe(false);
  });
});
