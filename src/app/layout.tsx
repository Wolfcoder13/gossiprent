import type { Metadata } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import { SetupRequired } from "@/components/setup-required";
import { SiteFooter, SiteHeader } from "@/components/site-header";
import { getDatabaseMode } from "@/db";
import { getCurrentUser } from "@/lib/auth/current-user";
import "./globals.css";

// Every page shows who's signed in and reads live reviews, so render per request.
export const dynamic = "force-dynamic";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  title: {
    default: "GossipRent — Landlord & renter reviews",
    template: "%s · GossipRent",
  },
  description:
    "Renters review their landlords and the places they live. Landlords review their renters. Star ratings and honest, written reviews.",
};

export default async function RootLayout({ children }: LayoutProps<"/">) {
  const configured = getDatabaseMode() !== "unconfigured";
  const user = configured ? await getCurrentUser() : null;

  return (
    <html
      lang="en"
      className={`${geistSans.variable} ${geistMono.variable} h-full antialiased`}
    >
      <body className="flex min-h-full flex-col font-sans">
        <a
          href="#main"
          className="sr-only z-50 rounded-full bg-brand px-4 py-2 text-brand-ink focus:not-sr-only focus:fixed focus:left-4 focus:top-4"
        >
          Skip to content
        </a>
        <SiteHeader user={user} />
        <main id="main" className="flex-1">
          {configured ? children : <SetupRequired />}
        </main>
        <SiteFooter />
      </body>
    </html>
  );
}
