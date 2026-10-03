import type { Metadata } from "next";
import Link from "next/link";
import type { ReactNode } from "react";
import { getT } from "@/i18n/server";
import { reportPath } from "@/lib/paths";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getT();
  return { title: t("meta.pages.privacy") };
}

// Message keys: each section's heading and paragraphs, in order.
const SECTIONS = [
  { id: "kennitala", heading: "privacy.kennitala.heading", body: ["privacy.kennitala.why", "privacy.kennitala.when"] },
  { id: "never-shown", heading: "privacy.hidden.heading", body: ["privacy.hidden.body"] },
  { id: "not-verified", heading: "privacy.verified.heading", body: ["privacy.verified.body"] },
  { id: "reviews", heading: "privacy.reviews.heading", body: ["privacy.reviews.remove", "privacy.reviews.noAccount"] },
  { id: "closing", heading: "privacy.closing.heading", body: ["privacy.closing.body"] },
  {
    id: "stored",
    heading: "privacy.stored.heading",
    body: ["privacy.stored.account", "privacy.stored.cookies", "privacy.stored.abuse", "privacy.stored.reports"],
  },
] as const;

/** /privacy: why kennitalas are used, how they're kept out of sight, and what people can do. */
export default async function PrivacyPage() {
  const t = await getT();
  return (
    <article className="mx-auto max-w-2xl px-4 py-10 sm:px-6">
      <h1 className="text-3xl font-bold tracking-tight text-ink sm:text-4xl">{t("privacy.title")}</h1>
      <p className="mt-3 text-lg text-muted">{t("privacy.intro")}</p>

      {SECTIONS.map((section) => (
        <Section key={section.id} id={section.id} heading={t(section.heading)}>
          {section.body.map((key) => (
            <p key={key}>{t(key)}</p>
          ))}
        </Section>
      ))}

      <Section id="contact" heading={t("privacy.contact.heading")}>
        <p>
          {t.rich("privacy.contact.body", {
            form: (
              <Link href={reportPath("account")} className="font-semibold text-brand hover:underline">
                {t("privacy.contact.form")}
              </Link>
            ),
          })}
        </p>
      </Section>
    </article>
  );
}

function Section({ id, heading, children }: { id: string; heading: string; children: ReactNode }) {
  return (
    <section aria-labelledby={`${id}-heading`} className="mt-10">
      <h2 id={`${id}-heading`} className="text-xl font-semibold text-ink">
        {heading}
      </h2>
      <div className="mt-3 space-y-3 leading-relaxed text-ink/90">{children}</div>
    </section>
  );
}
