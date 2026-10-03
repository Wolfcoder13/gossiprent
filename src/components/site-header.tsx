import Link from "next/link";
import { logout } from "@/app/actions/auth";
import { getT } from "@/i18n/server";
import type { SessionUser } from "@/lib/auth/current-user";
import { LanguageSwitch } from "./language-switch";
import { NavLinks } from "./nav-links";
import { Avatar, buttonStyles, ButtonLink, cx } from "./ui";

// Header buttons are tighter on phones so the logo, the language switch and
// the account buttons share one line even at 320px.
const compact = "px-2.5! sm:px-4!";

function Logo() {
  return (
    <Link href="/" className="flex items-center gap-2 font-bold tracking-tight text-ink">
      <span
        aria-hidden
        className="inline-flex size-8 items-center justify-center rounded-lg bg-brand text-brand-ink"
      >
        <svg viewBox="0 0 24 24" className="size-5" fill="none" stroke="currentColor" strokeWidth={2}>
          <path d="M3 11 12 4l9 7" strokeLinecap="round" strokeLinejoin="round" />
          <path
            d="M12 9.5l1.3 2.7 2.9.4-2.1 2 .5 2.9L12 16.1l-2.6 1.4.5-2.9-2.1-2 2.9-.4L12 9.5z"
            fill="currentColor"
            stroke="none"
          />
        </svg>
      </span>
      {/* Most phones only have room for the mark; the name stays the link's accessible name. */}
      <span className="sr-only text-lg min-[420px]:not-sr-only">GossipRent</span>
    </Link>
  );
}

export async function SiteHeader({ user }: { user: SessionUser | null }) {
  const t = await getT();
  return (
    <header className="sticky top-0 z-30 border-b border-line bg-canvas/85 backdrop-blur">
      {/* One row on wide screens; below lg the nav gets its own row under the logo and buttons. */}
      <div className="mx-auto flex max-w-6xl flex-wrap items-center gap-x-3 gap-y-2 px-4 py-3 sm:px-6 lg:gap-x-6">
        <Logo />
        <nav aria-label={t("nav.main")} className="order-last w-full lg:order-none lg:w-auto">
          <NavLinks />
        </nav>
        <div className="ml-auto flex items-center gap-1 sm:gap-2">
          <LanguageSwitch />
          {user ? (
            <>
              <Link
                href="/dashboard"
                aria-label={t("nav.myAccount")}
                className="flex items-center gap-2 rounded-full p-1 text-sm font-medium text-ink hover:bg-surface-muted sm:pr-3"
              >
                <Avatar name={user.name} id={user.id} size="sm" />
                <span className="hidden sm:inline">{t("nav.myAccount")}</span>
              </Link>
              <form action={logout}>
                <button type="submit" className={cx(buttonStyles.base, buttonStyles.ghost, "text-muted", compact)}>
                  {t("nav.logOut")}
                </button>
              </form>
            </>
          ) : (
            <>
              <ButtonLink href="/login" variant="ghost" className={compact}>
                {t("nav.logIn")}
              </ButtonLink>
              <ButtonLink href="/signup" className={compact}>
                {t("nav.signUp")}
              </ButtonLink>
            </>
          )}
        </div>
      </div>
    </header>
  );
}

const FOOTER_LINKS = [
  { href: "/landlords", label: "nav.landlords" },
  { href: "/renters", label: "nav.renters" },
  { href: "/properties", label: "nav.properties" },
  { href: "/privacy", label: "nav.privacy" },
] as const;

export async function SiteFooter() {
  const t = await getT();
  return (
    <footer className="mt-16 border-t border-line">
      <div className="mx-auto flex max-w-6xl flex-col gap-3 px-4 py-8 text-sm text-muted sm:flex-row sm:items-start sm:justify-between sm:gap-8 sm:px-6">
        <div className="space-y-1">
          {/* A string, not a number: numbers are formatted for the locale ("2.026"). */}
          <p>{t("nav.copyright", { year: String(new Date().getFullYear()) })}</p>
          <p>{t("nav.disclaimer")}</p>
        </div>
        <ul className="flex shrink-0 flex-wrap gap-x-4 gap-y-2">
          {FOOTER_LINKS.map((link) => (
            <li key={link.href}>
              <Link href={link.href} className="hover:text-ink">
                {t(link.label)}
              </Link>
            </li>
          ))}
          <li>
            <LanguageSwitch variant="footer" />
          </li>
        </ul>
      </div>
    </footer>
  );
}
