/** Words of the similar profiles: the button on a profile, the drawer that lists them. */
const fr = {
  "similar.button": "Profils similaires",
  "similar.title": "Profils similaires",
  "similar.help": "Les profils les plus proches de {name} dans votre vivier, par le sens du parcours quand un vecteur existe, sinon par les compétences partagées.",
  "similar.method.embedding": "Par le sens du parcours",
  "similar.method.skills": "Par les compétences",
  "similar.similarity": "{percent} % de proximité",
  "similar.empty.title": "Aucun profil proche",
  "similar.empty.text": "Le vivier ne contient pas encore de profil comparable à celui-ci.",
  "similar.loadError": "Les profils similaires n'ont pas pu être chargés.",
  "similar.open": "Ouvrir la fiche",
} as const;

const en = {
  "similar.button": "Similar profiles",
  "similar.title": "Similar profiles",
  "similar.help": "The profiles closest to {name} in your talent pool, by the meaning of the career when a vector exists, else by shared skills.",
  "similar.method.embedding": "By the meaning of the career",
  "similar.method.skills": "By skills",
  "similar.similarity": "{percent}% similar",
  "similar.empty.title": "No close profile",
  "similar.empty.text": "The talent pool holds no profile comparable to this one yet.",
  "similar.loadError": "The similar profiles could not be loaded.",
  "similar.open": "Open the profile",
} as const satisfies Record<keyof typeof fr, string>;

export const similar = { fr, en };
