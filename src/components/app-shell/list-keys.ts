/**
 * The arrow keys of a list pane, pure: where the selection goes from
 * `index` among `count` rows for a key (ArrowDown, ArrowUp, Home, End),
 * null for any other key. Nothing selected (-1) and an arrow select the
 * first row; the ends hold. `useListKeys` in row.tsx wires it to an
 * `ol`.
 */
export function moveIndex(key: string, index: number, count: number): number | null {
  if (!Number.isFinite(count) || count <= 0) return null;
  const last = Math.floor(count) - 1;
  const current = Number.isFinite(index) ? Math.min(Math.max(Math.floor(index), -1), last) : -1;
  switch (key) {
    case "ArrowDown":
      return Math.min(last, current + 1);
    case "ArrowUp":
      return current < 0 ? 0 : Math.max(0, current - 1);
    case "Home":
      return 0;
    case "End":
      return last;
    default:
      return null;
  }
}
