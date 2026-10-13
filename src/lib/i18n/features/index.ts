/**
 * Feature dictionaries, one file per feature so teams can work on them
 * apart. Each file exports `{ fr, en }` with the same keys; the merge
 * below keeps every key typed.
 */
import { briefs } from "./briefs";
import { candidates } from "./candidates";
import { shares } from "./shares";
import { shell } from "./shell";
import { shortlists } from "./shortlists";
import { similar } from "./similar";
import { team } from "./team";

const files = [shell, team, candidates, briefs, shortlists, shares, similar] as const;

type Keys<T> = T extends { fr: infer F } ? keyof F : never;
export type FeatureMessageKey = Keys<(typeof files)[number]> & string;

function merge(locale: "fr" | "en"): Record<string, string> {
  return Object.assign({}, ...files.map((file) => file[locale])) as Record<string, string>;
}

export const featureMessages = { fr: merge("fr"), en: merge("en") };
