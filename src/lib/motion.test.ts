import { describe, expect, it } from "vitest";

import {
  DURATION,
  STAGGER_CAP,
  STAGGER_MS,
  effectiveDuration,
  prefersReducedMotion,
  readsReducedMotion,
  reducedMotionQuery,
  staggerDelay,
  staggerVars,
  subscribeReducedMotion,
  type MediaQueryLike,
} from "./motion";

describe("staggerDelay", () => {
  it("waits one step more per row, from zero", () => {
    expect(staggerDelay(0)).toBe(0);
    expect(staggerDelay(1)).toBe(STAGGER_MS);
    expect(staggerDelay(3)).toBe(3 * STAGGER_MS);
  });

  it("stops growing past the cap", () => {
    expect(staggerDelay(STAGGER_CAP)).toBe(STAGGER_CAP * STAGGER_MS);
    expect(staggerDelay(STAGGER_CAP + 40)).toBe(STAGGER_CAP * STAGGER_MS);
    expect(staggerDelay(10, 50, 4)).toBe(200);
  });

  it("reads an odd index as the row before it", () => {
    expect(staggerDelay(-2)).toBe(0);
    expect(staggerDelay(2.9)).toBe(2 * STAGGER_MS);
    expect(staggerDelay(Number.NaN)).toBe(0);
    expect(staggerDelay(Number.POSITIVE_INFINITY)).toBe(0);
  });

  it("never answers a negative delay", () => {
    expect(staggerDelay(3, -10)).toBe(0);
    expect(staggerDelay(3, 40, -1)).toBe(0);
  });
});

describe("staggerVars", () => {
  it("writes the row into --i, capped", () => {
    expect(staggerVars(0)).toEqual({ "--i": 0 });
    expect(staggerVars(7)).toEqual({ "--i": 7 });
    expect(staggerVars(99)).toEqual({ "--i": STAGGER_CAP });
    expect(staggerVars(99, 3)).toEqual({ "--i": 3 });
    expect(staggerVars(-1)).toEqual({ "--i": 0 });
  });
});

describe("reduced motion", () => {
  function fakeQuery(matches: boolean) {
    const listeners = new Set<() => void>();
    const query: MediaQueryLike = {
      matches,
      addEventListener: (_type, listener) => void listeners.add(listener),
      removeEventListener: (_type, listener) => void listeners.delete(listener),
    };
    return { query, listeners };
  }

  it("reads the preference from the query and defaults to motion", () => {
    expect(readsReducedMotion(fakeQuery(true).query)).toBe(true);
    expect(readsReducedMotion(fakeQuery(false).query)).toBe(false);
    expect(readsReducedMotion(null)).toBe(false);
    expect(readsReducedMotion(undefined)).toBe(false);
  });

  it("has no query on the server, so motion stays on", () => {
    expect(reducedMotionQuery()).toBeNull();
    expect(prefersReducedMotion()).toBe(false);
  });

  it("follows the query until unsubscribed", () => {
    const { query, listeners } = fakeQuery(false);
    let calls = 0;
    const stop = subscribeReducedMotion(() => {
      calls += 1;
    }, query);
    expect(listeners.size).toBe(1);
    for (const listener of listeners) listener();
    expect(calls).toBe(1);
    stop();
    expect(listeners.size).toBe(0);
  });

  it("subscribes to nothing without a query", () => {
    const stop = subscribeReducedMotion(() => {}, null);
    expect(typeof stop).toBe("function");
    expect(() => stop()).not.toThrow();
  });
});

describe("effectiveDuration", () => {
  it("keeps the charter's durations unless motion is reduced", () => {
    expect(effectiveDuration(DURATION.base, false)).toBe(180);
    expect(effectiveDuration(DURATION.slow, true)).toBe(0);
    expect(effectiveDuration(-5, false)).toBe(0);
  });
});
