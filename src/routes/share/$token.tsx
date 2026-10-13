/**
 * /share/:token: the presentation a link opens, outside the app shell
 * and without a sign-in. A white sheet with dark ink on any theme
 * (`share-sheet` in styles.css), printable: the PDF a reader keeps is
 * the browser's print of this page. The sentences speak the sharing
 * organisation's language, not the reader's browser's. A link that no
 * longer opens says why in one sentence.
 */
import { createFileRoute } from "@tanstack/react-router";
import { FileText, Printer } from "lucide-react";

import { BrandIcon } from "@/components/brand-mark";
import { Button } from "@/components/ui/button";
import { BRAND } from "@/lib/brand";
import type { Locale, ShareItem } from "@/lib/db/types";
import { formatDate, translate, useI18n, type Params, type TranslationKey } from "@/lib/i18n";
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

function SharePage() {
  const share = Route.useLoaderData();
  const { token } = Route.useParams();
  const { locale } = useI18n();
  if (share.state !== "ok") return <Closed state={share.state} locale={locale} />;
  return <Sheet share={share} token={token} />;
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

/** The intro as paragraphs: blank-line separated. */
function paragraphsOf(text: string): string[] {
  return text
    .split(/\n\s*\n/)
    .map((part) => part.trim())
    .filter((part) => part.length > 0);
}

function Points({ title, points }: { title: string; points: string[] }) {
  return (
    <div className="mt-4">
      <h3 className="label-caps">{title}</h3>
      <ul className="mt-1.5 list-disc space-y-1 pl-5 text-[15px] leading-relaxed text-foreground">
        {points.map((point, index) => (
          <li key={`${index}-${point}`}>{point}</li>
        ))}
      </ul>
    </div>
  );
}

function Item({ item, index, token, t }: { item: ShareItem; index: number; token: string; t: (key: TranslationKey, params?: Params) => string }) {
  return (
    <li className="break-inside-avoid border-b border-border pb-8 last:border-0 last:pb-0">
      <h2 className="font-display text-xl text-ink">
        <span className="mr-2 text-muted-foreground">{index + 1}.</span>
        {item.name}
      </h2>
      {item.headline ? <p className="mt-1 text-sm text-muted-foreground">{item.headline}</p> : null}
      {item.summary ? (
        <p className="mt-3 whitespace-pre-line text-[15px] leading-relaxed text-foreground">{item.summary}</p>
      ) : (
        <p className="mt-3 text-sm italic text-muted-foreground">{t("shares.page.noSummary")}</p>
      )}
      {item.strengths.length ? <Points title={t("shares.page.strengths")} points={item.strengths} /> : null}
      {item.attention.length ? <Points title={t("shares.page.attention")} points={item.attention} /> : null}
      {item.documentId ? (
        <Button asChild variant="outline" size="sm" className="no-print mt-4 gap-1.5">
          <a href={shareCvPath(token, item.documentId)} target="_blank" rel="noopener noreferrer">
            <FileText />
            {t("shares.page.cv")}
          </a>
        </Button>
      ) : null}
    </li>
  );
}

function Sheet({ share, token }: { share: OpenShare; token: string }) {
  const locale = share.locale;
  const t = (key: TranslationKey, params?: Params) => translate(locale, key, params);
  const intro = paragraphsOf(share.intro);
  return (
    <div className="share-sheet min-h-screen bg-background text-foreground">
      <div className="mx-auto max-w-3xl px-4 py-8 sm:px-8 sm:py-12">
        <header className="border-b border-border pb-6">
          <div className="flex flex-wrap items-start justify-between gap-4">
            <div className="min-w-0">
              <p className="label-caps">
                {share.orgName ? `${share.orgName} · ` : ""}
                {t("shares.page.eyebrow")}
              </p>
              <h1 className="mt-1 font-display text-2xl text-ink sm:text-3xl">{share.title}</h1>
              <p className="mt-2 text-sm text-muted-foreground">
                {t("shares.page.dates", {
                  created: formatDate(locale, share.createdAt),
                  expires: formatDate(locale, share.expiresAt),
                })}
              </p>
            </div>
            <div className="no-print flex max-w-xs flex-col items-start gap-1.5">
              <Button type="button" variant="outline" onClick={() => window.print()} className="gap-1.5">
                <Printer />
                {t("shares.page.print")}
              </Button>
              <p className="text-xs text-muted-foreground">{t("shares.page.print.help")}</p>
            </div>
          </div>
        </header>

        {intro.length ? (
          <div className="mt-6 space-y-3 text-[15px] leading-relaxed text-foreground">
            {intro.map((paragraph, index) => (
              <p key={index}>{paragraph}</p>
            ))}
          </div>
        ) : null}

        {share.items.length ? (
          <ol className="mt-8 space-y-8">
            {share.items.map((item, index) => (
              <Item key={`${item.candidateId}-${index}`} item={item} index={index} token={token} t={t} />
            ))}
          </ol>
        ) : (
          <p className="mt-8 text-sm text-muted-foreground">{t("shares.page.noItems")}</p>
        )}

        <footer className="mt-10 border-t border-border pt-6 text-xs leading-relaxed text-muted-foreground">
          <p className="flex items-start gap-2">
            <BrandIcon className="mt-0.5 size-4 text-primary" />
            <span>{t("shares.page.footer")}</span>
          </p>
        </footer>
      </div>
    </div>
  );
}
