/**
 * The contrast proof of the charter, v4, on the real stylesheet: every
 * pair the plane relies on, in both themes, and the mirror (every token
 * of `:root` exists in `.dark` and back).
 *
 * Why it would have failed on v3 (the values before part B, computed
 * with the same functions): v3 had no `--hover` and no `--thread`, so
 * the pairs "muted-foreground on hover" and "muted-foreground on thread"
 * had nothing to read (the row under the pointer was `bg-muted/50`, an
 * alpha tint no test could see). The ratios v3 did have passed, with
 * the thin margins the founder saw: muted-foreground #6f6f6f on muted
 * #f4f4f4 = 4.57 (v4: #5f5f5f on #efefef = 5.55), muted #f4f4f4 on
 * paper = 1.10 (v4: #efefef = 1.15, the selected row now reads as
 * selected), line #e6e6e6 on paper = 1.25 (v4: #dedede = 1.35), and
 * the card on the page = 1.00 with a 6 percent hairline, which no
 * ratio fixes and the plane removes (lines, not cards). v4, light:
 * foreground 19.80, muted-foreground on page 6.39, on muted 5.55, on
 * hover 5.86, on thread 5.96, ink-soft on muted 10.99, negative 6.39,
 * inverse-muted 8.33, line 1.35, input 1.67, muted 1.15, neutral 1.67.
 * v4, dark: foreground 18.16, muted-foreground on page 8.33, on muted
 * 7.17, on hover 7.75, on thread 8.06, ink-soft on muted 11.50,
 * negative 8.33, inverse-muted 5.86, line 1.38, input 1.74, muted 1.16,
 * neutral 2.87.
 */
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

import { contrastRatio, isHex, readTokens, relativeLuminance } from "./contrast";

const css = readFileSync(new URL("../../styles.css", import.meta.url), "utf8");

/** A hex or an rgba() anywhere in the value: a colour, or a shadow drawn with one. */
function carriesColour(value: string): boolean {
  return /#[0-9a-f]{3,6}\b|rgba?\(/i.test(value);
}
const THEMES = { light: readTokens(css, ":root"), dark: readTokens(css, ".dark") } as const;

/** [the text or the mark, the surface it sits on, the least ratio]. */
const PAIRS: readonly [text: string, surface: string, min: number][] = [
  ["foreground", "background", 12],
  ["muted-foreground", "background", 4.5],
  ["muted-foreground", "muted", 4.5],
  ["muted-foreground", "hover", 4.5],
  ["muted-foreground", "thread", 4.5],
  ["ink-soft", "muted", 7],
  ["primary-foreground", "primary", 12],
  ["negative", "background", 4.5],
  ["inverse-foreground", "inverse", 12],
  ["inverse-muted-foreground", "inverse", 4.5],
  ["line", "background", 1.2],
  ["input", "background", 1.4],
  ["muted", "background", 1.08],
  ["neutral", "background", 1.5],
];

describe("contrast", () => {
  it("computes the known luminances and ratios", () => {
    expect(relativeLuminance("#ffffff")).toBe(1);
    expect(relativeLuminance("#000000")).toBe(0);
    expect(contrastRatio("#000000", "#ffffff")).toBe(21);
    expect(contrastRatio("#ffffff", "#000000")).toBe(21);
    expect(contrastRatio("#767676", "#ffffff")).toBeCloseTo(4.54, 2);
    expect(contrastRatio("#fff", "#fff")).toBe(1);
    expect(() => contrastRatio("rgba(0, 0, 0, 0.4)", "#ffffff")).toThrow(/hex/);
  });

  it("reads a block's tokens, resolves one var() and skips comments", () => {
    const sample = `
      @import "x"; :root,
      .share-sheet { --a: #ffffff; /* --no: #000000; */ --b: var(--a); --c: rgba(0, 0, 0, 0.4); }
      .dark { --a: #0a0a0a; }
      @theme inline { --color-a: var(--a); @keyframes k { from { --d: #123456; } } }
    `;
    const root = readTokens(sample, ":root");
    expect(root.get("a")).toBe("#ffffff");
    expect(root.get("b")).toBe("#ffffff");
    expect(root.get("c")).toBe("rgba(0, 0, 0, 0.4)");
    expect(root.has("no")).toBe(false);
    expect(root.has("d")).toBe(false);
    expect(root.has("color-a")).toBe(false);
    expect(readTokens(sample, ".share-sheet").get("a")).toBe("#ffffff");
    expect(readTokens(sample, ".dark").get("a")).toBe("#0a0a0a");
    expect(isHex("#dedede")).toBe(true);
    expect(isHex("rgba(10, 10, 10, 0.4)")).toBe(false);
  });
});

describe("tokens v4", () => {
  it("declares both themes", () => {
    expect(THEMES.light.size).toBeGreaterThan(30);
    expect(THEMES.dark.size).toBeGreaterThan(30);
  });

  it("mirrors every colour of :root in .dark and back", () => {
    // Motion and layer tokens (durations, z-indexes) live in :root alone: only what carries a colour mirrors.
    const light = [...THEMES.light]
      .filter(([, value]) => carriesColour(value))
      .map(([name]) => name)
      .sort();
    const dark = [...THEMES.dark.keys()].sort();
    expect(dark).toEqual(light);
  });

  it("never carries a sidebar token", () => {
    expect([...THEMES.light.keys()].filter((name) => name.startsWith("sidebar"))).toEqual([]);
  });

  for (const theme of ["light", "dark"] as const) {
    describe(theme, () => {
      for (const [text, surface, min] of PAIRS) {
        it(`${text} on ${surface} ≥ ${min}`, () => {
          const a = THEMES[theme].get(text);
          const b = THEMES[theme].get(surface);
          expect(a, `--${text} missing in ${theme}`).toBeDefined();
          expect(b, `--${surface} missing in ${theme}`).toBeDefined();
          // An rgba() value (the scrim) cannot be rated against a surface: such a pair is left out.
          if (!a || !b || !isHex(a) || !isHex(b)) return;
          const ratio = contrastRatio(a, b);
          expect(ratio, `${a} on ${b} = ${ratio.toFixed(2)}`).toBeGreaterThanOrEqual(min);
        });
      }
    });
  }
});
