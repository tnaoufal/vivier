import type { SupabaseClient } from "@supabase/supabase-js";
import { describe, expect, it } from "vitest";

import {
  SIMILAR_COLUMNS,
  guardSimilarRow,
  guardSimilarRows,
  listSimilar,
  mergeSimilar,
  orderBy,
  percentOf,
  type SimilarProfileRow,
} from "./similar";

const A = "11111111-1111-4111-8111-111111111111";
const B = "22222222-2222-4222-8222-222222222222";
const C = "33333333-3333-4333-8333-333333333333";

function profile(id: string, name: string): SimilarProfileRow {
  return { id, full_name: name, headline: null, location: null, skills: [], status: "active" };
}

describe("guardSimilarRow", () => {
  it("accepts the shape the migration promises", () => {
    expect(guardSimilarRow({ candidate_id: A, similarity: 0.82, method: "embedding" })).toEqual({
      candidate_id: A,
      similarity: 0.82,
      method: "embedding",
    });
    expect(guardSimilarRow({ candidate_id: B, similarity: 1, method: "skills" })).toEqual({
      candidate_id: B,
      similarity: 1,
      method: "skills",
    });
    expect(
      guardSimilarRow({ candidate_id: C, similarity: 0, method: "skills", extra: true }),
    ).toEqual({
      candidate_id: C,
      similarity: 0,
      method: "skills",
    });
  });

  it("refuses an id that is not a uuid", () => {
    expect(guardSimilarRow({ candidate_id: "nope", similarity: 0.5, method: "skills" })).toBeNull();
    expect(guardSimilarRow({ candidate_id: 12, similarity: 0.5, method: "skills" })).toBeNull();
    expect(guardSimilarRow({ similarity: 0.5, method: "skills" })).toBeNull();
  });

  it("refuses a similarity that is not a finite number, and clamps one outside 0..1", () => {
    expect(guardSimilarRow({ candidate_id: A, similarity: "0.5", method: "skills" })).toBeNull();
    expect(
      guardSimilarRow({ candidate_id: A, similarity: Number.NaN, method: "skills" }),
    ).toBeNull();
    expect(
      guardSimilarRow({ candidate_id: A, similarity: Number.POSITIVE_INFINITY, method: "skills" }),
    ).toBeNull();
    expect(guardSimilarRow({ candidate_id: A, similarity: -0.1, method: "skills" })?.similarity).toBe(0);
    expect(guardSimilarRow({ candidate_id: A, similarity: 1.0000001, method: "embedding" })?.similarity).toBe(1);
  });

  it("refuses a method it does not know", () => {
    expect(guardSimilarRow({ candidate_id: A, similarity: 0.5, method: "magic" })).toBeNull();
    expect(guardSimilarRow({ candidate_id: A, similarity: 0.5, method: null })).toBeNull();
    expect(guardSimilarRow({ candidate_id: A, similarity: 0.5 })).toBeNull();
  });

  it("refuses anything that is not an object", () => {
    expect(guardSimilarRow(null)).toBeNull();
    expect(guardSimilarRow(undefined)).toBeNull();
    expect(guardSimilarRow("row")).toBeNull();
    expect(guardSimilarRow(42)).toBeNull();
  });
});

describe("guardSimilarRows", () => {
  it("answers nothing for anything but an array", () => {
    expect(guardSimilarRows(null)).toEqual([]);
    expect(guardSimilarRows({ candidate_id: A, similarity: 0.5, method: "skills" })).toEqual([]);
    expect(guardSimilarRows("rows")).toEqual([]);
  });

  it("keeps the order, drops the rows it cannot read and a candidate seen twice", () => {
    const rows = guardSimilarRows([
      { candidate_id: B, similarity: 0.9, method: "embedding" },
      { candidate_id: "broken", similarity: 0.8, method: "embedding" },
      { candidate_id: A, similarity: 0.7, method: "embedding" },
      { candidate_id: B, similarity: 0.6, method: "embedding" },
      null,
    ]);
    expect(rows.map((row) => row.candidate_id)).toEqual([B, A]);
    expect(rows[0]?.similarity).toBe(0.9);
  });
});

describe("orderBy", () => {
  it("follows the ids, skipping the ones without a row and the rows outside the ids", () => {
    const rows = [profile(A, "Ana"), profile(C, "Cléo"), profile(B, "Bao")];
    expect(orderBy([B, "missing", A], rows).map((row) => row.full_name)).toEqual(["Bao", "Ana"]);
  });

  it("answers nothing for no ids", () => {
    expect(orderBy([], [profile(A, "Ana")])).toEqual([]);
  });

  it("keeps an id asked twice twice, as asked", () => {
    expect(orderBy([A, A], [profile(A, "Ana")]).map((row) => row.id)).toEqual([A, A]);
  });
});

describe("percentOf", () => {
  it("rounds to a whole percentage", () => {
    expect(percentOf(0.823)).toBe(82);
    expect(percentOf(0.678)).toBe(68);
    expect(percentOf(1)).toBe(100);
    expect(percentOf(0)).toBe(0);
  });

  it("clamps to 0..100 and reads 0 for what is not a number", () => {
    expect(percentOf(1.2)).toBe(100);
    expect(percentOf(-0.4)).toBe(0);
    expect(percentOf(Number.NaN)).toBe(0);
    expect(percentOf(Number.NEGATIVE_INFINITY)).toBe(0);
  });
});

describe("mergeSimilar", () => {
  it("keeps the database's order and carries the similarity and the method", () => {
    const merged = mergeSimilar(
      [
        { candidate_id: B, similarity: 0.91, method: "embedding" },
        { candidate_id: A, similarity: 0.55, method: "embedding" },
      ],
      [profile(A, "Ana"), profile(B, "Bao")],
    );
    expect(merged.map((row) => row.full_name)).toEqual(["Bao", "Ana"]);
    expect(merged[0]).toMatchObject({ id: B, similarity: 0.91, method: "embedding" });
    expect(merged[1]).toMatchObject({ id: A, similarity: 0.55, method: "embedding" });
  });

  it("leaves out a neighbour whose profile could not be read", () => {
    const merged = mergeSimilar(
      [
        { candidate_id: B, similarity: 0.91, method: "skills" },
        { candidate_id: C, similarity: 0.5, method: "skills" },
      ],
      [profile(B, "Bao")],
    );
    expect(merged.map((row) => row.id)).toEqual([B]);
  });
});

/** A client that answers the RPC and the one read listSimilar makes, and remembers what it was asked. */
function fakeClient(answer: {
  rpc: unknown;
  rows?: SimilarProfileRow[];
  rpcError?: { message: string } | null;
}) {
  const asked: {
    rpc: { fn: string; args: Record<string, unknown> } | null;
    select: string | null;
    eq: [string, string] | null;
    ids: string[] | null;
  } = {
    rpc: null,
    select: null,
    eq: null,
    ids: null,
  };
  const client = {
    rpc: async (fn: string, args: Record<string, unknown>) => {
      asked.rpc = { fn, args };
      return { data: answer.rpc, error: answer.rpcError ?? null };
    },
    from: () => ({
      select: (columns: string) => {
        asked.select = columns;
        return {
          eq: (column: string, value: string) => {
            asked.eq = [column, value];
            return {
              in: async (_column: string, ids: string[]) => {
                asked.ids = ids;
                return { data: answer.rows ?? [], error: null };
              },
            };
          },
        };
      },
    }),
  };
  return { client: client as unknown as SupabaseClient, asked };
}

describe("listSimilar", () => {
  it("asks the RPC for the organisation's neighbours, reads them under the organisation and keeps the order", async () => {
    const { client, asked } = fakeClient({
      rpc: [
        { candidate_id: C, similarity: 0.88, method: "embedding" },
        { candidate_id: A, similarity: 0.61, method: "embedding" },
      ],
      rows: [profile(A, "Ana"), profile(C, "Cléo")],
    });
    const list = await listSimilar(client, "org-1", B);
    expect(asked.rpc).toEqual({
      fn: "similar_candidates",
      args: { p_org: "org-1", p_candidate: B, p_limit: 10 },
    });
    expect(asked.select).toBe(SIMILAR_COLUMNS);
    expect(asked.eq).toEqual(["org_id", "org-1"]);
    expect(asked.ids).toEqual([C, A]);
    expect(list.map((row) => row.full_name)).toEqual(["Cléo", "Ana"]);
    expect(list[0]).toMatchObject({ similarity: 0.88, method: "embedding" });
  });

  it("passes the limit it is given", async () => {
    const { client, asked } = fakeClient({ rpc: [] });
    await listSimilar(client, "org-1", B, 5);
    expect(asked.rpc?.args["p_limit"]).toBe(5);
  });

  it("reads nothing more when the RPC answers nothing or only rows it cannot trust", async () => {
    const empty = fakeClient({ rpc: [] });
    expect(await listSimilar(empty.client, "org-1", B)).toEqual([]);
    expect(empty.asked.ids).toBeNull();

    const broken = fakeClient({ rpc: [{ candidate_id: "x", similarity: 0.5, method: "skills" }] });
    expect(await listSimilar(broken.client, "org-1", B)).toEqual([]);
    expect(broken.asked.ids).toBeNull();
  });

  it("throws the RPC's error", async () => {
    const { client } = fakeClient({ rpc: null, rpcError: { message: "permission denied" } });
    await expect(listSimilar(client, "org-1", B)).rejects.toEqual({ message: "permission denied" });
  });
});
