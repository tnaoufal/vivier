/**
 * Words of the similar profiles: the button on a profile, the drawer
 * that lists them seniority first, the two measures the database may
 * have used, and the years when a profile states none.
 */
const fr = {
  "similar.button": "Profils similaires",
  "similar.title": "Profils proches · séniorité d'abord",
  "similar.subtitle": "Proches de {name}",
  "similar.method.embedding": "Sens du parcours",
  "similar.method.skills": "Compétences",
  "similar.years.unknown": "Non renseigné",
  "similar.empty.title": "Aucun profil proche",
  "similar.loadError": "Les profils similaires n'ont pas pu être chargés.",
  "similar.open": "Ouvrir la fiche",
} as const;

const en = {
  "similar.button": "Similar profiles",
  "similar.title": "Close profiles · seniority first",
  "similar.subtitle": "Close to {name}",
  "similar.method.embedding": "Career meaning",
  "similar.method.skills": "Skills",
  "similar.years.unknown": "Not stated",
  "similar.empty.title": "No close profile",
  "similar.loadError": "The similar profiles could not be loaded.",
  "similar.open": "Open the profile",
} as const satisfies Record<keyof typeof fr, string>;

export const similar = { fr, en };
