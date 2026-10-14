/**
 * The privacy policy and the terms, in both languages: a reading
 * column under the public frame, a table of contents that jumps to each
 * section, plain paragraphs. Written for the product as built:
 * candidate data, retention, the model, the roles. The owner completes
 * the legal identity before going live (docs/GO-LIVE.md).
 */
import { PublicFrame } from "@/components/public-frame";
import { BRAND } from "@/lib/brand";
import { useI18n } from "@/lib/i18n";

type Kind = "privacy" | "terms";

const CONTENT: Record<
  Kind,
  Record<"fr" | "en", { title: string; lead: string; sections: { h: string; p: string[] }[] }>
> = {
  privacy: {
    fr: {
      title: "Politique de confidentialité",
      lead: "Ce que Vivier traite, pour qui, combien de temps, et ce qu'un modèle de langage voit.",
      sections: [
        {
          h: "Qui traite quoi",
          p: [
            "Vivier est un outil mis à disposition des organisations (responsable de traitement) pour gérer leur vivier de candidats. L'éditeur de Vivier agit comme sous-traitant pour les données des candidats, et comme responsable de traitement pour les comptes des utilisateurs.",
            "Les données des utilisateurs : adresse email, nom affiché, langue, journal des actions dans l'organisation.",
          ],
        },
        {
          h: "Données des candidats",
          p: [
            "Les CV importés et les fiches qui en sont extraites (identité, coordonnées, parcours, compétences, langues, localisation, disponibilité). Aucune donnée sensible n'est extraite : ni âge, ni origine, ni santé, ni situation familiale, ni opinions.",
            "La photo lue sur la première page d'un CV identifie une personne dans l'interface, et seulement là : elle n'est jamais transmise au modèle, et chaque organisation peut choisir de ne pas l'afficher.",
            "Chaque organisation règle sa durée de conservation (deux ans au plus après le dernier contact, conformément aux recommandations de la CNIL). Passé ce délai, le candidat et ses fichiers sont supprimés automatiquement. Un candidat peut demander l'accès, la rectification ou l'effacement de ses données auprès de l'organisation, qui dispose des outils pour y répondre.",
          ],
        },
        {
          h: "Traitement par un modèle de langage",
          p: [
            "Le texte des CV est transmis à un fournisseur de modèle de langage (réglé par l'organisation, hébergé en Europe par défaut) pour en extraire une fiche structurée et expliquer la correspondance avec un brief. Le modèle ne prend aucune décision : il classe et explique, les personnes décident. Le fournisseur n'utilise pas ces données pour entraîner ses modèles.",
          ],
        },
        {
          h: "Hébergement et sous-traitants",
          p: [
            "Base de données et fichiers : Supabase (Union européenne). Application : Cloudflare. Traitement des CV : Railway. Emails : Resend. Facturation : Paddle. Chacun est lié par un accord de traitement des données.",
          ],
        },
        {
          h: "Sécurité",
          p: [
            "Les fichiers sont privés et servis par liens signés à courte durée. Les accès sont décidés par le rôle de chaque membre et toutes les actions sont journalisées. Les secrets ne sont jamais exposés au navigateur.",
          ],
        },
        {
          h: "Vos droits",
          p: [
            "Vous pouvez supprimer votre compte à tout moment depuis la page Mon compte. Pour toute question, écrivez à l'adresse de contact indiquée dans les conditions d'utilisation.",
          ],
        },
      ],
    },
    en: {
      title: "Privacy policy",
      lead: "What Vivier processes, for whom, for how long, and what a language model sees.",
      sections: [
        {
          h: "Who processes what",
          p: [
            "Vivier is a tool organisations (the data controllers) use to manage their candidate pools. Vivier's publisher acts as a processor for candidate data and as a controller for user accounts.",
            "User data: email address, display name, language, log of actions in the organisation.",
          ],
        },
        {
          h: "Candidate data",
          p: [
            "Uploaded CVs and the profiles extracted from them (identity, contact details, career, skills, languages, location, availability). No sensitive data is extracted: no age, origin, health, family status or opinions.",
            "The photo read from the first page of a CV identifies a person in the interface, and only there: it never reaches the model, and each organisation can choose not to show it.",
            "Each organisation sets its retention period (at most two years after the last contact, as the French CNIL recommends). Past it, the candidate and their files are deleted automatically. A candidate may ask the organisation for access, rectification or erasure, and the organisation has the tools to answer.",
          ],
        },
        {
          h: "Processing by a language model",
          p: [
            "CV text is sent to a language-model vendor (chosen by the organisation, hosted in Europe by default) to extract a structured profile and explain how it matches a brief. The model takes no decision: it ranks and explains, people decide. The vendor does not use this data to train its models.",
          ],
        },
        {
          h: "Hosting and processors",
          p: [
            "Database and files: Supabase (European Union). Application: Cloudflare. CV processing: Railway. Email: Resend. Billing: Paddle. Each is bound by a data processing agreement.",
          ],
        },
        {
          h: "Security",
          p: [
            "Files are private and served through short-lived signed links. Access is decided by each member's role and every action is logged. Secrets never reach the browser.",
          ],
        },
        {
          h: "Your rights",
          p: [
            "You can delete your account at any time from the My account page. For any question, write to the contact address given in the terms.",
          ],
        },
      ],
    },
  },
  terms: {
    fr: {
      title: "Conditions d'utilisation",
      lead: "Ce que le service permet, qui répond de quoi, et ce qu'il ne fait jamais.",
      sections: [
        {
          h: "Le service",
          p: [
            "Vivier permet à une organisation d'importer des CV, de les retrouver à partir d'un brief, de constituer une shortlist en équipe et de la partager par email. L'organisation reste seule responsable des décisions de recrutement et de l'information donnée aux candidats.",
          ],
        },
        {
          h: "Comptes et rôles",
          p: [
            "Chaque personne dispose d'un compte personnel. L'organisation attribue les rôles (propriétaire, administrateur, membre, lecteur) et répond des actions de ses membres.",
          ],
        },
        {
          h: "Usage loyal",
          p: [
            "Il est interdit d'importer des données sans base légale, d'utiliser le service pour discriminer, ou de tenter de contourner les règles d'accès. Les traitements automatisés du service n'écartent jamais un candidat : toute décision est prise par une personne et tracée.",
          ],
        },
        {
          h: "Offre et paiement",
          p: [
            "Le service est proposé en essai puis par abonnement (Équipe, Entreprise). La facturation est assurée par Paddle. Aucun remboursement n'est dû hors erreur ou bug de notre fait.",
          ],
        },
        {
          h: "Responsabilité",
          p: [
            "Le service est fourni en l'état, avec un effort raisonnable de disponibilité. L'organisation conserve ses propres sauvegardes de ses CV originaux.",
          ],
        },
        {
          h: "Contact",
          p: [
            "L'identité de l'éditeur et l'adresse de contact sont complétées avant la mise en service.",
          ],
        },
      ],
    },
    en: {
      title: "Terms of use",
      lead: "What the service allows, who answers for what, and what it never does.",
      sections: [
        {
          h: "The service",
          p: [
            "Vivier lets an organisation upload CVs, find them from a brief, build a shortlist as a team and share it by email. The organisation alone is responsible for hiring decisions and for informing candidates.",
          ],
        },
        {
          h: "Accounts and roles",
          p: [
            "Each person has a personal account. The organisation assigns roles (owner, administrator, member, viewer) and answers for its members' actions.",
          ],
        },
        {
          h: "Fair use",
          p: [
            "Uploading data without a legal basis, using the service to discriminate, or trying to bypass access rules is forbidden. The service's automated processing never dismisses a candidate: every decision is a person's and is logged.",
          ],
        },
        {
          h: "Offer and payment",
          p: [
            "The service is offered as a trial, then by subscription (Team, Business). Billing is handled by Paddle. No refund is due except for an error or a bug on our side.",
          ],
        },
        {
          h: "Liability",
          p: [
            "The service is provided as is, with reasonable efforts at availability. The organisation keeps its own backups of its original CVs.",
          ],
        },
        {
          h: "Contact",
          p: ["The publisher's identity and contact address are completed before going live."],
        },
      ],
    },
  },
};

export function LegalPage({ kind }: { kind: Kind }) {
  const { locale, t } = useI18n();
  const page = CONTENT[kind][locale];
  return (
    <PublicFrame width="md">
      <article className="rise-in">
        <p className="label-caps">{BRAND.name}</p>
        <h1 className="mt-2 font-display text-2xl text-ink sm:text-3xl">{page.title}</h1>
        <p className="mt-3 max-w-2xl text-body text-muted-foreground">{page.lead}</p>
        <nav className="sheet mt-8 p-6" aria-label={t("legal.contents")}>
          <p className="label-caps">{t("legal.contents")}</p>
          <ol className="mt-2 grid gap-x-6 gap-y-1 text-sm sm:grid-cols-2">
            {page.sections.map((section, index) => (
              <li key={section.h}>
                <a
                  href={`#section-${index + 1}`}
                  className="inline-flex gap-2 rounded-sm py-0.5 text-ink hover:text-primary hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                >
                  <span className="text-muted-foreground tabular-nums">{index + 1}.</span>
                  <span>{section.h}</span>
                </a>
              </li>
            ))}
          </ol>
        </nav>
        <div className="mt-6 divide-y divide-border">
          {page.sections.map((section, index) => (
            <section
              key={section.h}
              id={`section-${index + 1}`}
              className="scroll-mt-24 py-8 first:pt-6"
            >
              <h2 className="font-display text-xl text-ink">
                <span className="mr-2 text-muted-foreground tabular-nums">{index + 1}.</span>
                {section.h}
              </h2>
              {section.p.map((paragraph, paragraphIndex) => (
                <p key={paragraphIndex} className="mt-3 text-body text-ink/85">
                  {paragraph}
                </p>
              ))}
            </section>
          ))}
        </div>
      </article>
    </PublicFrame>
  );
}
