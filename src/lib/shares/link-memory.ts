/**
 * The link of a share exists in clear once, when it is created: the row
 * keeps only a hash of its token. So "copy the link" in the panel can
 * answer for the links this browser created and no other; they are
 * kept here, in sessionStorage (gone with the tab, never sent
 * anywhere), the newest fifty. Pure over a storage-like object, tested
 * on its own; `sessionLinkStore()` is the one browser accessor.
 */

export const LINK_MEMORY_KEY = "vivier-share-links";
export const LINK_MEMORY_MAX = 50;

export interface LinkStore {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
}

/** The pairs kept, oldest first; a missing or malformed value reads as none. */
export function readLinks(store: LinkStore | null): [shareId: string, url: string][] {
  if (!store) return [];
  let raw: string | null;
  try {
    raw = store.getItem(LINK_MEMORY_KEY);
  } catch {
    return [];
  }
  if (!raw) return [];
  try {
    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed.flatMap((entry): [string, string][] =>
      Array.isArray(entry) && typeof entry[0] === "string" && typeof entry[1] === "string"
        ? [[entry[0], entry[1]]]
        : [],
    );
  } catch {
    return [];
  }
}

/** Keeps the link of a share, replacing an earlier one for the same share, dropping the oldest past the limit. */
export function rememberLink(store: LinkStore | null, shareId: string, url: string): void {
  if (!store) return;
  const kept = readLinks(store).filter(([id]) => id !== shareId);
  kept.push([shareId, url]);
  try {
    store.setItem(LINK_MEMORY_KEY, JSON.stringify(kept.slice(-LINK_MEMORY_MAX)));
  } catch {
    // Storage may be full or blocked: the dialog showed the link already.
  }
}

export function recallLink(store: LinkStore | null, shareId: string): string | null {
  const found = readLinks(store).find(([id]) => id === shareId);
  return found ? found[1] : null;
}

/** This browser's session storage, or null when there is none (the server, a blocked storage). */
export function sessionLinkStore(): LinkStore | null {
  try {
    return typeof window === "undefined" ? null : window.sessionStorage;
  } catch {
    return null;
  }
}
