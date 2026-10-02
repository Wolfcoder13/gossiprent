import Link from "next/link";
import { logout } from "@/app/actions/auth";
import type { SessionUser } from "@/lib/auth/current-user";
import { NavLinks } from "./nav-links";
import { Avatar, buttonStyles, ButtonLink, cx } from "./ui";

export function Logo() {
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
      <span className="text-lg">GossipRent</span>
    </Link>
  );
}

export function SiteHeader({ user }: { user: SessionUser | null }) {
  return (
    <header className="sticky top-0 z-30 border-b border-line bg-canvas/85 backdrop-blur">
      <div className="mx-auto flex max-w-6xl flex-wrap items-center gap-x-6 gap-y-2 px-4 py-3 sm:px-6">
        <Logo />
        <nav aria-label="Main" className="order-last w-full overflow-x-auto sm:order-none sm:w-auto">
          <NavLinks />
        </nav>
        <div className="ml-auto flex items-center gap-2">
          {user ? (
            <>
              <Link
                href="/dashboard"
                className="flex items-center gap-2 rounded-full py-1 pl-1 pr-3 text-sm font-medium text-ink hover:bg-surface-muted"
              >
                <Avatar name={user.name} id={user.id} size="sm" />
                <span className="hidden max-w-[10rem] truncate sm:inline">My account</span>
              </Link>
              <form action={logout}>
                <button type="submit" className={cx(buttonStyles.base, buttonStyles.ghost, "text-muted")}>
                  Log out
                </button>
              </form>
            </>
          ) : (
            <>
              <ButtonLink href="/login" variant="ghost">
                Log in
              </ButtonLink>
              <ButtonLink href="/signup">Sign up</ButtonLink>
            </>
          )}
        </div>
      </div>
    </header>
  );
}

export function SiteFooter() {
  return (
    <footer className="mt-16 border-t border-line">
      <div className="mx-auto flex max-w-6xl flex-col gap-3 px-4 py-8 text-sm text-muted sm:flex-row sm:items-center sm:justify-between sm:px-6">
        <p>
          © {new Date().getFullYear()} GossipRent. Reviews are the opinions of their authors.
        </p>
        <ul className="flex gap-4">
          <li>
            <Link href="/landlords" className="hover:text-ink">
              Landlords
            </Link>
          </li>
          <li>
            <Link href="/renters" className="hover:text-ink">
              Renters
            </Link>
          </li>
          <li>
            <Link href="/properties" className="hover:text-ink">
              Properties
            </Link>
          </li>
        </ul>
      </div>
    </footer>
  );
}
