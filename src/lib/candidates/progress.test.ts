import { describe, expect, it } from "vitest";

import {
  THROUGHPUT_WINDOW_MINUTES,
  earliestOf,
  formatThroughput,
  progressOf,
  waveOf,
  type ProcessingWave,
} from "./progress";

const STARTED = "2026-10-14T08:00:00.000Z";

describe("waveOf", () => {
  it("answers an empty wave when nothing is pending and no start was followed", () => {
    const wave = waveOf({ pending: 0, done: 0, leftInWindow: 40, startedAt: null });
    expect(wave).toEqual({
      pending: 0,
      total: 0,
      done: 0,
      startedAt: null,
      throughputPerMinute: null,
      etaMinutes: null,
    });
  });

  it("keeps the start of an ended wave that read nothing, so the caller knows it was counted", () => {
    const wave = waveOf({ pending: 0, done: 0, leftInWindow: 0, startedAt: STARTED });
    expect(wave.total).toBe(0);
    expect(wave.startedAt).toBe(STARTED);
  });

  it("answers the ended wave when nothing is pending but documents left the queue since the start followed", () => {
    const wave = waveOf({ pending: 0, done: 980, leftInWindow: 40, startedAt: STARTED });
    expect(wave).toEqual({
      pending: 0,
      total: 980,
      done: 980,
      startedAt: STARTED,
      throughputPerMinute: null,
      etaMinutes: null,
    });
  });

  it("counts the wave as the pending plus what left the queue, and the rate over the window", () => {
    const wave = waveOf({ pending: 764, done: 216, leftInWindow: 60, startedAt: STARTED });
    expect(wave.pending).toBe(764);
    expect(wave.total).toBe(980);
    expect(wave.done).toBe(216);
    expect(wave.startedAt).toBe(STARTED);
    expect(wave.throughputPerMinute).toBe(60 / THROUGHPUT_WINDOW_MINUTES);
    expect(wave.etaMinutes).toBeCloseTo(764 / 12, 6);
  });

  it("has no throughput, and no estimate, when nothing left the queue over the window", () => {
    const wave = waveOf({ pending: 10, done: 0, leftInWindow: 0, startedAt: STARTED });
    expect(wave.total).toBe(10);
    expect(wave.done).toBe(0);
    expect(wave.throughputPerMinute).toBeNull();
    expect(wave.etaMinutes).toBeNull();
  });

  it("takes another window and ignores counts that are not numbers", () => {
    const wave = waveOf({
      pending: 3,
      done: 6,
      leftInWindow: 9,
      startedAt: STARTED,
      windowMinutes: 3,
    });
    expect(wave.total).toBe(9);
    expect(wave.throughputPerMinute).toBe(3);
    expect(wave.etaMinutes).toBe(1);
    const odd = waveOf({ pending: Number.NaN, done: 5, leftInWindow: 5, startedAt: STARTED });
    expect(odd.pending).toBe(0);
    expect(odd.total).toBe(5);
    const negative = waveOf({ pending: 4, done: -2, leftInWindow: -1, startedAt: STARTED });
    expect(negative.total).toBe(4);
    expect(negative.throughputPerMinute).toBeNull();
  });
});

describe("earliestOf", () => {
  const LATER = "2026-10-14T09:30:00.000Z";

  it("keeps the earlier instant whichever side it is on", () => {
    expect(earliestOf(STARTED, LATER)).toBe(STARTED);
    expect(earliestOf(LATER, STARTED)).toBe(STARTED);
    expect(earliestOf(STARTED, STARTED)).toBe(STARTED);
  });

  it("answers the one given when the other is null or does not parse", () => {
    expect(earliestOf(null, STARTED)).toBe(STARTED);
    expect(earliestOf(STARTED, null)).toBe(STARTED);
    expect(earliestOf("not a date", STARTED)).toBe(STARTED);
    expect(earliestOf(STARTED, "not a date")).toBe(STARTED);
    expect(earliestOf(null, null)).toBeNull();
    expect(earliestOf("not a date", null)).toBeNull();
  });

  it("compares instants, not strings: the database's offset notation against the browser's", () => {
    expect(earliestOf("2026-10-14T10:00:00+02:00", STARTED)).toBe(STARTED);
    expect(earliestOf("2026-10-14T09:00:00+02:00", STARTED)).toBe("2026-10-14T09:00:00+02:00");
  });
});

function wave(partial: Partial<ProcessingWave>): ProcessingWave {
  return {
    pending: 0,
    total: 0,
    done: 0,
    startedAt: null,
    throughputPerMinute: null,
    etaMinutes: null,
    ...partial,
  };
}

describe("progressOf", () => {
  it("is inactive and at zero on an empty wave", () => {
    expect(progressOf(wave({}))).toEqual({
      active: false,
      done: 0,
      total: 0,
      pending: 0,
      percent: 0,
      throughput: null,
      etaMinutes: null,
    });
  });

  it("is inactive and at a hundred on an ended wave", () => {
    const progress = progressOf(wave({ pending: 0, total: 980, done: 980, startedAt: STARTED }));
    expect(progress.active).toBe(false);
    expect(progress.percent).toBe(100);
    expect(progress.total).toBe(980);
  });

  it("rounds the percent and keeps the figures", () => {
    const progress = progressOf(wave({ pending: 764, total: 980, done: 216, startedAt: STARTED }));
    expect(progress.active).toBe(true);
    expect(progress.done).toBe(216);
    expect(progress.total).toBe(980);
    expect(progress.pending).toBe(764);
    // 216 / 980 = 22.04 %
    expect(progress.percent).toBe(22);
  });

  it("says no throughput and no estimate while the rate is not measured", () => {
    const progress = progressOf(wave({ pending: 10, total: 10, done: 0, startedAt: STARTED }));
    expect(progress.throughput).toBeNull();
    expect(progress.etaMinutes).toBeNull();
    expect(progress.percent).toBe(0);
  });

  it("rounds the throughput to one decimal and the estimate up to whole minutes, at least one", () => {
    const fast = progressOf(
      wave({
        pending: 764,
        total: 980,
        done: 216,
        startedAt: STARTED,
        throughputPerMinute: 12.345,
        etaMinutes: 764 / 12.345,
      }),
    );
    expect(fast.throughput).toBe(12.3);
    // 61.9 minutes left: said as 62, never 61.
    expect(fast.etaMinutes).toBe(62);

    const almostDone = progressOf(
      wave({
        pending: 1,
        total: 100,
        done: 99,
        startedAt: STARTED,
        throughputPerMinute: 12,
        etaMinutes: 1 / 12,
      }),
    );
    expect(almostDone.etaMinutes).toBe(1);

    const slow = progressOf(
      wave({
        pending: 5,
        total: 5,
        done: 0,
        startedAt: STARTED,
        throughputPerMinute: 0.02,
        etaMinutes: 250,
      }),
    );
    // A rate that rounds to nothing is still a rate: the smallest the sentence can say.
    expect(slow.throughput).toBe(0.1);
    expect(slow.etaMinutes).toBe(250);
  });

  it("never reaches 100 % while something is pending", () => {
    const progress = progressOf(wave({ pending: 1, total: 1000, done: 999, startedAt: STARTED }));
    expect(progress.active).toBe(true);
    expect(progress.percent).toBe(99);
  });
});

describe("formatThroughput", () => {
  it("writes one decimal at most in the locale's notation", () => {
    expect(formatThroughput("fr", 12.3)).toBe("12,3");
    expect(formatThroughput("en", 12.3)).toBe("12.3");
    expect(formatThroughput("fr", 12)).toBe("12");
    expect(formatThroughput("en", 0.1)).toBe("0.1");
    expect(formatThroughput("en", Number.NaN)).toBe("0");
  });
});
