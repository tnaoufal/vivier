import type { SupabaseClient } from "@supabase/supabase-js";
import { describe, expect, it } from "vitest";

import {
  analysisOfSummary,
  CANDIDATE_LOT,
  listScreened,
  listSetAside,
  readCandidatesById,
  readCandidateYears,
  readLatestAnalyses,
  readRetainedCounts,
  readShortlistState,
  readTriageProgress,
  SEARCH_SUMMARY_COLUMNS,
} from "./queries";

/** One method called on a query, with its arguments. */
interface Call {
  name: string;
  args: unknown[];
}

interface FakeAnswer {
  data: unknown;
  error: { code: string; message: string } | null;
  count?: number | null;
}

/** The part of a query builder the reads under test call; awaiting it answers. */
interface FakeBuilder extends PromiseLike<FakeAnswer> {
  select(...args: unknown[]): FakeBuilder;
  eq(...args: unknown[]): FakeBuilder;
  in(...args: unknown[]): FakeBuilder;
  is(...args: unknown[]): FakeBuilder;
  not(...args: unknown[]): FakeBuilder;
  gt(...args: unknown[]): FakeBuilder;
  order(...args: unknown[]): FakeBuilder;
  range(...args: unknown[]): FakeBuilder;
  limit(...args: unknown[]): FakeBuilder;
  maybeSingle(...args: unknown[]): FakeBuilder;
}

/**
 * A supabase-js client that answers every query from `answer`, given the
 * calls the query made (`from` first), and keeps those calls so a test
 * can read what was asked: no network.
 */
function fakeSupabase(answer: (calls: readonly Call[]) => FakeAnswer) {
  const queries: Call[][] = [];
  const from = (table: string) => {
    const calls: Call[] = [{ name: "from", args: [table] }];
    queries.push(calls);
    const step =
      (name: string) =>
      (...args: unknown[]): FakeBuilder => {
        calls.push({ name, args });
        return builder;
      };
    const builder: FakeBuilder = {
      select: step("select"),
      eq: step("eq"),
      in: step("in"),
      is: step("is"),
      not: step("not"),
      gt: step("gt"),
      order: step("order"),
      range: step("range"),
      limit: step("limit"),
      maybeSingle: step("maybeSingle"),
      then(onFulfilled, onRejected) {
        return Promise.resolve()
          .then(() => answer(calls))
          .then(onFulfilled, onRejected);
      },
    };
    return builder;
  };
  return { supabase: { from } as unknown as SupabaseClient, queries };
}

function argsOf(calls: readonly Call[], name: string): unknown[][] {
  return calls.filter((call) => call.name === name).map((call) => call.args);
}

describe("SEARCH_SUMMARY_COLUMNS", () => {
  it("names the summary columns and the job's columns a list reads, never the results", () => {
    const columns = SEARCH_SUMMARY_COLUMNS.split(",").map((column) => column.trim());
    for (const column of [
      "id",
      "created_at",
      "method",
      "pool_size",
      "result_count",
      "assessed_count",
      "match_count",
      "near_count",
      "status",
      "stage",
      "progress_done",
      "progress_total",
      "stop_requested",
      "error",
      "started_at",
      "finished_at",
    ])
      expect(columns).toContain(column);
    expect(columns).not.toContain("results");
    expect(columns).not.toContain("*");
  });
});

describe("analysisOfSummary", () => {
  it("reads an analysis off the summary columns of a row, where its job stands among them", () => {
    expect(
      analysisOfSummary({
        id: "s1",
        brief_id: "b1",
        created_at: "2026-10-14T09:00:00Z",
        method: "triage",
        status: "running",
        pool_size: 1091,
        result_count: 140,
        assessed_count: 96,
        match_count: 12,
        near_count: 9,
        results: "never read",
      }),
    ).toEqual({
      briefId: "b1",
      analysis: {
        searchId: "s1",
        createdAt: "2026-10-14T09:00:00Z",
        method: "triage",
        status: "running",
        poolSize: 1091,
        total: 140,
        assessed: 96,
        matches: 12,
        near: 9,
        present: 12,
        triagePending: null,
        kept: null,
      },
    });
  });

  it("reads a missing count as 0, a missing pool size as null, an unknown method as text and a missing or unknown status as done", () => {
    const read = analysisOfSummary({
      id: "s2",
      brief_id: "b2",
      created_at: "2026-10-14T09:00:00Z",
      method: "other",
      result_count: -3,
      match_count: Number.NaN,
    });
    expect(read?.analysis).toEqual({
      searchId: "s2",
      createdAt: "2026-10-14T09:00:00Z",
      method: "text",
      status: "done",
      poolSize: null,
      total: 0,
      assessed: 0,
      matches: 0,
      near: 0,
      present: 0,
      triagePending: null,
      kept: null,
    });
    expect(
      analysisOfSummary({ id: "s3", brief_id: "b3", created_at: "2026-10-14", status: "paused" })
        ?.analysis.status,
    ).toBe("done");
  });

  it("answers null for a row without its id, its brief or its date", () => {
    expect(analysisOfSummary({ brief_id: "b", created_at: "2026-10-14" })).toBeNull();
    expect(analysisOfSummary({ id: "s", created_at: "2026-10-14" })).toBeNull();
    expect(analysisOfSummary({ id: "s", brief_id: null, created_at: "2026-10-14" })).toBeNull();
    expect(analysisOfSummary({ id: "s", brief_id: "b" })).toBeNull();
  });
});

describe("listSetAside", () => {
  it("reads the first page of the profiles the triage set aside (no, unknown), ordered by candidate, with the count of all", async () => {
    const { supabase, queries } = fakeSupabase(() => ({
      data: [
        { candidate_id: "c1", verdict: "no", reason: "Comptable fournisseurs." },
        { candidate_id: "c2", verdict: "unknown", reason: null },
        { candidate_id: "c3", verdict: "yes", reason: "ignored" },
        { candidate_id: 7, verdict: "no", reason: "ignored" },
      ],
      error: null,
      count: 812,
    }));
    const page = await listSetAside(supabase, "org", "search", { after: null, limit: 50 });
    expect(page).toEqual({
      rows: [
        { candidateId: "c1", verdict: "no", reason: "Comptable fournisseurs." },
        { candidateId: "c2", verdict: "unknown", reason: null },
      ],
      total: 812,
    });
    const calls = queries[0] ?? [];
    expect(argsOf(calls, "from")).toEqual([["search_triage"]]);
    expect(argsOf(calls, "select")).toEqual([
      ["candidate_id, verdict, reason", { count: "exact" }],
    ]);
    expect(argsOf(calls, "eq")).toEqual([
      ["org_id", "org"],
      ["search_id", "search"],
    ]);
    expect(argsOf(calls, "in")).toEqual([["verdict", ["no", "unknown"]]]);
    expect(argsOf(calls, "gt")).toEqual([]);
    expect(argsOf(calls, "order")).toEqual([["candidate_id", { ascending: true }]]);
    expect(argsOf(calls, "range")).toEqual([[0, 49]]);
  });

  it("starts each next page after the last id read, without counting again", async () => {
    const { supabase, queries } = fakeSupabase(() => ({
      data: [{ candidate_id: "c9", verdict: "no", reason: "Autre métier." }],
      error: null,
      count: null,
    }));
    expect(await listSetAside(supabase, "org", "search", { after: "c2", limit: 50 })).toEqual({
      rows: [{ candidateId: "c9", verdict: "no", reason: "Autre métier." }],
      total: null,
    });
    const calls = queries[0] ?? [];
    expect(argsOf(calls, "select")).toEqual([["candidate_id, verdict, reason", undefined]]);
    expect(argsOf(calls, "gt")).toEqual([["candidate_id", "c2"]]);
    expect(argsOf(calls, "range")).toEqual([[0, 49]]);
  });

  it("keeps a page inside one PostgREST page and at one row at least", async () => {
    const { supabase, queries } = fakeSupabase(() => ({ data: [], error: null, count: 0 }));
    await listSetAside(supabase, "org", "search", { after: null, limit: 5000 });
    await listSetAside(supabase, "org", "search", { after: null, limit: 0 });
    expect(argsOf(queries[0] ?? [], "range")).toEqual([[0, 999]]);
    expect(argsOf(queries[1] ?? [], "range")).toEqual([[0, 0]]);
  });

  it("throws an error", async () => {
    const { supabase } = fakeSupabase(() => ({
      data: null,
      error: { code: "42501", message: "permission denied" },
    }));
    await expect(
      listSetAside(supabase, "org", "search", { after: null, limit: 50 }),
    ).rejects.toEqual({ code: "42501", message: "permission denied" });
  });
});

describe("listScreened", () => {
  it("reads the first page of the kept profiles with a score, best first, the ones in the results left out, with the count of all", async () => {
    const { supabase, queries } = fakeSupabase(() => ({
      data: [
        { candidate_id: "c1", verdict: "yes", score: 82, score_reason: "Senior, huit ans." },
        { candidate_id: "c2", verdict: "close", score: 64, score_reason: null },
        { candidate_id: "in-results", verdict: "yes", score: 60, score_reason: "late" },
        { candidate_id: "c4", verdict: "yes", score: null, score_reason: "unscored" },
        { candidate_id: "c5", verdict: "no", score: 50, score_reason: "ignored" },
        { candidate_id: 7, verdict: "yes", score: 40, score_reason: "ignored" },
      ],
      error: null,
      count: 328,
    }));
    const page = await listScreened(supabase, "org", "search", {
      exclude: ["in-results", "other"],
      from: 0,
      limit: 50,
    });
    expect(page).toEqual({
      rows: [
        { candidateId: "c1", verdict: "yes", score: 82, reason: "Senior, huit ans." },
        { candidateId: "c2", verdict: "close", score: 64, reason: null },
      ],
      fetched: 6,
      total: 328,
    });
    const calls = queries[0] ?? [];
    expect(argsOf(calls, "from")).toEqual([["search_triage"]]);
    expect(argsOf(calls, "select")).toEqual([
      ["candidate_id, verdict, score, score_reason", { count: "exact" }],
    ]);
    expect(argsOf(calls, "eq")).toEqual([
      ["org_id", "org"],
      ["search_id", "search"],
    ]);
    expect(argsOf(calls, "in")).toEqual([["verdict", ["yes", "close"]]]);
    expect(argsOf(calls, "not")).toEqual([
      ["score", "is", null],
      ["candidate_id", "in", "(in-results,other)"],
    ]);
    expect(argsOf(calls, "order")).toEqual([
      ["score", { ascending: false }],
      ["candidate_id", { ascending: true }],
    ]);
    expect(argsOf(calls, "range")).toEqual([[0, 49]]);
  });

  it("reads the next page by offset, without counting again, and names nothing to leave out when the results are empty", async () => {
    const { supabase, queries } = fakeSupabase(() => ({
      data: [{ candidate_id: "c9", verdict: "close", score: 51, score_reason: "Voisin." }],
      error: null,
      count: null,
    }));
    expect(
      await listScreened(supabase, "org", "search", { exclude: [], from: 50, limit: 50 }),
    ).toEqual({
      rows: [{ candidateId: "c9", verdict: "close", score: 51, reason: "Voisin." }],
      fetched: 1,
      total: null,
    });
    const calls = queries[0] ?? [];
    expect(argsOf(calls, "select")).toEqual([
      ["candidate_id, verdict, score, score_reason", undefined],
    ]);
    expect(argsOf(calls, "not")).toEqual([["score", "is", null]]);
    expect(argsOf(calls, "range")).toEqual([[50, 99]]);
  });

  it("names a hundred ids at most in the query and leaves the rest out here", async () => {
    const exclude = Array.from({ length: 130 }, (_, index) => `x${index}`);
    const { supabase, queries } = fakeSupabase(() => ({
      data: [
        { candidate_id: "x129", verdict: "yes", score: 90, score_reason: null },
        { candidate_id: "kept", verdict: "yes", score: 70, score_reason: null },
      ],
      error: null,
      count: 2,
    }));
    const page = await listScreened(supabase, "org", "search", { exclude, from: 0, limit: 50 });
    expect(page.rows.map((row) => row.candidateId)).toEqual(["kept"]);
    expect(page.fetched).toBe(2);
    const named = argsOf(queries[0] ?? [], "not")[1]?.[2];
    expect(typeof named === "string" ? named.split(",").length : 0).toBe(100);
  });

  it("throws an error", async () => {
    const { supabase } = fakeSupabase(() => ({
      data: null,
      error: { code: "42501", message: "permission denied" },
    }));
    await expect(
      listScreened(supabase, "org", "search", { exclude: [], from: 0, limit: 50 }),
    ).rejects.toEqual({ code: "42501", message: "permission denied" });
  });
});

describe("readTriageProgress", () => {
  it("counts the profiles still to read and the ones kept (yes, close), no row travelling", async () => {
    const { supabase, queries } = fakeSupabase((calls) => ({
      data: null,
      error: null,
      count: argsOf(calls, "is").length ? 30 : 12,
    }));
    expect(await readTriageProgress(supabase, "org", "search")).toEqual({ pending: 30, kept: 12 });
    const [pending, kept] = queries;
    expect(argsOf(pending ?? [], "select")).toEqual([
      ["candidate_id", { head: true, count: "exact" }],
    ]);
    expect(argsOf(pending ?? [], "is")).toEqual([["verdict", null]]);
    expect(argsOf(kept ?? [], "in")).toEqual([["verdict", ["yes", "close"]]]);
  });
});

describe("readLatestAnalyses", () => {
  it("keeps the newest analysis of each brief with where its job stands, reading nothing else", async () => {
    const summary = (id: string, brief: string, at: string, extra: Record<string, unknown>) => ({
      id,
      brief_id: brief,
      created_at: at,
      result_count: 0,
      assessed_count: 0,
      match_count: 0,
      near_count: 0,
      ...extra,
    });
    const { supabase, queries } = fakeSupabase(() => ({
      data: [
        summary("s1", "b1", "2026-10-14T10:00:00Z", { method: "triage", status: "running" }),
        summary("s0", "b1", "2026-10-13T10:00:00Z", { method: "hybrid" }),
        summary("s2", "b2", "2026-10-14T09:00:00Z", {
          method: "triage",
          status: "done",
          result_count: 30,
          assessed_count: 29,
        }),
        summary("s3", "b3", "2026-10-14T08:00:00Z", { method: "hybrid", result_count: 5 }),
      ],
      error: null,
    }));
    const latest = await readLatestAnalyses(supabase, "org", ["b1", "b2", "b3"]);
    expect(latest.get("b1")).toMatchObject({
      searchId: "s1",
      status: "running",
      triagePending: null,
      kept: null,
    });
    expect(latest.get("b2")).toMatchObject({
      searchId: "s2",
      status: "done",
      total: 30,
      assessed: 29,
    });
    expect(latest.get("b3")).toMatchObject({ searchId: "s3", status: "done" });
    expect(queries).toHaveLength(1);
    const calls = queries[0] ?? [];
    expect(argsOf(calls, "from")).toEqual([["searches"]]);
    expect(argsOf(calls, "in")).toEqual([["brief_id", ["b1", "b2", "b3"]]]);
  });

  it("reads nothing for no brief", async () => {
    const { supabase, queries } = fakeSupabase(() => ({ data: [], error: null }));
    expect((await readLatestAnalyses(supabase, "org", [])).size).toBe(0);
    expect(queries).toEqual([]);
  });
});

describe("readCandidatesById", () => {
  it("reads the candidates in lots, each id once, an erased one as null", async () => {
    const ids = Array.from({ length: 230 }, (_, index) => `c${index}`);
    const { supabase, queries } = fakeSupabase((calls) => {
      const asked = (argsOf(calls, "in")[0]?.[1] ?? []) as string[];
      return {
        data: asked.filter((id) => id !== "c5").map((id) => ({ id, full_name: id })),
        error: null,
      };
    });
    const read = await readCandidatesById(supabase, "org", [...ids, "c1", "c2"]);
    expect(queries.map((calls) => (argsOf(calls, "in")[0]?.[1] as string[]).length)).toEqual([
      CANDIDATE_LOT,
      CANDIDATE_LOT,
      30,
    ]);
    expect(read.size).toBe(230);
    expect(read.get("c5")).toBeNull();
    expect(read.get("c229")).toEqual({ id: "c229", full_name: "c229" });
  });

  it("reads nothing for no id", async () => {
    const { supabase, queries } = fakeSupabase(() => ({ data: [], error: null }));
    expect((await readCandidatesById(supabase, "org", [])).size).toBe(0);
    expect(queries).toEqual([]);
  });
});

describe("readRetainedCounts", () => {
  it("counts the retained items of each brief's shortlist, in lots, nothing but them travelling", async () => {
    const { supabase, queries } = fakeSupabase((calls) => {
      const asked = (argsOf(calls, "in")[0]?.[1] ?? []) as string[];
      return {
        data: [
          { brief_id: asked[0], shortlist_items: [{ status: "retained" }, { status: "retained" }] },
          { brief_id: asked[1], shortlist_items: [{ status: "retained" }] },
          { brief_id: asked[2], shortlist_items: null },
          { brief_id: 7, shortlist_items: [{ status: "retained" }] },
        ],
        error: null,
      };
    });
    const ids = Array.from({ length: 60 }, (_, index) => `b${index}`);
    const counts = await readRetainedCounts(supabase, "org", [...ids, "b0"]);
    expect(queries).toHaveLength(2);
    const calls = queries[0] ?? [];
    expect(argsOf(calls, "from")).toEqual([["shortlists"]]);
    expect(argsOf(calls, "select")).toEqual([["brief_id, shortlist_items!inner(status)"]]);
    expect(argsOf(calls, "eq")).toEqual([
      ["org_id", "org"],
      ["shortlist_items.status", "retained"],
    ]);
    expect((argsOf(calls, "in")[0]?.[1] as string[]).length).toBe(50);
    expect(argsOf(queries[1] ?? [], "in")[0]?.[1]).toEqual(ids.slice(50));
    expect(counts.get("b0")).toBe(2);
    expect(counts.get("b1")).toBe(1);
    expect(counts.get("b2")).toBeUndefined();
    expect(counts.get("b50")).toBe(2);
    expect(counts.size).toBe(4);
  });

  it("reads nothing for no brief", async () => {
    const { supabase, queries } = fakeSupabase(() => ({ data: [], error: null }));
    expect((await readRetainedCounts(supabase, "org", [])).size).toBe(0);
    expect(queries).toEqual([]);
  });
});

describe("readShortlistState", () => {
  it("answers the shortlist, its candidates and how many were retained", async () => {
    const { supabase, queries } = fakeSupabase((calls) =>
      argsOf(calls, "from")[0]?.[0] === "shortlists"
        ? { data: { id: "l1" }, error: null }
        : {
            data: [
              { candidate_id: "c1", status: "retained" },
              { candidate_id: "c2", status: "to_review" },
              { candidate_id: "c3", status: "retained" },
              { candidate_id: "c4", status: "dismissed" },
            ],
            error: null,
          },
    );
    expect(await readShortlistState(supabase, "org", "brief")).toEqual({
      shortlistId: "l1",
      candidateIds: ["c1", "c2", "c3", "c4"],
      retained: 2,
    });
    expect(argsOf(queries[1] ?? [], "select")).toEqual([["candidate_id, status"]]);
    expect(argsOf(queries[1] ?? [], "eq")).toEqual([
      ["org_id", "org"],
      ["shortlist_id", "l1"],
    ]);
  });

  it("answers an empty state before the first candidate was added", async () => {
    const { supabase, queries } = fakeSupabase(() => ({ data: null, error: null }));
    expect(await readShortlistState(supabase, "org", "brief")).toEqual({
      shortlistId: null,
      candidateIds: [],
      retained: 0,
    });
    expect(queries).toHaveLength(1);
  });
});

describe("readCandidateYears", () => {
  it("reads the years of one candidate of the organisation, a value that is not a number as none", async () => {
    const { supabase, queries } = fakeSupabase(() => ({
      data: { id: "c1", years_experience: 12 },
      error: null,
    }));
    expect(await readCandidateYears(supabase, "org", "c1")).toEqual({
      id: "c1",
      years_experience: 12,
    });
    const calls = queries[0] ?? [];
    expect(argsOf(calls, "from")).toEqual([["candidates"]]);
    expect(argsOf(calls, "select")).toEqual([["id, years_experience"]]);
    expect(argsOf(calls, "eq")).toEqual([
      ["org_id", "org"],
      ["id", "c1"],
    ]);
    expect(argsOf(calls, "maybeSingle")).toEqual([[]]);
    const odd = fakeSupabase(() => ({ data: { id: "c2", years_experience: "12" }, error: null }));
    expect(await readCandidateYears(odd.supabase, "org", "c2")).toEqual({
      id: "c2",
      years_experience: null,
    });
  });

  it("answers null for a candidate that is gone", async () => {
    const { supabase } = fakeSupabase(() => ({ data: null, error: null }));
    expect(await readCandidateYears(supabase, "org", "c9")).toBeNull();
  });
});
