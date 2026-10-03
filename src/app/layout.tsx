import type { Metadata } from "next";
import { Geist } from "next/font/google";
import { EnglishHint } from "@/components/language-switch";
import { SetupRequired } from "@/components/setup-required";
import { SiteFooter, SiteHeader } from "@/components/site-header";
import { getDatabaseMode } from "@/db";
import { I18nProvider } from "@/i18n/client";
import { getLocale, getMessages, getT, shouldOfferEnglish } from "@/i18n/server";
import { getCurrentUser } from "@/lib/auth/current-user";
import "./globals.css";

// Every page shows who's signed in, reads live reviews, and is rendered in the
// visitor's language (a cookie, with the same URLs), so render per request.
export const dynamic = "force-dynamic";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

export async function generateMetadata(): Promise<Metadata> {
  const t = await getT();
  return {
    title: {
      default: t("meta.title"),
      template: "%s · GossipRent",
    },
    description: t("meta.description"),
  };
}

export default async function RootLayout({ children }: LayoutProps<"/">) {
  const configured = getDatabaseMode() !== "unconfigured";
  const [locale, messages, t, offerEnglish, user] = await Promise.all([
    getLocale(),
    getMessages(),
    getT(),
    shouldOfferEnglish(),
    configured ? getCurrentUser() : null,
  ]);

  return (
    <html lang={locale} className={`${geistSans.variable} h-full antialiased`}>
      <body className="flex min-h-full flex-col">
        {/* Keyed by language, so switching remounts client components with the new dictionary. */}
        <I18nProvider key={locale} locale={locale} messages={messages}>
          <a
            href="#main"
            className="sr-only z-50 rounded-full bg-brand text-brand-ink focus:not-sr-only focus:fixed focus:left-4 focus:top-4 focus:px-4 focus:py-2"
          >
            {t("nav.skipToContent")}
          </a>
          {offerEnglish && <EnglishHint />}
          <SiteHeader user={user} />
          <main id="main" className="flex-1">
            {configured ? children : <SetupRequired />}
          </main>
          <SiteFooter />
        </I18nProvider>
      </body>
    </html>
  );
}
