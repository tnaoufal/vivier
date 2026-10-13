import { describe, expect, it } from "vitest";

import { en, fr } from "./messages";
import { featureMessages } from "./features";
import { formatRelative, translate } from "./index";

describe("dictionaries", () => {
  it("carry the same keys in both languages", () => {
    expect(Object.keys(en).sort()).toEqual(Object.keys(fr).sort());
    expect(Object.keys(featureMessages.en).sort()).toEqual(Object.keys(featureMessages.fr).sort());
  });

  it("never leave a sentence empty", () => {
    for (const dict of [fr, en, featureMessages.fr, featureMessages.en]) {
      for (const [key, value] of Object.entries(dict)) {
        expect(value.trim(), key).not.toBe("");
      }
    }
  });

  it("do not share a key between the common and feature dictionaries", () => {
    const common = new Set(Object.keys(fr));
    for (const key of Object.keys(featureMessages.fr)) expect(common.has(key), key).toBe(false);
  });
});

describe("translate", () => {
  it("fills placeholders and leaves unknown ones alone", () => {
    expect(translate("fr", "common.by", { name: "Ana" })).toBe("par Ana");
    expect(translate("en", "common.by", {})).toBe("by {name}");
  });

  it("answers the key itself for an unknown key", () => {
    expect(translate("en", "nope.nope" as never)).toBe("nope.nope");
  });
});

describe("formatRelative", () => {
  it("speaks both languages", () => {
    const now = Date.parse("2026-10-13T10:00:00Z");
    expect(formatRelative("en", "2026-10-13T09:57:00Z", now)).toMatch(/3 min/);
    expect(formatRelative("fr", "2026-10-13T09:57:00Z", now)).toMatch(/3 min/);
  });
});
