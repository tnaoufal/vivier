import { describe, expect, it } from "vitest";

import {
  LINK_MEMORY_KEY,
  LINK_MEMORY_MAX,
  readLinks,
  recallLink,
  rememberLink,
  type LinkStore,
} from "./link-memory";

function fakeStore(
  initial: Record<string, string> = {},
): LinkStore & { data: Record<string, string> } {
  const data = { ...initial };
  return {
    data,
    getItem: (key) => data[key] ?? null,
    setItem: (key, value) => {
      data[key] = value;
    },
  };
}

describe("rememberLink and recallLink", () => {
  it("keeps a link and gives it back by share id", () => {
    const store = fakeStore();
    rememberLink(store, "s1", "https://vivier.app/share/a");
    rememberLink(store, "s2", "https://vivier.app/share/b");
    expect(recallLink(store, "s1")).toBe("https://vivier.app/share/a");
    expect(recallLink(store, "s2")).toBe("https://vivier.app/share/b");
    expect(recallLink(store, "s3")).toBeNull();
    expect(readLinks(store)).toEqual([
      ["s1", "https://vivier.app/share/a"],
      ["s2", "https://vivier.app/share/b"],
    ]);
  });

  it("replaces an earlier link of the same share and drops the oldest past the limit", () => {
    const store = fakeStore();
    rememberLink(store, "s1", "https://vivier.app/share/old");
    rememberLink(store, "s1", "https://vivier.app/share/new");
    expect(readLinks(store)).toHaveLength(1);
    expect(recallLink(store, "s1")).toBe("https://vivier.app/share/new");
    for (let i = 0; i < LINK_MEMORY_MAX + 5; i += 1)
      rememberLink(store, `x${i}`, `https://vivier.app/share/${i}`);
    expect(readLinks(store)).toHaveLength(LINK_MEMORY_MAX);
    expect(recallLink(store, "s1")).toBeNull();
    expect(recallLink(store, `x${LINK_MEMORY_MAX + 4}`)).toBe(
      `https://vivier.app/share/${LINK_MEMORY_MAX + 4}`,
    );
  });

  it("reads nothing from a missing, malformed or foreign value, and nothing without a store", () => {
    expect(readLinks(null)).toEqual([]);
    expect(recallLink(null, "s1")).toBeNull();
    expect(readLinks(fakeStore({ [LINK_MEMORY_KEY]: "not json" }))).toEqual([]);
    expect(readLinks(fakeStore({ [LINK_MEMORY_KEY]: JSON.stringify({ s1: "x" }) }))).toEqual([]);
    expect(
      readLinks(
        fakeStore({
          [LINK_MEMORY_KEY]: JSON.stringify([["s1", "https://a"], ["bad"], [3, 4], "x"]),
        }),
      ),
    ).toEqual([["s1", "https://a"]]);
  });

  it("survives a storage that throws", () => {
    const broken: LinkStore = {
      getItem: () => {
        throw new Error("blocked");
      },
      setItem: () => {
        throw new Error("blocked");
      },
    };
    expect(readLinks(broken)).toEqual([]);
    expect(() => rememberLink(broken, "s1", "https://a")).not.toThrow();
    expect(recallLink(broken, "s1")).toBeNull();
  });
});
