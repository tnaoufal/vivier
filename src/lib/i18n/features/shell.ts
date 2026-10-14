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
  "shell.dashboard.subtitle": "Voici où en est votre vivier.",
  "shell.dashboard.candidates": "Candidats",
  "shell.dashboard.processing": "CV en traitement",
  "shell.stat.progress": "{done} sur {total} lus",
  "shell.dashboard.openBriefs": "Briefs ouverts",
  "shell.dashboard.retained": "Retenus ce mois",
  "shell.dashboard.recentActivity": "Activité récente",
  "shell.dashboard.noActivity": "Rien pour l'instant. Importez des CV ou créez un brief.",
  "shell.dashboard.uploadCta": "Importer des CV",
  "shell.dashboard.briefCta": "Nouveau brief",
  "shell.dashboard.start.title": "Pour commencer",
  "shell.dashboard.start.text": "Trois étapes, dans l'ordre, jusqu'à une première shortlist.",
  "shell.dashboard.step.upload.title": "Importez des CV",
  "shell.dashboard.step.upload.text":
    "Des PDF, par lots : chaque CV devient une fiche structurée, ce qui n'y est pas reste non renseigné.",
  "shell.dashboard.step.brief.title": "Créez un brief",
  "shell.dashboard.step.brief.text":
    "Décrivez le poste ; le modèle propose des critères, vous les retenez ou non.",
  "shell.dashboard.step.share.title": "Décidez et partagez",
  "shell.dashboard.step.share.text":
    "Retenez ensemble, puis envoyez au manager un dossier soigné, par email.",
  "shell.dashboard.step.share.cta": "Voir les shortlists",
  "shell.footer.madeFor": "Conçu pour les équipes RH. Aucune décision n'est prise par une machine.",
  "shell.footer.aiNotice":
    "Les CV sont structurés par un modèle de langage ; chaque décision reste humaine et tracée.",
  "shell.org.plan.trial": "Essai",
  "shell.org.plan.team": "Équipe",
  "shell.org.plan.business": "Entreprise",
  "shell.org.seats": "{used} / {limit} sièges",
  "shell.org.quota": "{used} / {limit} CV ce mois",

  // landing page
  "landing.hero": "Trouvez, en équipe, les bons profils dans votre vivier.",
  "landing.lead":
    "Importez vos CV, décrivez le poste, obtenez une liste classée et expliquée, décidez ensemble, puis envoyez un dossier soigné au manager.",
  "landing.cta": "Commencer",
  "landing.feature.read.title": "Des CV lus pour de bon",
  "landing.feature.read.text":
    "Chaque PDF devient une fiche structurée : poste, compétences, langues, expériences, avec un niveau de confiance par champ. Ce qui n'est pas écrit reste non renseigné.",
  "landing.feature.team.title": "Une shortlist à plusieurs",
  "landing.feature.team.text":
    "Commentaires, votes, statuts, attribution à un collègue : tout se passe en direct, et l'historique dit qui a décidé quoi.",
  "landing.feature.send.title": "Un dossier prêt à envoyer",
  "landing.feature.send.text":
    "Une page de présentation professionnelle, les CV retenus consultables, un lien qui expire. Envoyée par email en un clic.",
  "landing.footer.human":
    "Le modèle de langage structure et explique ; chaque décision reste humaine et tracée.",
  "landing.footer.gdpr":
    "RGPD par défaut : conservation réglée par organisation, purge automatique, export et effacement à la demande.",
} as const;

const en = {
  "shell.nav.label": "Application sections",
  "shell.nav.account": "Your account",
  "shell.dashboard.title": "Hello {name}",
  "shell.dashboard.subtitle": "Here is where your talent pool stands.",
  "shell.dashboard.candidates": "Candidates",
  "shell.dashboard.processing": "CVs processing",
  "shell.stat.progress": "{done} of {total} read",
  "shell.dashboard.openBriefs": "Open briefs",
  "shell.dashboard.retained": "Retained this month",
  "shell.dashboard.recentActivity": "Recent activity",
  "shell.dashboard.noActivity": "Nothing yet. Upload CVs or create a brief.",
  "shell.dashboard.uploadCta": "Upload CVs",
  "shell.dashboard.briefCta": "New brief",
  "shell.dashboard.start.title": "Getting started",
  "shell.dashboard.start.text": "Three steps, in order, to a first shortlist.",
  "shell.dashboard.step.upload.title": "Upload CVs",
  "shell.dashboard.step.upload.text":
    "PDFs, in batches: every CV becomes a structured profile; what is not written stays not stated.",
  "shell.dashboard.step.brief.title": "Create a brief",
  "shell.dashboard.step.brief.text":
    "Describe the role; the model proposes criteria, you keep them or not.",
  "shell.dashboard.step.share.title": "Decide and share",
  "shell.dashboard.step.share.text":
    "Retain together, then send the hiring manager a polished dossier by email.",
  "shell.dashboard.step.share.cta": "See the shortlists",
  "shell.footer.madeFor": "Built for HR teams. No decision is made by a machine.",
  "shell.footer.aiNotice":
    "CVs are structured by a language model; every decision stays human and traceable.",
  "shell.org.plan.trial": "Trial",
  "shell.org.plan.team": "Team",
  "shell.org.plan.business": "Business",
  "shell.org.seats": "{used} / {limit} seats",
  "shell.org.quota": "{used} / {limit} CVs this month",

  "landing.hero": "Find the right profiles in your talent pool, as a team.",
  "landing.lead":
    "Upload your CVs, describe the role, get a ranked and explained list, decide together, then send a polished dossier to the hiring manager.",
  "landing.cta": "Get started",
  "landing.feature.read.title": "CVs read for real",
  "landing.feature.read.text":
    "Every PDF becomes a structured profile: role, skills, languages, experience, with a confidence level per field. What is not written stays not stated.",
  "landing.feature.team.title": "A shortlist built together",
  "landing.feature.team.text":
    "Comments, votes, statuses, assignment to a colleague: everything happens live, and the history says who decided what.",
  "landing.feature.send.title": "A dossier ready to send",
  "landing.feature.send.text":
    "A professional presentation page, the retained CVs viewable inline, a link that expires. Sent by email in one click.",
  "landing.footer.human":
    "The language model structures and explains; every decision stays human and traceable.",
  "landing.footer.gdpr":
    "GDPR by default: retention set per organisation, automatic purge, export and erasure on request.",
} as const satisfies Record<keyof typeof fr, string>;

export const shell = { fr, en };
