/**
 * The smallest data hook: run an async read on mount and whenever its
 * key changes, expose the rows, the loading flag, the error and a
 * `refresh()`. Features build on it with supabase-js reads under RLS
 * and refresh on realtime events (see realtime.ts).
 */
import { useCallback, useEffect, useRef, useState } from "react";

export interface QueryState<T> {
  data: T | null;
  loading: boolean;
  error: string | null;
  refresh: () => Promise<void>;
}

export function useQuery<T>(key: string, read: () => Promise<T>, enabled = true): QueryState<T> {
  const [data, setData] = useState<T | null>(null);
  const [loading, setLoading] = useState(enabled);
  const [error, setError] = useState<string | null>(null);
  const readRef = useRef(read);
  readRef.current = read;
  const sequence = useRef(0);

  const refresh = useCallback(async () => {
    if (!enabled) return;
    const mine = ++sequence.current;
    try {
      const next = await readRef.current();
      if (mine === sequence.current) {
        setData(next);
        setError(null);
      }
    } catch (caught) {
      if (mine === sequence.current) {
        console.error(caught);
        setError(caught instanceof Error ? caught.message : String(caught));
      }
    } finally {
      if (mine === sequence.current) setLoading(false);
    }
  }, [enabled]);

  useEffect(() => {
    if (!enabled) {
      setLoading(false);
      return;
    }
    setLoading(true);
    void refresh();
    // `key` names what the read depends on; the read itself is read from the ref.
  }, [enabled, key, refresh]);

  return { data, loading, error, refresh };
}
