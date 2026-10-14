/**
 * One icon per family of activities, the same in the filter chips and
 * in the feed's rows without an actor (a document the service read, a
 * purge): shortlists, comments, briefs, documents, candidates, shares,
 * the team. Every icon follows the charter's table.
 */
import type { ReactNode } from "react";
import { Briefcase, FileText, ListChecks, MessageSquare, Settings, Share2, UserPlus, Users } from "lucide-react";

import { activityFamily, type ActivityFamily } from "@/lib/activity/describe";

export const FAMILY_ICONS: Record<ActivityFamily, ReactNode> = {
  shortlist: <ListChecks />,
  comment: <MessageSquare />,
  brief: <Briefcase />,
  document: <FileText />,
  candidate: <Users />,
  share: <Share2 />,
  member: <UserPlus />,
};

/** The icon of a kind's family; a gear for anything unknown (the system). */
export function familyIcon(kind: string): ReactNode {
  const family = activityFamily(kind);
  return family ? FAMILY_ICONS[family] : <Settings />;
}
