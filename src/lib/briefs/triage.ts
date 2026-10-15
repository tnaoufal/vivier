/**
 * The triage lives in the shared package (packages/analysis/src/triage.ts,
 * "@vivier/analysis"), used by the web app and the processor alike; this
 * module re-exports it so every web import keeps its path. Behaviour
 * unchanged; the tests sit next to the package's module.
 */
export {
  carriesRoleName,
  countTriage,
  enforceTriage,
  isTriageVerdict,
  passesTriage,
  TRIAGE_BATCH_MAX,
  TRIAGE_CONCURRENCY,
  TRIAGE_PASSING,
  TRIAGE_PAYLOAD_MAX,
  TRIAGE_PROFILE_COLUMNS,
  TRIAGE_REASON_MAX,
  TRIAGE_VERDICTS,
  triageCard,
  triageEntries,
  triageOrder,
  triagePayload,
  triageRoleBrief,
  triageRoleTerms,
  triageSystemPrompt,
  type ModelTriageAnswer,
  type TriageBriefSource,
  type TriageCard,
  type TriageCurrent,
  type TriageEntry,
  type TriageOutcome,
  type TriagePayload,
  type TriagePrevious,
  type TriageProfile,
  type TriageRoleBrief,
  type TriageWireCard,
} from "@vivier/analysis";
