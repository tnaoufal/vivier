/** Product identity. The name is provisional (chosen on 2026-10-13). */
export const BRAND = {
  name: "Vivier",
  tagline: {
    fr: "Le vivier de talents que toute l'équipe fait vivre.",
    en: "The talent pool your whole team keeps alive.",
  },
  description: {
    fr: "Importez vos CV, trouvez les profils qui répondent à un brief, décidez en équipe et partagez une shortlist soignée par email.",
    en: "Upload CVs, find the profiles that answer a brief, decide as a team and share a polished shortlist by email.",
  },
  /** Transactional sender; the address must be verified in Resend. */
  emailFrom: "Vivier <hello@vivier.app>",
} as const;
