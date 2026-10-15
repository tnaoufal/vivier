/**
 * The thread of one object as a component sees it: the last messages
 * read under RLS, re-read on every change of the object's column, what
 * was just sent shown at once and confirmed by the next read, what was
 * just deleted gone at once and brought back only if the delete was
 * refused; and the count alone, for a button that opens the thread.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import { requireSupabase } from "@/lib/auth/supabase-client";
import { useQuery } from "@/lib/data/use-query";
import { useOrg } from "@/lib/org/org-context";

import {
  countThread,
  deleteMessage,
  listThread,
  postMessage,
  subscribeThread,
  type ThreadPage,
} from "./queries";
import {
  PENDING_PREFIX,
  mergeMessages,
  targetColumn,
  targetColumns,
  targetOf,
  type ThreadMessage,
  type ThreadTarget,
} from "./thread";

export interface ThreadState {
  /** The messages shown, oldest first: the read ones, then those just sent. */
  messages: ThreadMessage[];
  /** How many the object holds (the messages shown when the thread fits the limit). */
  count: number;
  loading: boolean;
  /** True when the last read failed. */
  error: boolean;
  refresh: () => Promise<void>;
  /** Shows the message at once and sends it; false when it was refused (the message is taken back). */
  post: (body: string, mentions: string[]) => Promise<boolean>;
  /** Hides the message at once and deletes it; false when the delete was refused (the message comes back). */
  remove: (messageId: string) => Promise<boolean>;
}

const EMPTY_PAGE: ThreadPage = { messages: [], total: 0 };

export function useThread(target: ThreadTarget, currentUserId: string | null): ThreadState {
  const { org, members } = useOrg();
  const orgId = org?.id ?? null;
  const { column, id } = targetColumn(target);
  // Pages write the target inline: the same column and id make the same object.
  const stable = useMemo(() => targetOf(column, id), [column, id]);
  const key = `thread:${orgId ?? "none"}:${column}:${id}`;
  const query = useQuery(
    key,
    async () => {
      if (!orgId) return EMPTY_PAGE;
      const supabase = await requireSupabase();
      return listThread(supabase, orgId, stable);
    },
    orgId !== null,
  );
  const [pending, setPending] = useState<ThreadMessage[]>([]);
  const [removed, setRemoved] = useState<ReadonlySet<string>>(() => new Set<string>());
  const sequence = useRef(0);

  // Another object: nothing sent or removed carries over.
  useEffect(() => {
    setPending([]);
    setRemoved(new Set<string>());
  }, [key]);

  const refresh = query.refresh;
  useEffect(() => subscribeThread(stable, () => void refresh()), [stable, refresh]);

  const loaded = query.data;
  // A read that holds a sent message confirms it; one that no longer holds a removed one closes the matter.
  useEffect(() => {
    if (!loaded) return;
    const known = new Set(loaded.messages.map((message) => message.id));
    setPending((prev) =>
      prev.some((message) => known.has(message.id))
        ? prev.filter((message) => !known.has(message.id))
        : prev,
    );
    setRemoved((prev) => {
      const kept = [...prev].filter((messageId) => known.has(messageId));
      return kept.length === prev.size ? prev : new Set(kept);
    });
  }, [loaded]);

  const post = useCallback(
    async (body: string, mentions: string[]) => {
      const text = body.trim();
      if (!orgId || !currentUserId || !text) return false;
      const localId = `${PENDING_PREFIX}${++sequence.current}`;
      const at = new Date().toISOString();
      const profile = members.get(currentUserId);
      const draft: ThreadMessage = {
        id: localId,
        org_id: orgId,
        ...targetColumns(stable),
        author_id: currentUserId,
        body: text,
        mentions,
        created_at: at,
        updated_at: at,
        author: profile
          ? { id: profile.id, display_name: profile.display_name, email: profile.email }
          : null,
      };
      setPending((prev) => [...prev, draft]);
      try {
        const supabase = await requireSupabase();
        const row = await postMessage(supabase, {
          orgId,
          target: stable,
          authorId: currentUserId,
          body: text,
          mentions,
        });
        setPending((prev) =>
          prev.map((message) =>
            message.id === localId ? { ...row, author: draft.author } : message,
          ),
        );
        void refresh();
        return true;
      } catch (error) {
        console.error(error);
        setPending((prev) => prev.filter((message) => message.id !== localId));
        return false;
      }
    },
    [currentUserId, members, orgId, refresh, stable],
  );

  const remove = useCallback(
    async (messageId: string) => {
      if (!orgId) return false;
      setRemoved((prev) => new Set([...prev, messageId]));
      try {
        const supabase = await requireSupabase();
        await deleteMessage(supabase, orgId, messageId);
        void refresh();
        return true;
      } catch (error) {
        console.error(error);
        setRemoved((prev) => {
          const next = new Set(prev);
          next.delete(messageId);
          return next;
        });
        return false;
      }
    },
    [orgId, refresh],
  );

  const messages = useMemo(
    () => mergeMessages(loaded?.messages ?? [], pending, removed),
    [loaded, pending, removed],
  );
  const count = Math.max(messages.length, (loaded?.total ?? 0) - removed.size);

  return {
    messages,
    count,
    loading: query.loading,
    error: query.error !== null,
    refresh,
    post,
    remove,
  };
}

/** How many messages the object holds, kept current; null until read (or without an object). */
export function useThreadCount(target: ThreadTarget | null): number | null {
  const { org } = useOrg();
  const orgId = org?.id ?? null;
  const column = target ? targetColumn(target).column : null;
  const id = target ? targetColumn(target).id : null;
  const stable = useMemo(() => (column && id ? targetOf(column, id) : null), [column, id]);
  const enabled = orgId !== null && stable !== null;
  const query = useQuery(
    `thread-count:${orgId ?? "none"}:${column ?? ""}:${id ?? ""}`,
    async () => {
      if (!orgId || !stable) return 0;
      const supabase = await requireSupabase();
      return countThread(supabase, orgId, stable);
    },
    enabled,
  );
  const refresh = query.refresh;
  useEffect(
    () => (stable ? subscribeThread(stable, () => void refresh()) : undefined),
    [stable, refresh],
  );
  return query.data;
}
