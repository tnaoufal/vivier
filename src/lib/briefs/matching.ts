/**
 * The explained matching lives in the shared package
 * (packages/analysis/src/matching.ts, "@vivier/analysis"), used by the
 * web app and the processor alike; this module re-exports it so every
 * web import keeps its path. Behaviour unchanged; the tests sit next to
 * the package's module.
 */
export {
  compareResults,
  containsWord,
  escapeRegExp,
  evaluateCriterion,
  evaluatedCount,
  firstNumber,
  languageKey,
  levelRank,
  normalise,
  POINTS,
  rankResults,
  roleWords,
  sameLanguage,
  scoreCandidate,
  snippet,
  type MatchProfile,
  type Retrieval,
} from "@vivier/analysis";
