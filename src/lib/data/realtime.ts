/**
 * Live updates: subscribe to Postgres changes on a table (filtered, e.g.
 * `org_id=eq.<id>`) and call back on every change. RLS applies to what
 * the browser receives. Returns the unsubscribe; use inside an effect.
 */
import type { SupabaseClient } from "@supabase/supabase-js";

import { loadSupabase } from "@/lib/auth/supabase-client";

export interface RealtimeChange {
  eventType: "INSERT" | "UPDATE" | "DELETE";
  new: Record<string, unknown>;
  old: Record<string, unknown>;
}

let channelSequence = 0;

export function subscribeToTable(
  table: string,
  filter: string | null,
  onChange: (change: RealtimeChange) => void,
): () => void {
  let active = true;
  let cleanup: (() => void) | null = null;
  void loadSupabase().then((supabase: SupabaseClient | null) => {
    if (!active || !supabase) return;
    const name = `${table}:${filter ?? "all"}:${++channelSequence}`;
    const spec: { event: "*"; schema: string; table: string; filter?: string } = filter
      ? { event: "*", schema: "public", table, filter }
      : { event: "*", schema: "public", table };
    const channel = supabase.channel(name).on(
      "postgres_changes",
      spec,
      (payload: { eventType: string; new: unknown; old: unknown }) => {
        onChange({
          eventType: payload.eventType as RealtimeChange["eventType"],
          new: (payload.new ?? {}) as Record<string, unknown>,
          old: (payload.old ?? {}) as Record<string, unknown>,
        });
      },
    );
    channel.subscribe();
    cleanup = () => {
      void supabase.removeChannel(channel);
    };
    if (!active) cleanup();
  });
  return () => {
    active = false;
    cleanup?.();
  };
}

/** Calls `fn` at most once per `ms` after the last call: realtime bursts become one refresh. */
export function debounce(fn: () => void, ms = 250): () => void {
  let timer: ReturnType<typeof setTimeout> | null = null;
  return () => {
    if (timer) clearTimeout(timer);
    timer = setTimeout(() => {
      timer = null;
      fn();
    }, ms);
  };
}
