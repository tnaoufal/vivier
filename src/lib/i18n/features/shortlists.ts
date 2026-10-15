/**
 * Words of the shortlist group of a brief page (its filter, its rows
 * with the decision as a pill and who decided, the decisions in one
 * click with their toasts of two words, the trace the reading shows)
 * and of the links that still name a shortlist. Decision traces name
 * the person and the moment: {name} and {when} are filled from
 * decided_by / decided_at, never guessed; a reading is always said to
 * be the model's.
 */
const fr = {
  // the group and its filter
  "shortlists.share": "Partager la shortlist",
  "shortlists.boardError": "La shortlist n'a pas pu être chargée.",
  "shortlists.board.empty.title": "Personne sur cette shortlist",
  "shortlists.filter.label": "Filtrer la shortlist",
  "shortlists.status.to_review": "À examiner",
  "shortlists.status.retained": "Retenus",
  "shortlists.status.dismissed": "Écartés",
  "shortlists.section.empty.to_review": "Rien à examiner",
  "shortlists.section.empty.retained": "Aucun retenu",
  "shortlists.section.empty.dismissed": "Aucun écarté",

  // a link that still names a shortlist
  "shortlists.title": "Shortlist",
  "shortlists.notFound.title": "Cette shortlist n'existe pas",
  "shortlists.notFound.action": "Voir les briefs",

  // the rows
  "shortlists.item.score": "{score} / 100",
  "shortlists.item.fitScore": "Adéquation {score} sur 100, selon le modèle",
  "shortlists.item.noMatch": "Ajouté sans analyse",
  "shortlists.item.addedBy": "Ajouté par {name} · {when}",
  "shortlists.pill.retained": "Retenu",
  "shortlists.pill.dismissed": "Écarté",
  "shortlists.pill.to_review": "À examiner",
  "shortlists.line.retained": "{name} retient",
  "shortlists.line.dismissed": "{name} écarte",
  "shortlists.line.to_review": "à examiner",
  "shortlists.action.retain": "Retenir",
  "shortlists.action.dismiss": "Écarter",
  "shortlists.action.review": "Réexaminer",
  "shortlists.formerMember": "Un ancien membre",
  "shortlists.trace.retained": "Retenu par {name} · {when}",
  "shortlists.trace.dismissed": "Écarté par {name} · {when}",
  "shortlists.trace.reviewed": "Remis à l'étude par {name} · {when}",
  "shortlists.toast.retained": "Retenu.",
  "shortlists.toast.dismissed": "Écarté.",
  "shortlists.toast.to_review": "À examiner.",

  // the reading
  "shortlists.reading.challenge": "Seconde lecture",
} as const;

const en = {
  "shortlists.share": "Share the shortlist",
  "shortlists.boardError": "The shortlist could not be loaded.",
  "shortlists.board.empty.title": "Nobody on this shortlist",
  "shortlists.filter.label": "Filter the shortlist",
  "shortlists.status.to_review": "To review",
  "shortlists.status.retained": "Retained",
  "shortlists.status.dismissed": "Dismissed",
  "shortlists.section.empty.to_review": "Nothing to review",
  "shortlists.section.empty.retained": "None retained",
  "shortlists.section.empty.dismissed": "None dismissed",

  "shortlists.title": "Shortlist",
  "shortlists.notFound.title": "This shortlist does not exist",
  "shortlists.notFound.action": "See the briefs",

  "shortlists.item.score": "{score} / 100",
  "shortlists.item.fitScore": "Fit {score} out of 100, as the model reads it",
  "shortlists.item.noMatch": "Added without an analysis",
  "shortlists.item.addedBy": "Added by {name} · {when}",
  "shortlists.pill.retained": "Retained",
  "shortlists.pill.dismissed": "Dismissed",
  "shortlists.pill.to_review": "To review",
  "shortlists.line.retained": "{name} retains",
  "shortlists.line.dismissed": "{name} dismisses",
  "shortlists.line.to_review": "to review",
  "shortlists.action.retain": "Retain",
  "shortlists.action.dismiss": "Dismiss",
  "shortlists.action.review": "Review again",
  "shortlists.formerMember": "A former member",
  "shortlists.trace.retained": "Retained by {name} · {when}",
  "shortlists.trace.dismissed": "Dismissed by {name} · {when}",
  "shortlists.trace.reviewed": "Put back under review by {name} · {when}",
  "shortlists.toast.retained": "Retained.",
  "shortlists.toast.dismissed": "Dismissed.",
  "shortlists.toast.to_review": "To review.",

  "shortlists.reading.challenge": "Second reading",
} as const satisfies Record<keyof typeof fr, string>;

export const shortlists = { fr, en };
