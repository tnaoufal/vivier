/**
 * A list of profiles of an analysis in one sheet of compact rows (the
 * matches, or the near profiles under their own small heading), in the
 * order given. Rows rise in once, in the order they land: a batch that
 * returns unfolds row by row, a row already on screen never moves
 * again, another analysis unfolds afresh. Before the first rows are
 * known, skeleton rows of the same height hold the place.
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
  onOpen: (index: number) => void;
  onAdd: (result: MatchResult) => Promise<void>;
  className?: string | undefined;
}) {
  // The turn each row took when it landed: kept across renders so a row animates once.
  const turns = useRef<{ key: string; map: Map<string, number> }>({ key: "", map: new Map() });
  if (turns.current.key !== listKey) turns.current = { key: listKey, map: new Map() };
  const next = arrivalIndexes(
    turns.current.map,
    results.map((result) => result.candidateId),
  );
  turns.current.map = next;

  return (
    <ul className={cn("sheet divide-y divide-border overflow-hidden", className)}>
      {results.map((result, index) => (
        <li
          key={result.candidateId}
          className="rise-in flex min-w-0 items-center transition-colors duration-fast ease-out-soft hover:bg-muted/50"
          style={staggerVars(next.get(result.candidateId) ?? 0)}
        >
          <MatchRow
            result={result}
            rank={index + 1}
            candidate={candidateOf(result.candidateId)}
            line={lineOf(result)}
            muted={muted}
            showScore={showScore}
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
