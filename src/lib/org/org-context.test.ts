import { describe, expect, it } from "vitest";

import type { OrganizationRow } from "@/lib/db/types";
import { initialsOf, memberName, pickOrg } from "./org-context";

const org = (id: string): OrganizationRow => ({
  id,
  name: id,
  slug: id,
  locale: "fr",
  retention_months: 24,
  plan: "trial",
  seat_limit: 3,
  cv_quota_month: 200,
  created_by: null,
  created_at: "",
  updated_at: "",
});

describe("pickOrg", () => {
  it("prefers the remembered organisation when still a member", () => {
    const list = [
      { org: org("a"), role: "owner" as const },
      { org: org("b"), role: "member" as const },
    ];
    expect(pickOrg(list, "b")?.org.id).toBe("b");
    expect(pickOrg(list, "zzz")?.org.id).toBe("a");
    expect(pickOrg([], "a")).toBeNull();
  });
});

describe("names", () => {
  it("falls back from display name to email to a placeholder", () => {
    expect(memberName({ display_name: "Ana Lu", email: "a@x.fr" }, "?")).toBe("Ana Lu");
    expect(memberName({ display_name: " ", email: "ana@x.fr" }, "?")).toBe("ana");
    expect(memberName(undefined, "Someone")).toBe("Someone");
  });

  it("builds initials from the first and last words", () => {
    expect(initialsOf("Ana Lu Torres")).toBe("AT");
    expect(initialsOf("ana")).toBe("A");
    expect(initialsOf("")).toBe("?");
  });
});
