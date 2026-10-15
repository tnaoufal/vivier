/**
 * The grep oracle of the charter: every component file under src is
 * read, and the test fails on what the tokens forbid, naming each
 * offending file and line. No hard-coded colour class (`bg-white`,
 * `text-black`, a Tailwind grey scale), no hex value outside
 * src/styles.css and the root route's theme-color meta, no `sidebar-`
 * token (the rail replaced it), no `max-w-6xl` centring on a signed-in
 * page (the plane fills the viewport), no `text-caution-foreground` on a
 * full-strength `bg-caution` (the tone is never filled), and
 * `text-background` only beside `bg-ink` on the same line (paper text
 * means an ink fill, nothing else).
 */
import { readdirSync, readFileSync } from "node:fs";
import { join, relative, sep } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const SRC = fileURLToPath(new URL("../../", import.meta.url));

function walk(dir: string, out: string[] = []): string[] {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) walk(path, out);
    else if (entry.isFile()) out.push(path);
  }
  return out;
}

/** The path as the repository names it, with forward slashes on every platform. */
function nameOf(path: string): string {
  return `src/${relative(SRC, path).split(sep).join("/")}`;
}

interface Rule {
  name: string;
  /** True when the line breaks the rule in that file. */
  breaks: (line: string, file: string) => boolean;
}

const RULES: readonly Rule[] = [
  {
    name: "a hard-coded colour class",
    breaks: (line) =>
      /\b(?:bg|text)-(?:white|black)\b/.test(line) ||
      /-(?:gray|zinc|neutral|slate|stone)-\d/.test(line),
  },
  {
    name: "a hex value outside styles.css and the root route",
    breaks: (line, file) => file !== "src/routes/__root.tsx" && /#[0-9a-f]{6}\b/i.test(line),
  },
  { name: "a sidebar token", breaks: (line) => /sidebar-/.test(line) },
  {
    name: "max-w-6xl on a signed-in page",
    breaks: (line, file) => file.startsWith("src/routes/app/") && /max-w-6xl/.test(line),
  },
  {
    name: "text-caution-foreground on a full-strength bg-caution",
    breaks: (line) => /text-caution-foreground/.test(line) && /\bbg-caution\b(?!\/)/.test(line),
  },
  {
    name: "text-background without bg-ink on the same line",
    breaks: (line) => /\btext-background\b/.test(line) && !/\bbg-ink\b/.test(line),
  },
];

describe("classes", () => {
  const files = walk(SRC)
    .filter((path) => path.endsWith(".tsx") && !/\.test\.[^/]+$/.test(path))
    .sort();

  it("finds the components", () => {
    expect(files.length).toBeGreaterThan(20);
  });

  it("never breaks the charter", () => {
    const offenders: string[] = [];
    for (const path of files) {
      const file = nameOf(path);
      const lines = readFileSync(path, "utf8").split("\n");
      lines.forEach((line, index) => {
        for (const rule of RULES) {
          if (rule.breaks(line, file)) offenders.push(`${file}:${index + 1}: ${rule.name}`);
        }
      });
    }
    expect(offenders).toEqual([]);
  });
});
