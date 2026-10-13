import { describe, expect, it } from "vitest";

import type { ActivityRow } from "@/lib/db/types";
import { ACTIVITY_FAMILIES, EMPTY_NAMES, activityFamily, describeActivity, fill, type ActivityNames } from "./describe";

const names: ActivityNames = {
  members: new Map([
    ["u1", "Ana Lu"],
    ["u2", "Marc"],
  ]),
  briefs: new Map([["b1", "Contrôleur de gestion"]]),
  candidates: new Map([["c1", "Jean Dupont"]]),
};

function row(partial: Partial<ActivityRow>): ActivityRow {
  return {
    id: 1,
    org_id: "o1",
    actor_id: "u1",
    kind: "shortlist.added",
    target_type: "shortlist_item",
    target_id: null,
    brief_id: null,
    candidate_id: null,
    payload: {},
    created_at: "2026-10-13T10:00:00Z",
    ...partial,
  };
}

describe("activityFamily", () => {
  it("reads the family from the kind", () => {
    expect(activityFamily("shortlist.added")).toBe("shortlist");
    expect(activityFamily("member.invited")).toBe("member");
    expect(activityFamily("weird")).toBeNull();
    expect(ACTIVITY_FAMILIES).toHaveLength(7);
  });
});

describe("fill", () => {
  it("replaces known placeholders and keeps unknown ones visible", () => {
    expect(fill("{a} and {b}", { a: "x" })).toBe("x and {b}");
  });
});

describe("describeActivity", () => {
  it("names the actor, the candidate and the brief in both languages", () => {
    const r = row({ brief_id: "b1", candidate_id: "c1" });
    expect(describeActivity(r, "fr", names)).toBe(
      "Ana Lu a ajouté Jean Dupont à la shortlist du brief Contrôleur de gestion.",
    );
    expect(describeActivity(r, "en", names)).toBe(
      "Ana Lu added Jean Dupont to the shortlist of brief Contrôleur de gestion.",
    );
  });

  it("says who decided and what", () => {
    const r = row({ kind: "shortlist.status", brief_id: "b1", candidate_id: "c1", payload: { from: "to_review", to: "retained" } });
    expect(describeActivity(r, "fr", names)).toBe("Ana Lu a retenu Jean Dupont pour le brief Contrôleur de gestion.");
    const dismissed = row({ kind: "shortlist.status", candidate_id: "c1", brief_id: "b1", payload: { to: "dismissed" } });
    expect(describeActivity(dismissed, "en", names)).toBe("Ana Lu dismissed Jean Dupont for brief Contrôleur de gestion.");
  });

  it("names the assignee, or says the assignment was cleared", () => {
    expect(describeActivity(row({ kind: "shortlist.assigned", candidate_id: "c1", payload: { to: "u2" } }), "fr", names)).toBe(
      "Ana Lu a confié Jean Dupont à Marc.",
    );
    expect(describeActivity(row({ kind: "shortlist.assigned", candidate_id: "c1", payload: { to: null } }), "en", names)).toBe(
      "Ana Lu cleared the assignment of Jean Dupont.",
    );
  });

  it("uses a generic word for a name that was not read, never an invented one", () => {
    const r = row({ candidate_id: "unknown", brief_id: "gone" });
    expect(describeActivity(r, "fr", EMPTY_NAMES)).toBe("Un ancien membre a ajouté un candidat à la shortlist du brief un brief.");
  });

  it("says 'system' when nobody did it, as for a processed document", () => {
    const processed = row({ kind: "document.processed", actor_id: null, payload: { fileName: "cv.pdf", method: "model" } });
    expect(describeActivity(processed, "fr", names)).toBe("cv.pdf a été structuré par le modèle.");
    const heuristic = row({ kind: "document.processed", actor_id: null, payload: { fileName: "cv.pdf", method: "heuristic" } });
    expect(describeActivity(heuristic, "en", names)).toBe("cv.pdf was read without a model (text only).");
    const failed = row({ kind: "document.failed", actor_id: null, payload: { fileName: "cv.pdf" } });
    expect(describeActivity(failed, "en", names)).toBe("Processing of cv.pdf failed.");
    const other = row({ kind: "candidate.archived", actor_id: null, candidate_id: "c1" });
    expect(describeActivity(other, "en", names)).toBe("System archived Jean Dupont.");
  });

  it("names the invited address and the role in the person's language", () => {
    const r = row({ kind: "member.invited", target_type: "invitation", payload: { email: "sam@x.fr", role: "viewer" } });
    expect(describeActivity(r, "fr", names)).toBe("Ana Lu a invité sam@x.fr en tant que Lecteur.");
    expect(describeActivity(r, "en", names)).toBe("Ana Lu invited sam@x.fr as Viewer.");
  });

  it("tells leaving apart from being removed", () => {
    expect(describeActivity(row({ kind: "member.removed", target_id: "u1" }), "fr", names)).toBe("Ana Lu a quitté l'organisation.");
    expect(describeActivity(row({ kind: "member.removed", target_id: "u2" }), "en", names)).toBe("Ana Lu removed Marc from the team.");
  });

  it("reads the title of a created brief from the payload when the brief is gone", () => {
    const r = row({ kind: "brief.created", brief_id: "gone", payload: { title: "DAF" } });
    expect(describeActivity(r, "en", names)).toBe("Ana Lu created brief DAF.");
  });

  it("falls back to a visible kind for anything unknown", () => {
    expect(describeActivity(row({ kind: "future.thing" }), "en", names)).toBe("Ana Lu: future.thing.");
  });
});
