/**
 * Words of the team thread: the column's title and count, the composer,
 * the day labels, the delete question, and the "to handle" list of the
 * messages that mention the person.
 */
const fr = {
  "thread.title": "Discussion",
  "thread.empty": "Aucun message",
  "thread.placeholder": "Écrire à l'équipe… @ pour mentionner",
  "thread.send": "Envoyer",
  "thread.today": "Aujourd'hui",
  "thread.yesterday": "Hier",
  "thread.count.one": "1 message",
  "thread.count.many": "{count} messages",
  "thread.suggestions": "Membres à mentionner",
  "thread.suggestions.highlighted": "{name}, {index} sur {count}",
  "thread.formerMember": "Un ancien membre",
  "thread.deleteTitle": "Supprimer ce message ?",
  "thread.deleteText": "Le message disparaît pour toute l'équipe.",
  "thread.mentions.title": "À traiter",
  "thread.mentions.empty": "Aucune mention",
} as const;

const en = {
  "thread.title": "Discussion",
  "thread.empty": "No message yet",
  "thread.placeholder": "Write to the team… @ to mention",
  "thread.send": "Send",
  "thread.today": "Today",
  "thread.yesterday": "Yesterday",
  "thread.count.one": "1 message",
  "thread.count.many": "{count} messages",
  "thread.suggestions": "Members to mention",
  "thread.suggestions.highlighted": "{name}, {index} of {count}",
  "thread.formerMember": "A former member",
  "thread.deleteTitle": "Delete this message?",
  "thread.deleteText": "The message disappears for the whole team.",
  "thread.mentions.title": "To handle",
  "thread.mentions.empty": "No mention",
} as const satisfies Record<keyof typeof fr, string>;

export const threads = { fr, en };
