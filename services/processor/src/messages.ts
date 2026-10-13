/**
 * The sentences a person reads on a document (`documents.error`): one per
 * failure class, in French, never a stack or a library message. The real
 * cause goes to the log line next to it.
 */

export const FAILURE_MESSAGES = {
  /** The PDF could not be parsed, or no readable text came out of it (after OCR too). */
  unreadable: "Le fichier n'a pas pu être lu.",
  /** The model call failed or never answered valid JSON. */
  model: "Le modèle n'a pas répondu.",
  /** Anything else: storage, database, OCR transport. */
  generic: "Le traitement a échoué.",
  /** The organisation's monthly quota is used up; the document is not retried this month. */
  quota: "Quota mensuel de CV atteint. Il se renouvelle le 1er du mois.",
  /** No text layer and no OCR configured. */
  scanned:
    "Ce PDF est scanné : aucun texte lisible n'a été trouvé. Activez l'OCR ou saisissez la fiche à la main.",
} as const;
