/**
 * The proof behind the tokens: WCAG 2.1 relative luminance and contrast
 * ratio, and a reader of the `:root` and `.dark` blocks of styles.css
 * (every `--name: value;` line, a `var()` reference resolved one level),
 * so a test can assert every pair of the charter on the real file.
 * Pure: no DOM, no dependency; `contrast.test.ts` runs it on
 * src/styles.css for both themes.
 */

const HEX = /^#(?:[0-9a-f]{3}|[0-9a-f]{6})$/i;

/** True for `#rgb` or `#rrggbb` (an `rgba()` value, say, is not a hex colour). */
export function isHex(value: string): boolean {
  return HEX.test(value.trim());
}

/** The three channels of a hex colour, 0 to 255. */
export function parseHex(hex: string): [red: number, green: number, blue: number] {
  const value = hex.trim();
  if (!HEX.test(value)) throw new Error(`Not a hex colour: ${hex}`);
  const digits = value.slice(1);
  const full =
    digits.length === 3
      ? digits
          .split("")
          .map((digit) => digit + digit)
          .join("")
      : digits;
  return [
    Number.parseInt(full.slice(0, 2), 16),
    Number.parseInt(full.slice(2, 4), 16),
    Number.parseInt(full.slice(4, 6), 16),
  ];
}

/** One sRGB channel (0 to 255) made linear, as WCAG 2.1 defines it. */
function linear(channel: number): number {
  const c = channel / 255;
  return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
}

/** WCAG 2.1 relative luminance: 0 for black, 1 for white. */
export function relativeLuminance(hex: string): number {
  const [red, green, blue] = parseHex(hex);
  return 0.2126 * linear(red) + 0.7152 * linear(green) + 0.0722 * linear(blue);
}

/** WCAG 2.1 contrast ratio between two colours, from 1 (the same) to 21 (black on white), whatever their order. */
export function contrastRatio(hexA: string, hexB: string): number {
  const a = relativeLuminance(hexA);
  const b = relativeLuminance(hexB);
  const [light, dark] = a >= b ? [a, b] : [b, a];
  return (light + 0.05) / (dark + 0.05);
}

const COMMENT = /\/\*[\s\S]*?\*\//g;
const BLOCK = /([^{}]*)\{([^{}]*)\}/g;
const DECLARATION = /--([\w-]+)\s*:\s*([^;]+);/g;
const REFERENCE = /^var\(--([\w-]+)\)$/;

/**
 * The custom properties declared for `selector` (":root", ".dark") in a
 * stylesheet: every `--name: value;` of every block whose selector list
 * names it (so `:root, .share-sheet { … }` counts for ":root"), later
 * blocks winning, a value that is `var(--other)` resolved one level
 * when `--other` is declared in the same map. Comments are ignored;
 * nested blocks (keyframes inside `@theme`) are read as their own
 * innermost blocks and never as `:root`.
 */
export function readTokens(css: string, selector: string): Map<string, string> {
  const tokens = new Map<string, string>();
  const clean = css.replace(COMMENT, "");
  const wanted = selector.trim();
  for (const match of clean.matchAll(BLOCK)) {
    const head = match[1] ?? "";
    const body = match[2] ?? "";
    // What precedes the brace may hold earlier at-rules (`@import …;`): the selector is the last statement.
    const selectors = (head.split(";").pop() ?? "").split(",").map((part) => part.trim());
    if (!selectors.includes(wanted)) continue;
    for (const declaration of body.matchAll(DECLARATION)) {
      const name = declaration[1];
      const value = declaration[2];
      if (name && value) tokens.set(name, value.trim());
    }
  }
  for (const [name, value] of tokens) {
    const reference = REFERENCE.exec(value);
    const resolved = reference?.[1] ? tokens.get(reference[1]) : undefined;
    if (resolved !== undefined) tokens.set(name, resolved);
  }
  return tokens;
}
