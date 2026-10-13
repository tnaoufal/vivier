/** Words of the app shell: dashboard, empty states, footer. */
const fr = {
  "shell.dashboard.title": "Bonjour {name}",
  "shell.dashboard.subtitle": "Voici où en est votre vivier.",
  "shell.dashboard.candidates": "Candidats",
  "shell.dashboard.processing": "CV en traitement",
  "shell.dashboard.openBriefs": "Briefs ouverts",
  "shell.dashboard.retained": "Retenus ce mois",
  "shell.dashboard.recentActivity": "Activité récente",
  "shell.dashboard.noActivity": "Rien pour l'instant. Importez des CV ou créez un brief.",
  "shell.dashboard.uploadCta": "Importer des CV",
  "shell.dashboard.briefCta": "Nouveau brief",
  "shell.footer.madeFor": "Conçu pour les équipes RH. Aucune décision n'est prise par une machine.",
  "shell.footer.aiNotice": "Les CV sont structurés par un modèle de langage ; chaque décision reste humaine et tracée.",
  "shell.org.plan.trial": "Essai",
  "shell.org.plan.team": "Équipe",
  "shell.org.plan.business": "Entreprise",
  "shell.org.seats": "{used} / {limit} sièges",
  "shell.org.quota": "{used} / {limit} CV ce mois",
} as const;

const en = {
  "shell.dashboard.title": "Hello {name}",
  "shell.dashboard.subtitle": "Here is where your talent pool stands.",
  "shell.dashboard.candidates": "Candidates",
  "shell.dashboard.processing": "CVs processing",
  "shell.dashboard.openBriefs": "Open briefs",
  "shell.dashboard.retained": "Retained this month",
  "shell.dashboard.recentActivity": "Recent activity",
  "shell.dashboard.noActivity": "Nothing yet. Upload CVs or create a brief.",
  "shell.dashboard.uploadCta": "Upload CVs",
  "shell.dashboard.briefCta": "New brief",
  "shell.footer.madeFor": "Built for HR teams. No decision is made by a machine.",
  "shell.footer.aiNotice": "CVs are structured by a language model; every decision stays human and traceable.",
  "shell.org.plan.trial": "Trial",
  "shell.org.plan.team": "Team",
  "shell.org.plan.business": "Business",
  "shell.org.seats": "{used} / {limit} seats",
  "shell.org.quota": "{used} / {limit} CVs this month",
} as const satisfies Record<keyof typeof fr, string>;

export const shell = { fr, en };
