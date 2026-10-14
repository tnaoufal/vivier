/**
 * Words of the app shell: the navigation and its menus, the shared
 * pieces (a timeline's "present", a photo's name), the dashboard and
 * its "to begin" card, the organisation's plan and quotas, the landing
 * page.
 */
const fr = {
  "shell.nav.label": "Sections de l'application",
  "shell.nav.account": "Votre compte",
  "shell.dashboard.title": "Bonjour {name}",
  "shell.dashboard.candidates": "Candidats",
  "shell.dashboard.processing": "CV en traitement",
  "shell.stat.progress": "{done} sur {total} lus",
  "shell.dashboard.openBriefs": "Briefs ouverts",
  "shell.dashboard.retained": "Retenus ce mois",
  "shell.dashboard.recentActivity": "Activité récente",
  "shell.dashboard.uploadCta": "Importer des CV",
  "shell.dashboard.briefCta": "Nouveau brief",
  "shell.dashboard.start.title": "Pour commencer",
  "shell.dashboard.step.share.cta": "Voir les shortlists",
  "shell.org.plan.trial": "Essai",
  "shell.org.plan.team": "Équipe",
  "shell.org.plan.business": "Entreprise",
  "shell.org.seats": "{used} / {limit} sièges",
  "shell.org.quota": "{used} / {limit} CV ce mois",

  // landing page
  "landing.hero": "Trouvez, en équipe, les bons profils dans votre vivier.",
  "landing.lead": "Importez vos CV, décrivez le poste, décidez ensemble.",
  "landing.cta": "Commencer",
  "landing.feature.read.title": "Des CV lus pour de bon",
  "landing.feature.read.text":
    "Chaque PDF devient une fiche structurée ; ce qui n'est pas écrit reste non renseigné.",
  "landing.feature.team.title": "Une shortlist à plusieurs",
  "landing.feature.team.text":
    "Commentaires, votes et décisions en direct, avec qui a décidé quoi.",
  "landing.feature.send.title": "Un dossier prêt à envoyer",
  "landing.feature.send.text": "Un dossier par email, un lien qui expire.",
  "landing.footer.gdpr": "RGPD : purge automatique, export et effacement à la demande.",
} as const;

const en = {
  "shell.nav.label": "Application sections",
  "shell.nav.account": "Your account",
  "shell.dashboard.title": "Hello {name}",
  "shell.dashboard.candidates": "Candidates",
  "shell.dashboard.processing": "CVs processing",
  "shell.stat.progress": "{done} of {total} read",
  "shell.dashboard.openBriefs": "Open briefs",
  "shell.dashboard.retained": "Retained this month",
  "shell.dashboard.recentActivity": "Recent activity",
  "shell.dashboard.uploadCta": "Upload CVs",
  "shell.dashboard.briefCta": "New brief",
  "shell.dashboard.start.title": "Getting started",
  "shell.dashboard.step.share.cta": "See the shortlists",
  "shell.org.plan.trial": "Trial",
  "shell.org.plan.team": "Team",
  "shell.org.plan.business": "Business",
  "shell.org.seats": "{used} / {limit} seats",
  "shell.org.quota": "{used} / {limit} CVs this month",

  "landing.hero": "Find the right profiles in your talent pool, as a team.",
  "landing.lead": "Upload your CVs, describe the role, decide together.",
  "landing.cta": "Get started",
  "landing.feature.read.title": "CVs read for real",
  "landing.feature.read.text":
    "Every PDF becomes a structured profile; what is not written stays not stated.",
  "landing.feature.team.title": "A shortlist built together",
  "landing.feature.team.text": "Comments, votes and decisions live, with who decided what.",
  "landing.feature.send.title": "A dossier ready to send",
  "landing.feature.send.text": "A dossier by email, a link that expires.",
  "landing.footer.gdpr": "GDPR: automatic purge, export and erasure on request.",
} as const satisfies Record<keyof typeof fr, string>;

export const shell = { fr, en };
