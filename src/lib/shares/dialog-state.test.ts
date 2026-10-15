import { describe, expect, it } from "vitest";

import {
  canShare,
  dialogReducer,
  initialState,
  isEmail,
  parseRecipients,
  recipientsProblem,
  recipientsToSend,
  shareTitleOf,
  type DialogState,
} from "./dialog-state";

function run(state: DialogState, ...actions: Parameters<typeof dialogReducer>[1][]): DialogState {
  return actions.reduce(dialogReducer, state);
}

const share = {
  shareId: "s1",
  url: "https://vivier.app/share/x",
  expiresAt: "2026-10-27T10:00:00Z",
};

describe("initialState", () => {
  it("starts with nothing ticked, nothing typed, no link", () => {
    expect(initialState()).toEqual({
      selected: [],
      recipients: "",
      message: "",
      busy: false,
      share: null,
      outcome: null,
    });
  });
});

describe("the selection", () => {
  it("ticks and unticks candidates, never twice the same", () => {
    let state = run(initialState(), { type: "setSelected", candidateIds: ["a", "b", "a"] });
    expect(state.selected).toEqual(["a", "b"]);
    state = run(state, { type: "toggleCandidate", candidateId: "a" });
    expect(state.selected).toEqual(["b"]);
    state = run(state, { type: "toggleCandidate", candidateId: "c" });
    expect(state.selected).toEqual(["b", "c"]);
  });

  it("caps the selection at thirty", () => {
    const many = Array.from({ length: 35 }, (_, i) => `c${i}`);
    const state = run(initialState(), { type: "setSelected", candidateIds: many });
    expect(state.selected).toHaveLength(30);
    expect(run(state, { type: "toggleCandidate", candidateId: "extra" }).selected).toHaveLength(30);
  });
});

describe("canShare", () => {
  const ticked = run(initialState(), { type: "toggleCandidate", candidateId: "a" });

  it("needs someone ticked and nothing running", () => {
    expect(canShare(initialState(), true)).toBe(false);
    expect(canShare(ticked, true)).toBe(true);
    expect(canShare(run(ticked, { type: "setBusy", value: true }), true)).toBe(false);
  });

  it("refuses a malformed address or too many of them when emails can go out", () => {
    const bad = run(ticked, { type: "setRecipients", value: "ana@x.fr, nope" });
    expect(canShare(bad, true)).toBe(false);
    expect(recipientsProblem(bad.recipients)).toBe("invalid");
    const many = Array.from({ length: 11 }, (_, i) => `p${i}@x.fr`).join(", ");
    expect(recipientsProblem(many)).toBe("tooMany");
    expect(canShare(run(ticked, { type: "setRecipients", value: many }), true)).toBe(false);
    expect(recipientsProblem("ana@x.fr; bo@y.com")).toBeNull();
    expect(recipientsProblem("   ")).toBeNull();
  });

  it("ignores the addresses when no email can go out", () => {
    const bad = run(ticked, { type: "setRecipients", value: "nope" });
    expect(canShare(bad, false)).toBe(true);
    expect(recipientsToSend(bad, false)).toEqual([]);
  });

  it("is over once the link exists", () => {
    expect(canShare(run(ticked, { type: "created", share }), true)).toBe(false);
  });
});

describe("recipientsToSend", () => {
  it("answers the clean addresses, each once, lower-cased, and nothing when one is malformed", () => {
    const state = run(initialState(), {
      type: "setRecipients",
      value: "Ana@x.fr, bo@y.com; ana@x.fr",
    });
    expect(recipientsToSend(state, true)).toEqual(["ana@x.fr", "bo@y.com"]);
    expect(
      recipientsToSend(run(state, { type: "setRecipients", value: "ana@x.fr nope@" }), true),
    ).toEqual([]);
    expect(recipientsToSend(initialState(), true)).toEqual([]);
  });
});

describe("the link and the sending", () => {
  const created = run(
    initialState(),
    { type: "toggleCandidate", candidateId: "a" },
    { type: "setBusy", value: true },
    { type: "created", share },
  );

  it("keeps the link, then records what left and clears busy", () => {
    expect(created.share?.url).toBe("https://vivier.app/share/x");
    expect(created.busy).toBe(true);
    const sent = run(created, { type: "sent", outcome: { sent: 1, failed: ["bo@y.com"] } });
    expect(sent.outcome).toEqual({ sent: 1, failed: ["bo@y.com"] });
    expect(sent.busy).toBe(false);
  });

  it("clears busy on a failure and keeps what was typed", () => {
    const typed = run(
      initialState(),
      { type: "setMessage", value: "Bonjour" },
      { type: "setBusy", value: true },
    );
    const failed = run(typed, { type: "failed" });
    expect(failed.busy).toBe(false);
    expect(failed.message).toBe("Bonjour");
  });

  it("resets everything for the next opening", () => {
    expect(run(created, { type: "reset" })).toEqual(initialState());
  });
});

describe("parseRecipients and isEmail", () => {
  it("accepts plain addresses and refuses the rest", () => {
    expect(isEmail("ana@x.fr")).toBe(true);
    expect(isEmail("ana@x")).toBe(false);
    expect(isEmail("ana x@x.fr")).toBe(false);
    expect(isEmail("@x.fr")).toBe(false);
    expect(parseRecipients("")).toEqual({ valid: [], invalid: [] });
    expect(parseRecipients("A@b.co;a@b.co, c\nd@e.fr")).toEqual({
      valid: ["a@b.co", "d@e.fr"],
      invalid: ["c"],
    });
  });
});

describe("shareTitleOf", () => {
  it("is the brief's title, collapsed and clipped, else the fallback", () => {
    expect(shareTitleOf("  Back-end   senior ", "Shortlist")).toBe("Back-end senior");
    expect(shareTitleOf("   ", "Shortlist")).toBe("Shortlist");
    expect(shareTitleOf("x".repeat(250), "Shortlist")).toHaveLength(200);
  });
});
