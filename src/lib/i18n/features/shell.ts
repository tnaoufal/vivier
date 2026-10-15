/**
 * Words of the app shell: the navigation and the person's menu, the
 * dashboard's greeting and its two buttons, the figure under a bar that
 * follows a reading, the organisation's plan and quotas, the landing
 * page.
 */
const fr = {
  "shell.nav.label": "Sections de l'application",
  "shell.nav.account": "Votre compte",
  "shell.dashboard.title": "Bonjour {name}",
  "shell.stat.progress": "{done} sur {total} lus",
  "shell.dashboard.uploadCta": "Importer des CV",
  "shell.dashboard.briefCta": "Nouveau brief",
  "shell.org.plan.trial": "Essai",
  "shell.org.plan.team": "Équipe",
  "shell.org.plan.business": "Entreprise",
  "shell.org.usage": "{used} / {limit}",

  // landing page
  "landing.hero": "Trouvez, en équipe, les bons profils dans votre vivier.",
  "landing.feature.read.title": "Des CV lus pour de bon",
  "landing.feature.read.text":
    "Chaque PDF devient une fiche structurée ; ce qui n'est pas écrit reste non renseigné.",
  "landing.feature.team.title": "Une shortlist à plusieurs",
  "landing.feature.team.text": "Une discussion et des décisions en direct, avec qui a décidé quoi.",
  "landing.feature.send.title": "Un dossier prêt à envoyer",
  "landing.feature.send.text": "Un dossier par email, un lien qui expire.",
  "landing.footer.gdpr": "RGPD : purge automatique, export et effacement à la demande.",
} as const;

const en = {
  "shell.nav.label": "Application sections",
  "shell.nav.account": "Your account",
  "shell.dashboard.title": "Hello {name}",
  "shell.stat.progress": "{done} of {total} read",
  "shell.dashboard.uploadCta": "Upload CVs",
  "shell.dashboard.briefCta": "New brief",
  "shell.org.plan.trial": "Trial",
  "shell.org.plan.team": "Team",
  "shell.org.plan.business": "Business",
  "shell.org.usage": "{used} / {limit}",

  "landing.hero": "Find the right profiles in your talent pool, as a team.",
  "landing.feature.read.title": "CVs read for real",
  "landing.feature.read.text":
    "Every PDF becomes a structured profile; what is not written stays not stated.",
  "landing.feature.team.title": "A shortlist built together",
  "landing.feature.team.text": "A live discussion and decisions, with who decided what.",
  "landing.feature.send.title": "A dossier ready to send",
  "landing.feature.send.text": "A dossier by email, a link that expires.",
  "landing.footer.gdpr": "GDPR: automatic purge, export and erasure on request.",
} as const satisfies Record<keyof typeof fr, string>;

export const shell = { fr, en };
