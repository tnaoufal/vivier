/**
 * Words of the similar profiles: the block of a sheet and the menu's
 * entry, the drawer that lists them seniority first, the proximity line
 * and the two measures the database may have used, and the years when a
 * profile states none.
 */
const fr = {
  "similar.title": "Profils proches",
  "similar.subtitle": "Proches de {name}",
  "similar.method.embedding": "Sens du parcours",
  "similar.method.skills": "Compétences",
  "similar.proximity": "{percent} % · {method}",
  "similar.years.unknown": "Non renseigné",
  "similar.empty.title": "Aucun profil proche",
  "similar.loadError": "Les profils similaires n'ont pas pu être chargés.",
  "similar.open": "Ouvrir la fiche",
} as const;

const en = {
  "similar.title": "Close profiles",
  "similar.subtitle": "Close to {name}",
  "similar.method.embedding": "Career meaning",
  "similar.method.skills": "Skills",
  "similar.proximity": "{percent}% · {method}",
  "similar.years.unknown": "Not stated",
  "similar.empty.title": "No close profile",
  "similar.loadError": "The similar profiles could not be loaded.",
  "similar.open": "Open the profile",
} as const satisfies Record<keyof typeof fr, string>;

export const similar = { fr, en };
