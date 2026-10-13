/**
 * Words of the similar profiles: the button on a profile, the drawer that
 * lists them, the two measures the database may have used. The sentences
 * say a proximity is a calculation a person weighs, never a verdict.
 */
const fr = {
  "similar.button": "Profils similaires",
  "similar.title": "Profils similaires",
  "similar.help":
    "Les profils les plus proches de {name} dans votre vivier, par le sens du parcours quand les deux fiches ont un vecteur, sinon par les mots du titre et des compétences. Un calcul, pas un avis : à vous de comparer.",
  "similar.method.embedding": "Sens du parcours",
  "similar.method.embedding.help": "Proximité des vecteurs des deux profils.",
  "similar.method.skills": "Compétences",
  "similar.method.skills.help":
    "Mots communs du titre et des compétences, l'une des deux fiches n'ayant pas de vecteur.",
  "similar.percent": "{percent} %",
  "similar.similarity.embedding": "{percent} % de proximité des vecteurs",
  "similar.similarity.skills": "{percent} % du meilleur score textuel du vivier",
  "similar.empty.title": "Aucun profil proche",
  "similar.empty.text": "Le vivier ne contient pas encore de profil actif comparable à celui-ci.",
  "similar.loadError": "Les profils similaires n'ont pas pu être chargés.",
  "similar.open": "Ouvrir la fiche",
} as const;

const en = {
  "similar.button": "Similar profiles",
  "similar.title": "Similar profiles",
  "similar.help":
    "The profiles closest to {name} in your talent pool, by the meaning of the career when both profiles carry a vector, else by the words of the headline and skills. A calculation, not an opinion: you compare.",
  "similar.method.embedding": "Career meaning",
  "similar.method.embedding.help": "Closeness of the two profiles' vectors.",
  "similar.method.skills": "Skills",
  "similar.method.skills.help":
    "Words shared by the headline and skills, one of the two profiles having no vector.",
  "similar.percent": "{percent}%",
  "similar.similarity.embedding": "{percent}% vector proximity",
  "similar.similarity.skills": "{percent}% of the pool's best text score",
  "similar.empty.title": "No close profile",
  "similar.empty.text": "The talent pool holds no active profile comparable to this one yet.",
  "similar.loadError": "The similar profiles could not be loaded.",
  "similar.open": "Open the profile",
} as const satisfies Record<keyof typeof fr, string>;

export const similar = { fr, en };
