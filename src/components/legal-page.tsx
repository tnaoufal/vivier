/**
 * The privacy policy and the terms, in both languages: a reading
 * column under the public frame, a table of contents that jumps to each
 * section, plain paragraphs. Written for the product as built:
 * candidate data, retention, the model, the roles. The owner completes
 * the legal identity before going live (docs/GO-LIVE.md).
 */
import { PageHeader } from "@/components/app-shell/page-header";
import { PublicFrame } from "@/components/public-frame";
import { BRAND } from "@/lib/brand";
import { useI18n } from "@/lib/i18n";
import { LEGAL_CONTENT, type LegalKind } from "@/lib/legal/content";

export function LegalPage({ kind }: { kind: LegalKind }) {
  const { locale, t } = useI18n();
  const page = LEGAL_CONTENT[kind][locale];
  return (
    <PublicFrame width="md">
      <article className="rise-in">
        <PageHeader eyebrow={BRAND.name} title={page.title} description={page.lead} />
        <nav className="sheet p-6" aria-label={t("legal.contents")}>
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
                <p key={paragraphIndex} className="mt-3 text-body text-ink">
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
