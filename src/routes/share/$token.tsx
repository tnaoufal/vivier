/**
 * /share/:token: the dossier a link opens, outside the app shell and
 * without a sign-in, at the level of a senior consultant's presentation.
 * A cover (the organisation, the title, the facts of the dossier, the
 * introduction, what was looked for), an overview of the profiles, then
 * one sheet per candidate (the synthesis, the requirement table with
 * its evidence, strengths and points of attention, the points to verify
 * in an interview when the analysis named some, the facts, the skills
 * and languages, the CV) and an honest footer. No photo is reproduced:
 * a profile is identified by its name. A white sheet with dark ink on
 * any theme (`share-sheet` in styles.css), printable on A4 with the
 * cover, the overview and each sheet on their own page: the PDF a
 * reader keeps is the browser's print of this page. The sentences speak
 * the sharing organisation's language, not the reader's browser's. A
 * link that no longer opens says why in one sentence.
 */
import { createFileRoute } from "@tanstack/react-router";
import { FileText, Printer } from "lucide-react";

import { Avatar } from "@/components/app-shell/avatar";
import { RequirementList } from "@/components/app-shell/requirement-list";
import { ScoreRing } from "@/components/app-shell/score-ring";
import { BrandIcon } from "@/components/brand-mark";
import { Chip } from "@/components/candidates/chip-editor";
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
import { metCount, SKILLS_SHOWN } from "@/lib/shares/draft";
import { shareCvPath } from "@/lib/shares/links";
import { getShare, type PublicShare } from "@/lib/shares/public.functions";
import { cn, ratioPercent } from "@/lib/utils";

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
 * PDF) must never catch a ring, a bar or a row rising in half way, so
 * every animation and transition of the sheet is off on paper.
 * Everything else is Tailwind's `print:` variants, so nothing here
 * depends on styles.css.
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

/** A link that opens nothing: one centred sentence, in the reader's language (no organisation to speak for). */
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
          <BrandIcon className="text-primary" />
          <span className="font-display text-lg">{BRAND.name}</span>
        </p>
        <p className="text-body text-muted-foreground">{translate(locale, key)}</p>
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

/** A section title inside a sheet: the label scale, with a hairline under it. */
function Caption({ children, help }: { children: string; help?: string | undefined }) {
  return (
    <div className="mb-3 border-b border-border pb-2">
      <h3 className="label-caps text-ink">{children}</h3>
      {help ? <p className="mt-0.5 text-meta text-muted-foreground">{help}</p> : null}
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

function BriefCard({
  brief,
  shareTitle,
  t,
}: {
  brief: ShareBrief | null;
  shareTitle: string;
  t: Translate;
}) {
  return (
    <section
      className="sheet p-6 sm:p-8 print:border-0 print:p-0 print:shadow-none"
      aria-labelledby="dossier-brief"
    >
      <h2 id="dossier-brief" className="font-display text-xl text-ink">
        {t("shares.page.brief")}
      </h2>
      {brief ? (
        <>
          {brief.title && brief.title !== shareTitle ? (
            <p className="mt-1 text-sm text-muted-foreground">{brief.title}</p>
          ) : null}
          {brief.summary ? (
            <Paragraphs text={brief.summary} className="mt-4 space-y-3 text-body text-foreground" />
          ) : null}
          <h3 className="label-caps mt-6">{t("shares.page.brief.requirements")}</h3>
          {brief.requirements.length ? (
            <ul className="mt-2 grid gap-x-8 sm:grid-cols-2">
              {brief.requirements.map((row, index) => (
                <li
                  key={`${index}-${row.label}`}
                  className="flex items-baseline gap-2.5 border-b border-border py-2 text-body text-ink"
                >
                  <span
                    aria-hidden="true"
                    className={cn(
                      "size-1.5 shrink-0 rounded-full",
                      row.required ? "bg-primary" : "bg-border",
                    )}
                  />
                  <span className="min-w-0 flex-1">{row.label}</span>
                  {row.required ? (
                    <span className="shrink-0 text-meta text-muted-foreground">
                      {t("shares.required")}
                    </span>
                  ) : null}
                </li>
              ))}
            </ul>
          ) : (
            <p className="mt-2 text-sm text-muted-foreground">
              {t("shares.page.brief.noRequirements")}
            </p>
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
  const requirements = share.brief?.requirements.length ?? 0;
  return (
    <header className="space-y-8 print:break-after-page">
      <div className="flex flex-wrap items-center justify-between gap-4 border-b border-border pb-4">
        <p className="flex min-w-0 items-center gap-2 text-ink">
          <BrandIcon className="size-5 shrink-0 text-primary" />
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
        <p className="mt-3 text-meta text-muted-foreground print:hidden">
          {t("shares.page.print.help")}
        </p>
      </div>
      {share.intro.trim() ? (
        <Paragraphs text={share.intro} className="max-w-3xl space-y-3 text-body text-foreground" />
      ) : null}
      <BriefCard brief={share.brief} shareTitle={share.title} t={t} />
    </header>
  );
}

// ---------------------------------------------------------------------
// the overview
// ---------------------------------------------------------------------

/** "6 / 8" with a thin bar: how many requirements the CV meets, at a glance; a dash when no analysis ran. */
function MetCell({ item, t }: { item: ShareItem; t: Translate }) {
  const total = item.requirements.length;
  if (!total) return <span className="text-muted-foreground">{t("shares.requirements.none")}</span>;
  const met = metCount(item.requirements);
  return (
    <div className="min-w-28" title={metSentence(t, item)}>
      <span className="tabular-nums text-ink">
        {met} / {total}
      </span>
      <div className="mt-1 h-1 w-full overflow-hidden rounded-full bg-muted" aria-hidden="true">
        <div
          className="h-full rounded-full bg-primary"
          style={{ width: `${ratioPercent(met, total)}%` }}
        />
      </div>
    </div>
  );
}

function Overview({ items, t }: { items: ShareItem[]; t: Translate }) {
  return (
    <section className="space-y-4 print:break-after-page" aria-labelledby="dossier-overview">
      <div>
        <h2 id="dossier-overview" className="font-display text-xl text-ink">
          {t("shares.page.overview")}
        </h2>
        <p className="mt-1 max-w-3xl text-sm text-muted-foreground">
          {t("shares.page.overview.text")} {t("shares.page.requirements.help")}
        </p>
      </div>
      <div className="sheet overflow-hidden print:border-0 print:shadow-none">
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="text-left">
                <th scope="col" className="label-caps px-4 py-3 sm:px-6">
                  {t("shares.page.col.rank")}
                </th>
                <th scope="col" className="label-caps px-4 py-3 sm:px-6">
                  {t("shares.page.col.candidate")}
                </th>
                <th scope="col" className="label-caps px-4 py-3 text-right sm:px-6">
                  {t("shares.page.col.score")}
                </th>
                <th scope="col" className="label-caps px-4 py-3 sm:px-6">
                  {t("shares.page.col.decision")}
                </th>
                <th scope="col" className="label-caps px-4 py-3 sm:px-6">
                  {t("shares.page.col.requirements")}
                </th>
              </tr>
            </thead>
            <tbody>
              {items.map((item, index) => (
                <tr
                  key={`${item.candidateId}-${index}`}
                  className="border-t border-border align-middle"
                >
                  <td className="px-4 py-3 text-muted-foreground tabular-nums sm:px-6">
                    {index + 1}
                  </td>
                  <td className="px-4 py-3 sm:px-6">
                    <span className="flex min-w-0 items-center gap-3">
                      <Avatar name={item.name} size="sm" className="print:hidden" />
                      <span className="min-w-0">
                        <span className="block max-w-xs truncate font-medium text-ink">
                          {item.name}
                        </span>
                        {item.headline ? (
                          <span className="block max-w-xs truncate text-meta text-muted-foreground">
                            {item.headline}
                          </span>
                        ) : null}
                      </span>
                    </span>
                  </td>
                  <td className="px-4 py-3 text-right sm:px-6">
                    <ScoreText score={item.score} t={t} />
                  </td>
                  <td className="px-4 py-3 sm:px-6">
                    <DecisionPill decision={item.decision} t={t} />
                  </td>
                  <td className="px-4 py-3 sm:px-6">
                    <MetCell item={item} t={t} />
                  </td>
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
function Points({
  title,
  points,
  empty,
  help,
}: {
  title: string;
  points: string[];
  empty?: string | undefined;
  help?: string | undefined;
}) {
  if (!points.length && !empty) return null;
  return (
    <section>
      <Caption help={help}>{title}</Caption>
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
  // At most eight chips, the rest counted: print has no expander, and a sheet is never a wall of chips.
  const skills = item.skills.slice(0, SKILLS_SHOWN);
  const moreSkills = item.skills.length - skills.length;
  return (
    <article className="sheet space-y-8 p-6 sm:p-8 print:border-0 print:p-0 print:shadow-none">
      <header className="flex flex-wrap items-start justify-between gap-6">
        <div className="flex min-w-0 flex-1 items-start gap-4">
          <Avatar name={item.name} size="lg" variant="profile" className="mt-1 print:hidden" />
          <div className="min-w-0 flex-1">
            <p className="label-caps">{t("shares.page.sheet", { index: index + 1, count })}</p>
            <h2 className="mt-1 font-display text-2xl text-ink break-words">{item.name}</h2>
            {item.headline ? (
              <p className="mt-1 text-body text-muted-foreground">{item.headline}</p>
            ) : null}
          </div>
        </div>
        <div className="flex items-center gap-4">
          <ScoreRing score={item.score} label={scoreLabel(t, item.score)} size="lg" static />
          <DecisionPill decision={item.decision} t={t} />
        </div>
      </header>

      <section>
        <Caption>{t("shares.page.synthesis")}</Caption>
        {item.summary ? (
          <Paragraphs text={item.summary} className="space-y-3 text-body text-foreground" />
        ) : (
          <p className="text-sm text-muted-foreground">{t("shares.page.noSummary")}</p>
        )}
      </section>

      <section>
        <Caption help={t("shares.page.requirements.help")}>{t("shares.page.requirements")}</Caption>
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
      <Points
        title={t("shares.page.questions")}
        points={item.questions}
        help={t("shares.page.questions.help")}
      />

      <section>
        <Caption>{t("shares.page.facts")}</Caption>
        <p className="text-body text-ink">{factsLine(t, item)}</p>
      </section>

      <div className="grid gap-8 sm:grid-cols-2">
        <section>
          <Caption>{t("shares.page.skills")}</Caption>
          {skills.length ? (
            <ul className="flex flex-wrap items-center gap-1.5">
              {skills.map((skill, skillIndex) => (
                <li key={`${skillIndex}-${skill}`} className="min-w-0 max-w-full">
                  <Chip>{skill}</Chip>
                </li>
              ))}
              {moreSkills > 0 ? (
                <li className="text-meta text-muted-foreground tabular-nums">
                  {moreSkills === 1
                    ? t("shares.page.skills.more.one")
                    : t("shares.page.skills.more.many", { count: moreSkills })}
                </li>
              ) : null}
            </ul>
          ) : (
            <p className="text-sm text-muted-foreground">{t("shares.page.skills.none")}</p>
          )}
        </section>
        <section>
          <Caption>{t("shares.page.languages")}</Caption>
          {item.languages.length ? (
            <p className="text-body text-ink">{item.languages.join(" · ")}</p>
          ) : (
            <p className="text-sm text-muted-foreground">{t("shares.page.languages.none")}</p>
          )}
        </section>
      </div>

      {item.documentId ? (
        <div>
          <Button asChild variant="outline" size="sm" icon={<FileText />} className="print:hidden">
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

        <footer className="border-t border-border pt-6 text-meta text-muted-foreground">
          <p className="flex items-start gap-2">
            <BrandIcon className="mt-0.5 size-4 shrink-0 text-primary" />
            <span>{t("shares.page.footer")}</span>
          </p>
        </footer>
      </div>
    </div>
  );
}
