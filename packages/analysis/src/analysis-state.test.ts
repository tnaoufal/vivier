import { describe, expect, it } from "vitest";

import {
  ANALYSIS_STATUSES,
  assessFailedError,
  isAnalysisStage,
  isAnalysisStatus,
  isTerminalStatus,
  nextStage,
  progressOf,
  STAGE_ORDER,
  STAGE_SPANS,
  stageIndex,
  unreadOf,
  type RemainingWork,
} from "./analysis-state.js";

const done: RemainingWork = {
  briefUnread: false,
  snapshotTaken: true,
  triagePending: 0,
  screenPending: 0,
  promotionPending: false,
  assessPending: 0,
  challengePending: 0,
  rankPending: 0,
  finalPending: false,
};

describe("the statuses and the stages", () => {
  it("names the five statuses, three of them terminal", () => {
    expect(ANALYSIS_STATUSES).toEqual(["queued", "running", "stopped", "done", "failed"]);
    expect(isAnalysisStatus("done")).toBe(true);
    expect(isAnalysisStatus("paused")).toBe(false);
    expect(isAnalysisStatus(null)).toBe(false);
    expect(ANALYSIS_STATUSES.filter(isTerminalStatus)).toEqual(["stopped", "done", "failed"]);
  });

  it("names the nine stages in the order a run takes them", () => {
    expect(STAGE_ORDER).toEqual([
      "reading",
      "snapshot",
      "triage",
      "screening",
      "promotion",
      "assessing",
      "challenging",
      "ranking",
      "final",
    ]);
    expect(isAnalysisStage("triage")).toBe(true);
    expect(isAnalysisStage("read")).toBe(false);
    expect(stageIndex("reading")).toBe(0);
    expect(stageIndex("final")).toBe(8);
  });
});

describe("nextStage", () => {
  it("is null when nothing is left", () => {
    expect(nextStage(done)).toBeNull();
  });

  it("answers the first stage in order that has work left, whatever the later ones hold", () => {
    expect(nextStage({ ...done, briefUnread: true, triagePending: 5 })).toBe("reading");
    expect(nextStage({ ...done, snapshotTaken: false, screenPending: 2 })).toBe("snapshot");
    expect(nextStage({ ...done, triagePending: 1, screenPending: 4 })).toBe("triage");
    expect(nextStage({ ...done, screenPending: 4, promotionPending: true })).toBe("screening");
    expect(nextStage({ ...done, promotionPending: true, assessPending: 3 })).toBe("promotion");
    expect(nextStage({ ...done, assessPending: 3, challengePending: 1 })).toBe("assessing");
    expect(nextStage({ ...done, challengePending: 2, rankPending: 2 })).toBe("challenging");
    expect(nextStage({ ...done, rankPending: 2, finalPending: true })).toBe("ranking");
    expect(nextStage({ ...done, finalPending: true })).toBe("final");
  });
});

describe("progressOf", () => {
  it("owns one contiguous span per stage, from 0 to 100", () => {
    let last = 0;
    for (const stage of STAGE_ORDER) {
      const [start, end] = STAGE_SPANS[stage];
      expect(start).toBe(last);
      expect(end).toBeGreaterThan(start);
      last = end;
    }
    expect(last).toBe(100);
  });

  it("reads a stage's own count as its share of the span, clamped, and a finished run as 100", () => {
    expect(progressOf("reading", 0, 0)).toBe(0);
    expect(progressOf("triage", 0, 100)).toBe(4);
    expect(progressOf("triage", 50, 100)).toBe(24);
    expect(progressOf("triage", 100, 100)).toBe(44);
    expect(progressOf("triage", 150, 100)).toBe(44);
    expect(progressOf("screening", 1, 4)).toBe(49);
    expect(progressOf("assessing", 0, 0)).toBe(66);
    expect(progressOf("ranking", -5, 10)).toBe(95);
    expect(progressOf("assessing", 1, Number.NaN)).toBe(66);
    expect(progressOf("final", 1, 1)).toBe(100);
    expect(progressOf(null, 0, 0)).toBe(100);
  });
});

describe("assessFailedError and unreadOf", () => {
  it("writes and reads the count of failed full readings, nothing else", () => {
    expect(assessFailedError(0)).toBeNull();
    expect(assessFailedError(3)).toBe("assess_failed:3");
    expect(unreadOf("assess_failed:3")).toBe(3);
    expect(unreadOf(assessFailedError(12))).toBe(12);
    expect(unreadOf("assess_failed:0")).toBe(0);
    expect(unreadOf("assess_failed:x")).toBe(0);
    expect(unreadOf("model_unavailable")).toBe(0);
    expect(unreadOf(null)).toBe(0);
    expect(unreadOf(undefined)).toBe(0);
  });
});
