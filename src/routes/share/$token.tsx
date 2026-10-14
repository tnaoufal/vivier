/**
 * /share/:token: the dossier a link opens, outside the app shell and
 * without a sign-in, at the level of a senior consultant's presentation:
 * a cover with what was looked for, an overview of the profiles, then
 * one sheet per candidate (the requirement table with its evidence, the
 * synthesis, strengths and points of attention, the points to verify in
 * an interview when the analysis named some, the practical facts, the
 * CV) and an honest footer. A white sheet with dark ink on any theme
 * (`share-sheet` in styles.css), printable on A4 with one sheet per
 * page: the PDF a reader keeps is the browser's print of this page. The
 * sentences speak the sharing organisation's language, not the reader's
 * browser's. A link that no longer opens says why in one sentence.
 */
import { createFileRoute } from "@tanstack/react-router";
import { FileText, Printer } from "lucide-react";

import { BrandIcon } from "@/components/brand-mark";
import { RequirementList } from "@/components/app-shell/requirement-list";
import { ScoreRing } from "@/components/app-shell/score-ring";
import {
  DecisionPill,
  factsLine,
  metLabel,
  metSentence,
  requirementRowsOf,
  scoreLabel,
  ScoreText,
  type Translate,
} from "@/components/share/assessment-bits";
import { Button } from "@/components/ui/button";
import { BRAND } from "@/lib/brand";
import type { Locale, ShareBrief, ShareItem } from "@/lib/db/types";
import { formatDate, translate, useI18n, type TranslationKey } from "@/lib/i18n";
import { shareCvPath } from "@/lib/shares/links";
import { getShare, type PublicShare } from "@/lib/shares/public.functions";

export const Route = createFileRoute("/share/$token")({
  loader: ({ params }) => getShare({ data: { token: params.token } }),
  head: ({ loaderData }) => ({
    meta: [
      { name: "robots", content: "noindex, nofollow" },
      { title: loaderData && loaderData.state === "ok" ? `${loaderData.title} — ${BRAND.name}` : BRAND.name },
    ],
  }),
  component: SharePage,
});

type OpenShare = Extract<PublicShare, { state: "ok" }>;

/**
 * A4 with a 16mm margin, and the ring drawn at rest: the print must not
 * catch its 200ms transition half way. Everything else is Tailwind's
 * `print:` variants, so nothing here depends on styles.css.
 */
const PRINT_CSS =
  "@page { size: A4; margin: 16mm } @media print { .share-sheet svg circle { transition: none !important; animation: none !important } }";

function SharePage() {
  const share = Route.useLoaderData();
  const { token } = Route.useParams();
  const { locale } = useI18n();
  if (share.state !== "ok") return <Closed state={share.state} locale={locale} />;
  return <Dossier share={share} token={token} />;
}

/** A link that opens nothing: one centred sentence, in the reader's language (no organisation to speak for). */
function Closed({ state, locale }: { state: "missing" | "revoked" | "expired"; locale: Locale }) {
  const key: TranslationKey =
    state === "revoked" ? "shares.page.revoked" : state === "expired" ? "shares.page.expired" : "shares.page.missing";
  return (
    <div className="share-sheet flex min-h-screen items-center justify-center bg-background px-4 text-foreground">
      <div className="max-w-md text-center">
        <p className="mb-6 flex items-center justify-center gap-2 text-ink">
          <BrandIcon className="text-primary" />
          <span className="font-display text-lg">{BRAND.name}</span>
        </p>
        <p className="text-base text-muted-foreground">{translate(locale, key)}</p>
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

// ---------------------------------------------------------------------
// the cover
// ---------------------------------------------------------------------

function BriefCard({ brief, shareTitle, t }: { brief: ShareBrief | null; shareTitle: string; t: Translate }) {
  return (
    <section className="sheet p-6 sm:p-8 print:border-0 print:p-0" aria-labelledby="dossier-brief">
      <h2 id="dossier-brief" className="font-display text-xl text-ink">
        {t("shares.page.brief")}
      </h2>
      {brief ? (
        <>
          {brief.title && brief.title !== shareTitle ? <p className="mt-1 text-sm text-muted-foreground">{brief.title}</p> : null}
          {brief.summary ? (
            <Paragraphs text={brief.summary} className="mt-4 space-y-3 text-[15px] leading-6 text-foreground" />
          ) : null}
          <h3 className="label-caps mt-6">{t("shares.page.brief.requirements")}</h3>
          {brief.requirements.length ? (
            <ul className="mt-2 divide-y divide-border">
              {brief.requirements.map((row, index) => (
                <li key={`${index}-${row.label}`} className="flex flex-wrap items-baseline gap-x-2 py-2 text-[15px] leading-6 text-ink">
                  <span className="min-w-0">{row.label}</span>
                  {row.required ? <span className="text-[13px] text-muted-foreground">{t("shares.required")}</span> : null}
                </li>
              ))}
            </ul>
          ) : (
            <p className="mt-2 text-sm text-muted-foreground">{t("shares.page.brief.noRequirements")}</p>
          )}
        </>
      ) : (
        <p className="mt-2 text-sm text-muted-foreground">{t("shares.page.brief.none")}</p>
      )}
    </section>
  );
}

function Cover({ share, t }: { share: OpenShare; t: Translate }) {
  const count = share.items.length;
  const dates = {
    created: formatDate(share.locale, share.createdAt),
    expires: formatDate(share.locale, share.expiresAt),
    count,
  };
  return (
    <header className="space-y-8">
      <div className="flex flex-wrap items-start justify-between gap-6">
        <div className="min-w-0 flex-1">
          <p className="label-caps">
            {share.orgName ? `${share.orgName} · ` : ""}
            {t("shares.page.eyebrow")}
          </p>
          <h1 className="mt-2 font-display text-3xl text-ink sm:text-4xl">{share.title}</h1>
          <p className="mt-3 text-sm text-muted-foreground">
            {count === 1 ? t("shares.page.dates.one", dates) : t("shares.page.dates.many", dates)}
          </p>
        </div>
        <div className="flex max-w-xs flex-col items-start gap-1.5 print:hidden">
          <Button type="button" variant="outline" onClick={() => window.print()} className="gap-1.5">
            <Printer />
            {t("shares.page.print")}
          </Button>
          <p className="text-[13px] leading-5 text-muted-foreground">{t("shares.page.print.help")}</p>
        </div>
      </div>
      {share.intro.trim() ? <Paragraphs text={share.intro} className="space-y-3 text-[15px] leading-6 text-foreground" /> : null}
      <BriefCard brief={share.brief} shareTitle={share.title} t={t} />
    </header>
  );
}

// ---------------------------------------------------------------------
// the overview
// ---------------------------------------------------------------------

function Overview({ items, t }: { items: ShareItem[]; t: Translate }) {
  return (
    <section className="space-y-4" aria-labelledby="dossier-overview">
      <div>
        <h2 id="dossier-overview" className="font-display text-xl text-ink">
          {t("shares.page.overview")}
        </h2>
        <p className="mt-1 text-sm text-muted-foreground">
          {t("shares.page.overview.text")} {t("shares.page.requirements.help")}
        </p>
      </div>
      <div className="sheet print:border-0">
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="text-left">
                <th scope="col" className="label-caps px-4 py-3 font-semibold sm:px-6">
                  {t("shares.page.col.rank")}
                </th>
                <th scope="col" className="label-caps px-4 py-3 font-semibold sm:px-6">
                  {t("shares.page.col.candidate")}
                </th>
                <th scope="col" className="label-caps px-4 py-3 text-right font-semibold sm:px-6">
                  {t("shares.page.col.score")}
                </th>
                <th scope="col" className="label-caps px-4 py-3 font-semibold sm:px-6">
                  {t("shares.page.col.decision")}
                </th>
                <th scope="col" className="label-caps px-4 py-3 font-semibold sm:px-6">
                  {t("shares.page.col.requirements")}
                </th>
              </tr>
            </thead>
            <tbody>
              {items.map((item, index) => (
                <tr key={`${item.candidateId}-${index}`} className="border-t border-border align-top">
                  <td className="px-4 py-3 tabular-nums text-muted-foreground sm:px-6">{index + 1}</td>
                  <td className="px-4 py-3 sm:px-6">
                    <span className="block max-w-xs truncate font-medium text-ink">{item.name}</span>
                    {item.headline ? (
                      <span className="block max-w-xs truncate text-[13px] text-muted-foreground">{item.headline}</span>
                    ) : null}
                  </td>
                  <td className="px-4 py-3 text-right sm:px-6">
                    <ScoreText score={item.score} />
                  </td>
                  <td className="px-4 py-3 sm:px-6">
                    <DecisionPill decision={item.decision} t={t} />
                  </td>
                  <td className="whitespace-nowrap px-4 py-3 tabular-nums text-ink sm:px-6">{metSentence(t, item)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </section>
  );
}

// ---------------------------------------------------------------------
// one sheet per candidate
// ---------------------------------------------------------------------

/** A titled list of points; the `empty` sentence when there is none, or nothing at all when the caller gives no sentence. */
function Points({ title, points, empty, help }: { title: string; points: string[]; empty?: string | undefined; help?: string | undefined }) {
  if (!points.length && !empty) return null;
  return (
    <section>
      <h3 className="label-caps">{title}</h3>
      {help ? <p className="mt-1 text-[13px] leading-5 text-muted-foreground">{help}</p> : null}
      {points.length ? (
        <ul className="mt-2 list-disc space-y-1 pl-5 text-[15px] leading-6 text-foreground">
          {points.map((point, index) => (
            <li key={`${index}-${point}`}>{point}</li>
          ))}
        </ul>
      ) : (
        <p className="mt-2 text-sm text-muted-foreground">{empty}</p>
      )}
    </section>
  );
}

function Sheet({ item, index, count, token, t }: { item: ShareItem; index: number; count: number; token: string; t: Translate }) {
  const rows = requirementRowsOf(item);
  return (
    <article className="sheet space-y-8 p-6 sm:p-8 print:border-0 print:p-0">
      <header className="flex flex-wrap items-start justify-between gap-6">
        <div className="min-w-0 flex-1">
          <p className="label-caps">{t("shares.page.sheet", { index: index + 1, count })}</p>
          <h2 className="mt-2 font-display text-2xl text-ink">
            <span className="mr-2 text-muted-foreground">{index + 1}.</span>
            {item.name}
          </h2>
          {item.headline ? <p className="mt-1 text-[15px] leading-6 text-muted-foreground">{item.headline}</p> : null}
          <p className="mt-2 text-sm text-muted-foreground">{factsLine(t, item)}</p>
        </div>
        <div className="flex items-center gap-4">
          <ScoreRing score={item.score} label={scoreLabel(t, item.score)} size="lg" />
          <DecisionPill decision={item.decision} t={t} />
        </div>
      </header>

      <section>
        <h3 className="label-caps">{t("shares.page.synthesis")}</h3>
        {item.summary ? (
          <p className="mt-2 whitespace-pre-line text-[15px] leading-6 text-foreground">{item.summary}</p>
        ) : (
          <p className="mt-2 text-sm italic text-muted-foreground">{t("shares.page.noSummary")}</p>
        )}
      </section>

      <section>
        <h3 className="label-caps">{t("shares.page.requirements")}</h3>
        {rows.length ? (
          <RequirementList
            rows={rows}
            markLabel={(met) => metLabel(t, met)}
            requiredLabel={t("shares.required")}
            compact
            className="mt-2"
          />
        ) : (
          <p className="mt-2 text-sm text-muted-foreground">{t("shares.page.requirements.empty")}</p>
        )}
      </section>

      <div className="grid gap-8 sm:grid-cols-2">
        <Points title={t("shares.page.strengths")} points={item.strengths} empty={t("shares.page.strengths.none")} />
        <Points title={t("shares.page.attention")} points={item.attention} empty={t("shares.page.attention.none")} />
      </div>

      {/* Only when the analysis named some: a sheet without questions says nothing rather than "none". */}
      <Points title={t("shares.page.questions")} points={item.questions} help={t("shares.page.questions.help")} />

      <div className="grid gap-8 sm:grid-cols-2">
        <section>
          <h3 className="label-caps">{t("shares.page.skills")}</h3>
          {item.skills.length ? (
            <ul className="mt-2 flex flex-wrap gap-1.5">
              {item.skills.map((skill, skillIndex) => (
                <li
                  key={`${skillIndex}-${skill}`}
                  className="rounded-full border border-border px-2.5 py-0.5 text-[13px] leading-5 text-ink"
                >
                  {skill}
                </li>
              ))}
            </ul>
          ) : (
            <p className="mt-2 text-sm text-muted-foreground">{t("shares.page.skills.none")}</p>
          )}
        </section>
        <section>
          <h3 className="label-caps">{t("shares.page.languages")}</h3>
          {item.languages.length ? (
            <p className="mt-2 text-[15px] leading-6 text-ink">{item.languages.join(" · ")}</p>
          ) : (
            <p className="mt-2 text-sm text-muted-foreground">{t("shares.page.languages.none")}</p>
          )}
        </section>
      </div>

      {item.documentId ? (
        <div>
          <Button asChild variant="outline" size="sm" className="gap-1.5 print:hidden">
            <a href={shareCvPath(token, item.documentId)} target="_blank" rel="noopener noreferrer">
              <FileText />
              {t("shares.page.cv")}
            </a>
          </Button>
          <p className="hidden text-sm text-muted-foreground print:block">{t("shares.page.cv.print")}</p>
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
      <div className="mx-auto max-w-4xl space-y-12 px-4 py-10 sm:px-8 sm:py-16 print:space-y-8 print:py-0">
        <Cover share={share} t={t} />

        {count ? (
          <>
            <Overview items={share.items} t={t} />
            <ol className="space-y-12 print:space-y-0">
              {share.items.map((item, index) => (
                <li key={`${item.candidateId}-${index}`} className="print:break-before-page">
                  <Sheet item={item} index={index} count={count} token={token} t={t} />
                </li>
              ))}
            </ol>
          </>
        ) : (
          <p className="text-sm text-muted-foreground">{t("shares.page.noItems")}</p>
        )}

        <footer className="border-t border-border pt-6 text-[13px] leading-5 text-muted-foreground">
          <p className="flex items-start gap-2">
            <BrandIcon className="mt-0.5 size-4 shrink-0 text-primary" />
            <span>{t("shares.page.footer")}</span>
          </p>
        </footer>
      </div>
    </div>
  );
}
