import { describe, expect, it } from "vitest";

import {
  filterMembers,
  fold,
  insertMention,
  mentionQuery,
  parseMentions,
  renderMentions,
} from "./mentions";

const members = [
  { id: "u1", name: "Ana" },
  { id: "u2", name: "Ana Lopez" },
  { id: "u3", name: "José Martín" },
  { id: "u4", name: "Bob" },
  { id: "u5", name: "   " },
];

describe("renderMentions", () => {
  it("prefers the longest name and keeps the text around", () => {
    const segments = renderMentions("Hello @Ana Lopez, see @Bob!", members);
    expect(segments).toEqual([
      { kind: "text", text: "Hello " },
      { kind: "mention", text: "@Ana Lopez", userId: "u2" },
      { kind: "text", text: ", see " },
      { kind: "mention", text: "@Bob", userId: "u4" },
      { kind: "text", text: "!" },
    ]);
  });

  it("stops at a word boundary and ignores emails", () => {
    expect(renderMentions("@Anaïs is not Ana", members)).toEqual([{ kind: "text", text: "@Anaïs is not Ana" }]);
    expect(renderMentions("write to ana@example.com", members)).toEqual([
      { kind: "text", text: "write to ana@example.com" },
    ]);
  });

  it("matches without accents or case", () => {
    const segments = renderMentions("cc @jose martin", members);
    expect(segments).toEqual([
      { kind: "text", text: "cc " },
      { kind: "mention", text: "@jose martin", userId: "u3" },
    ]);
  });

  it("answers one text segment for a body without mentions, and nothing for an empty one", () => {
    expect(renderMentions("plain", members)).toEqual([{ kind: "text", text: "plain" }]);
    expect(renderMentions("", members)).toEqual([]);
  });
});

describe("parseMentions", () => {
  it("lists each mentioned member once, in order", () => {
    expect(parseMentions("@Bob and @Ana then @Bob again", members)).toEqual(["u4", "u1"]);
    expect(parseMentions("nobody", members)).toEqual([]);
  });
});

describe("mentionQuery", () => {
  it("finds the token being typed before the caret", () => {
    const text = "hey @An";
    expect(mentionQuery(text, text.length)).toEqual({ start: 4, query: "An" });
    expect(mentionQuery("@", 1)).toEqual({ start: 0, query: "" });
  });

  it("answers null outside a mention", () => {
    expect(mentionQuery("plain text", 10)).toBeNull();
    expect(mentionQuery("mail me ana@ex", 14)).toBeNull();
    expect(mentionQuery("@Ana\nnext line", 14)).toBeNull();
    expect(mentionQuery(`@${"x".repeat(41)}`, 42)).toBeNull();
  });

  it("only looks before the caret", () => {
    expect(mentionQuery("@Ana later", 2)).toEqual({ start: 0, query: "A" });
  });
});

describe("filterMembers", () => {
  it("matches the start of the name or of any of its words, ignoring accents", () => {
    expect(filterMembers(members, "an").map((m) => m.id)).toEqual(["u1", "u2"]);
    expect(filterMembers(members, "mart").map((m) => m.id)).toEqual(["u3"]);
    expect(filterMembers(members, "jose").map((m) => m.id)).toEqual(["u3"]);
    expect(filterMembers(members, "zz")).toEqual([]);
  });

  it("lists everyone (sorted, limited) for an empty query and skips blank names", () => {
    expect(filterMembers(members, "").map((m) => m.id)).toEqual(["u1", "u2", "u4", "u3"]);
    expect(filterMembers(members, "", 2).map((m) => m.id)).toEqual(["u1", "u2"]);
  });
});

describe("insertMention", () => {
  it("replaces the query with the name and a space", () => {
    const result = insertMention("hey @An there", 4, 7, "Ana Lopez");
    expect(result.text).toBe("hey @Ana Lopez  there");
    expect(result.caret).toBe("hey @Ana Lopez ".length);
  });
});

describe("fold", () => {
  it("drops accents and case", () => {
    expect(fold("José MARTÍN")).toBe("jose martin");
  });
});
