/**
 * /share/:token: the dossier a link opens, outside the app shell and
 * without a sign-in. A cover (the organisation, the title, the date,
 * the counts, when the link stops working, the brief's text), then one
 * sheet per candidate: the initials, the name, the position, the years,
 * the reading (marked once as the model's when an assessment wrote it),
 * the requirements with their marks, the strengths, the points of
 * attention, the points to verify in an interview, the CV when the
 * share carries it. No photo, no colour, no ring: the figures are
 * text. A white sheet with dark ink on any theme (`share-sheet` in
 * styles.css), printable on A4 with the cover and each sheet on their
 * own page, the controls hidden in print: the PDF a reader keeps is the
 * browser's print of this page. The sentences speak the sharing
 * organisation's language. A link that no longer opens says why in one
 * sentence.
 */
import type { ReactNode } from "react";
import { createFileRoute } from "@tanstack/react-router";
import { FileText, Printer, Sparkles } from "lucide-react";

import { Avatar } from "@/components/app-shell/avatar";
import { Pill } from "@/components/app-shell/pill";
import { RequirementList } from "@/components/app-shell/requirement-list";
import { BrandIcon } from "@/components/brand-mark";
import {
  DecisionPill,
  factsLine,
  metLabel,
  metSentence,
  requirementRowsOf,
  ScoreText,
  type Translate,
} from "@/components/share/assessment-bits";
import { Button } from "@/components/ui/button";
import { BRAND } from "@/lib/brand";
import type { Locale, ShareItem } from "@/lib/db/types";
import { formatDate, translate, useI18n, type TranslationKey } from "@/lib/i18n";
import { shareCvPath } from "@/lib/shares/links";
import { getShare, type PublicShare } from "@/lib/shares/public.functions";

export const Route = createFileRoute("/share/$token")({
  loader: ({ params }) => getShare({ data: { token: params.token } }),
  head: ({ loaderData }) => ({
    meta: [
      { name: "robots", content: "noindex, nofollow" },
      {
        title:
          loaderData && loaderData.state === "ok"
            ? `${loaderData.title} — ${BRAND.name}`
            : BRAND.name,
      },
    ],
  }),
  component: SharePage,
});

type OpenShare = Extract<PublicShare, { state: "ok" }>;

/**
 * A4 with a 16mm margin, and everything at rest: a print (or a headless
 * PDF) must never catch a row rising in half way, so every animation
 * and transition of the sheet is off on paper. Everything else is
 * Tailwind's `print:` variants, so nothing here depends on styles.css.
 */
const PRINT_CSS =
  "@page { size: A4; margin: 16mm } @media print { .share-sheet, .share-sheet *, .share-sheet *::before, .share-sheet *::after { transition: none !important; animation: none !important } }";

function SharePage() {
  const share = Route.useLoaderData();
  const { token } = Route.useParams();
  const { locale } = useI18n();
  if (share.state !== "ok") return <Closed state={share.state} locale={locale} />;
  return <Dossier share={share} token={token} />;
}

/** A link that opens nothing: one centred sentence, the page's heading, in the reader's language (no organisation to speak for). */
function Closed({ state, locale }: { state: "missing" | "revoked" | "expired"; locale: Locale }) {
  const key: TranslationKey =
    state === "revoked"
      ? "shares.page.revoked"
      : state === "expired"
        ? "shares.page.expired"
        : "shares.page.missing";
  return (
    <div className="share-sheet flex min-h-screen items-center justify-center bg-background px-4 text-foreground">
      <div className="fade-in max-w-md text-center">
        <p className="mb-6 flex items-center justify-center gap-2 text-ink">
          <BrandIcon className="text-ink" />
          <span className="font-display text-lg">{BRAND.name}</span>
        </p>
        <h1 className="font-display text-xl text-ink">{translate(locale, key)}</h1>
      </div>
    </div>
  );
}

/** A text as paragraphs: blank-line separated. */
function paragraphsOf(text: string): string[] {
  return text
    .split(/\n\s*\n/)
    .map((part) => part.trim())
    .filter((part) => part.length > 0);
}

function Paragraphs({ text, className }: { text: string; className: string }) {
  return (
    <div className={className}>
      {paragraphsOf(text).map((paragraph, index) => (
        <p key={index}>{paragraph}</p>
      ))}
    </div>
  );
}

/** A section title inside a sheet: the label scale, with a hairline under it; `aside` sits beside it (the model's mark). */
function Caption({ children, aside }: { children: string; aside?: ReactNode | undefined }) {
  return (
    <div className="mb-3 flex flex-wrap items-center gap-2 border-b border-border pb-2">
      <h3 className="label-caps text-ink">{children}</h3>
      {aside}
    </div>
  );
}

// ---------------------------------------------------------------------
// the cover
// ---------------------------------------------------------------------

function Fact({ label, value }: { label: string; value: string }) {
  return (
    <div className="min-w-0">
      <dt className="label-caps">{label}</dt>
      <dd className="mt-0.5 text-body font-medium text-ink tabular-nums break-words">{value}</dd>
    </div>
  );
}

function Cover({ share, t }: { share: OpenShare; t: Translate }) {
  const count = share.items.length;
  const requirements = share.brief?.requirements.length ?? 0;
  const briefText = share.brief?.summary.trim() ?? "";
  return (
    <header className="space-y-8 print:break-after-page">
      <div className="flex flex-wrap items-center justify-between gap-4 border-b border-border pb-4">
        <p className="flex min-w-0 items-center gap-2 text-ink">
          <BrandIcon className="size-5 shrink-0 text-ink" />
          <span className="font-display text-base">{BRAND.name}</span>
          {share.orgName ? (
            <span className="min-w-0 truncate text-sm text-muted-foreground">
              · {t("shares.page.from", { org: share.orgName })}
            </span>
          ) : null}
        </p>
        <div className="flex items-center gap-3 print:hidden">
          <Button type="button" variant="outline" icon={<Printer />} onClick={() => window.print()}>
            {t("shares.page.print")}
          </Button>
        </div>
      </div>
      <div className="rise-in">
        <p className="label-caps">{t("shares.page.eyebrow")}</p>
        <h1 className="mt-2 max-w-3xl font-display text-3xl text-ink break-words sm:text-4xl">
          {share.title}
        </h1>
        <dl className="mt-6 grid grid-cols-2 gap-x-8 gap-y-4 sm:grid-cols-4">
          <Fact
            label={t("shares.page.prepared")}
            value={formatDate(share.locale, share.createdAt)}
          />
          <Fact label={t("shares.page.profiles")} value={String(count)} />
          <Fact label={t("shares.page.requirementsCount")} value={String(requirements)} />
          <Fact
            label={t("shares.page.validUntil")}
            value={formatDate(share.locale, share.expiresAt)}
          />
        </dl>
      </div>
      {/* A share made before the one-step dialog may carry a note for the reader: it stays. */}
      {share.intro.trim() ? (
        <Paragraphs text={share.intro} className="max-w-3xl space-y-3 text-body text-foreground" />
      ) : null}
      {briefText ? (
        <section className="max-w-3xl" aria-labelledby="dossier-brief">
          <h2 id="dossier-brief" className="font-display text-xl text-ink">
            {t("shares.page.brief")}
          </h2>
          <Paragraphs text={briefText} className="mt-3 space-y-3 text-body text-foreground" />
        </section>
      ) : null}
    </header>
  );
}

// ---------------------------------------------------------------------
// one sheet per candidate
// ---------------------------------------------------------------------

/** A titled list of points; the `empty` sentence when there is none, or nothing at all when the caller gives no sentence. */
function Points({
  title,
  points,
  empty,
}: {
  title: string;
  points: string[];
  empty?: string | undefined;
}) {
  if (!points.length && !empty) return null;
  return (
    <section>
      <Caption>{title}</Caption>
      {points.length ? (
        <ul className="list-disc space-y-1.5 pl-5 text-body text-foreground">
          {points.map((point, index) => (
            <li key={`${index}-${point}`}>{point}</li>
          ))}
        </ul>
      ) : (
        <p className="text-sm text-muted-foreground">{empty}</p>
      )}
    </section>
  );
}

function Sheet({
  item,
  index,
  count,
  token,
  t,
}: {
  item: ShareItem;
  index: number;
  count: number;
  token: string;
  t: Translate;
}) {
  const rows = requirementRowsOf(item);
  // The synthesis, the strengths, the attention points and the questions are the assessment's: said once per sheet.
  const byModel = item.decision !== null || item.score !== null;
  return (
    <article className="sheet space-y-8 p-6 print:border-0 print:p-0 print:shadow-none">
      <header className="flex flex-wrap items-start justify-between gap-6">
        <div className="flex min-w-0 flex-1 items-start gap-4">
          {/* The initials alone: the dossier reproduces no photo. */}
          <Avatar name={item.name} size="lg" variant="profile" className="mt-1" decorative />
          <div className="min-w-0 flex-1">
            <p className="label-caps">{t("shares.page.sheet", { index: index + 1, count })}</p>
            <h2 className="mt-1 font-display text-2xl text-ink break-words">{item.name}</h2>
            {item.headline ? (
              <p className="mt-1 text-body text-muted-foreground">{item.headline}</p>
            ) : null}
            <p className="mt-1 text-sm text-muted-foreground">{factsLine(t, item)}</p>
          </div>
        </div>
        <div className="flex flex-wrap items-center gap-4">
          <ScoreText score={item.score} t={t} />
          <DecisionPill decision={item.decision} t={t} />
        </div>
      </header>

      <section>
        <Caption
          aside={
            byModel ? (
              <Pill size="sm" tone="caution" icon={<Sparkles />}>
                {t("shares.page.byModel")}
              </Pill>
            ) : undefined
          }
        >
          {t("shares.page.synthesis")}
        </Caption>
        {item.summary ? (
          <Paragraphs text={item.summary} className="space-y-3 text-body text-foreground" />
        ) : (
          <p className="text-sm text-muted-foreground">{t("shares.page.noSummary")}</p>
        )}
      </section>

      <section>
        <Caption>{t("shares.page.requirements")}</Caption>
        {rows.length ? (
          <>
            <p className="mb-1 text-meta text-muted-foreground tabular-nums">
              {metSentence(t, item)}
            </p>
            <RequirementList
              rows={rows}
              markLabel={(met) => metLabel(t, met)}
              requiredLabel={t("shares.required")}
              compact
            />
          </>
        ) : (
          <p className="text-sm text-muted-foreground">{t("shares.page.requirements.empty")}</p>
        )}
      </section>

      <div className="grid gap-8 sm:grid-cols-2">
        <Points
          title={t("shares.page.strengths")}
          points={item.strengths}
          empty={t("shares.page.strengths.none")}
        />
        <Points
          title={t("shares.page.attention")}
          points={item.attention}
          empty={t("shares.page.attention.none")}
        />
      </div>

      {/* Only when the analysis named some: a sheet without questions says nothing rather than "none". */}
      <Points title={t("shares.page.questions")} points={item.questions} />

      {item.documentId ? (
        <div>
          <Button asChild variant="outline" icon={<FileText />} className="print:hidden">
            <a href={shareCvPath(token, item.documentId)} target="_blank" rel="noopener noreferrer">
              {t("shares.page.cv")}
            </a>
          </Button>
          <p className="hidden text-sm text-muted-foreground print:block">
            {t("shares.page.cv.print")}
          </p>
        </div>
      ) : null}
    </article>
  );
}

// ---------------------------------------------------------------------
// the dossier
// ---------------------------------------------------------------------

function Dossier({ share, token }: { share: OpenShare; token: string }) {
  const locale = share.locale;
  const t: Translate = (key, params) => translate(locale, key, params);
  const count = share.items.length;
  return (
    <div className="share-sheet min-h-screen bg-background text-foreground">
      <style dangerouslySetInnerHTML={{ __html: PRINT_CSS }} />
      <div className="mx-auto max-w-4xl space-y-14 px-4 py-8 sm:px-8 sm:py-12 print:space-y-8 print:py-0">
        <Cover share={share} t={t} />

        {count ? (
          <ol className="space-y-12 print:space-y-0">
            {share.items.map((item, index) => (
              <li key={`${item.candidateId}-${index}`} className="print:break-before-page">
                <Sheet item={item} index={index} count={count} token={token} t={t} />
              </li>
            ))}
          </ol>
        ) : (
          <p className="text-sm text-muted-foreground">{t("shares.page.noItems")}</p>
        )}

        <footer className="border-t border-border pt-6 text-meta text-muted-foreground">
          <p className="flex items-start gap-2">
            <BrandIcon className="mt-0.5 size-4 shrink-0 text-ink" />
            <span>{t("shares.page.footer")}</span>
          </p>
        </footer>
      </div>
    </div>
  );
}
