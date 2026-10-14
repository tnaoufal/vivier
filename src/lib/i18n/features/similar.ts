/**
 * Words of the similar profiles: the button on a profile, the drawer that
 * lists them, the two measures the database may have used. The one
 * sentence (behind an info icon) says a proximity is a calculation a
 * person weighs, never a verdict.
 */
const fr = {
  "similar.button": "Profils similaires",
  "similar.title": "Profils similaires",
  "similar.subtitle": "Proches de {name}",
  "similar.help":
    "Calcul sur le parcours, ou à défaut sur le titre et les compétences : pas un avis.",
  "similar.method.embedding": "Sens du parcours",
  "similar.method.skills": "Compétences",
  "similar.empty.title": "Aucun profil proche",
  "similar.loadError": "Les profils similaires n'ont pas pu être chargés.",
  "similar.open": "Ouvrir la fiche",
} as const;

const en = {
  "similar.button": "Similar profiles",
  "similar.title": "Similar profiles",
  "similar.subtitle": "Close to {name}",
  "similar.help": "Computed from the career, else from the headline and skills: not an opinion.",
  "similar.method.embedding": "Career meaning",
  "similar.method.skills": "Skills",
  "similar.empty.title": "No close profile",
  "similar.loadError": "The similar profiles could not be loaded.",
  "similar.open": "Open the profile",
} as const satisfies Record<keyof typeof fr, string>;

export const similar = { fr, en };
