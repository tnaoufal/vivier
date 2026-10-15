/**
 * The composite score lives in the shared package
 * (packages/analysis/src/scoring.ts, "@vivier/analysis"), used by the
 * web app and the processor alike; this module re-exports it so every
 * web import keeps its path. Behaviour unchanged; the tests sit next to
 * the package's module.
 */
export {
  compositeScore,
  DIMENSION_WEIGHTS,
  DIMENSIONS,
  dimensionScore,
  MET_POINTS,
  NEUTRAL_SCORE,
  requirementsCoverage,
  WEIGHT_CONTEXT,
  WEIGHT_REQUIREMENTS,
  WEIGHT_ROLE,
  WEIGHT_SENIORITY,
  WEIGHT_TRACK,
  type CompositeInput,
} from "@vivier/analysis";
