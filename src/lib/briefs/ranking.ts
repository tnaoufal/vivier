/**
 * The comparative tiering lives in the shared package
 * (packages/analysis/src/ranking.ts, "@vivier/analysis"), used by the
 * web app and the processor alike; this module re-exports it so every
 * web import keeps its path. Behaviour unchanged; the tests sit next to
 * the package's module.
 */
export {
  applyRanking,
  RANK_GROUP_MAX,
  RANK_GROUP_MIN,
  rankingPayload,
  rankingSheets,
  rankingSystemPrompt,
  sortByTier,
  type ModelRankingAnswer,
  type RankingPayload,
  type RankingRequirement,
  type RankingSheet,
} from "@vivier/analysis";
