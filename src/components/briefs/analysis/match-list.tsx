/**
 * A list of profiles of an analysis in one sheet of compact rows (the
 * matches, or the near profiles under their toggle), in the order
 * given. Rows rise in once, in the order they land: a batch that
 * returns unfolds row by row, a row already on screen never rises
 * again (its entrance played, it drops the animation, so the tiering
 * moving it cannot replay it), another analysis unfolds afresh. While an
 * analysis is not through, a match the second opinion has not seen is
 * marked as such. Before
 * the first rows are known, skeleton rows of the same height hold the
 * place.
 */
import { useRef } from "react";

import { SkeletonRows } from "@/components/ui/skeleton";
import { arrivalIndexes } from "@/lib/briefs/presentation";
import type { MatchResult } from "@/lib/db/types";
import { staggerVars } from "@/lib/motion";
import { cn } from "@/lib/utils";

import { MatchRow } from "./match-row";
import type { RowCandidate } from "./use-analysis";

export function MatchList({
  listKey,
  results,
  lineOf,
  candidateOf,
  addedIds,
  canAdd,
  muted = false,
  showScore = true,
  provisional = false,
  onOpen,
  onAdd,
  className,
}: {
  /** The analysis and the list the rows belong to: another key unfolds afresh. */
  listKey: string;
  results: readonly MatchResult[];
  lineOf: (result: MatchResult) => string | null;
  candidateOf: (candidateId: string) => RowCandidate;
  addedIds: ReadonlySet<string>;
  canAdd: boolean;
  muted?: boolean | undefined;
  showScore?: boolean | undefined;
  /** The analysis is not through (running, or stopped): a match without the second opinion is marked. */
  provisional?: boolean | undefined;
  onOpen: (index: number) => void;
  onAdd: (result: MatchResult) => Promise<void>;
  className?: string | undefined;
}) {
  // The turn each row took when it landed, and the rows whose entrance
  // already played: kept across renders so a row animates once. A
  // browser restarts the animation of a node moved in the list, so a row
  // that rose in loses the class before a batch can reorder it.
  const turns = useRef<{ key: string; map: Map<string, number>; settled: Set<string> }>({
    key: "",
    map: new Map(),
    settled: new Set(),
  });
  if (turns.current.key !== listKey)
    turns.current = { key: listKey, map: new Map(), settled: new Set() };
  const next = arrivalIndexes(
    turns.current.map,
    results.map((result) => result.candidateId),
  );
  turns.current.map = next;
  const settled = turns.current.settled;
  // A row that left the list is forgotten, as its turn is: back later, it rises in again.
  for (const id of settled) if (!next.has(id)) settled.delete(id);

  return (
    <ul className={cn("sheet divide-y divide-border overflow-hidden", className)}>
      {results.map((result, index) => (
        <li
          key={result.candidateId}
          className={cn(
            "flex min-w-0 items-center transition-colors duration-fast ease-out-soft hover:bg-muted/50",
            !settled.has(result.candidateId) && "rise-in",
          )}
          style={
            settled.has(result.candidateId)
              ? undefined
              : staggerVars(next.get(result.candidateId) ?? 0)
          }
          onAnimationEnd={(event) => {
            // The animations inside the row (the score ring, a pill) bubble up here: only the row's own entrance counts.
            if (event.target === event.currentTarget) settled.add(result.candidateId);
          }}
        >
          <MatchRow
            result={result}
            rank={index + 1}
            candidate={candidateOf(result.candidateId)}
            line={lineOf(result)}
            muted={muted}
            showScore={showScore}
            unconfirmed={
              provisional && result.assessment?.decision === "fit" && !result.assessment.challenge
            }
            added={addedIds.has(result.candidateId)}
            canAdd={canAdd}
            onOpen={() => onOpen(index)}
            onAdd={() => onAdd(result)}
          />
        </li>
      ))}
    </ul>
  );
}

/** The skeleton of a list of rows, in the same sheet and at the same height. */
export function MatchListSkeleton({ rows = 5 }: { rows?: number }) {
  return (
    <div className="sheet overflow-hidden">
      <SkeletonRows rows={rows} avatarSize="md" />
    </div>
  );
}
