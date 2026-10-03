"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useT } from "@/i18n/client";
import { cx } from "./ui";

const LINKS = [
  { href: "/landlords", label: "nav.landlords" },
  { href: "/renters", label: "nav.renters" },
  { href: "/properties", label: "nav.properties" },
  { href: "/reviews/new", label: "nav.writeReview" },
] as const;

export function NavLinks() {
  const t = useT();
  const pathname = usePathname();
  return (
    <ul className="flex flex-wrap items-center gap-x-1 gap-y-1.5">
      {LINKS.map((link) => {
        const active = pathname === link.href || pathname.startsWith(`${link.href}/`);
        return (
          <li key={link.href}>
            <Link
              href={link.href}
              aria-current={active ? "page" : undefined}
              className={cx(
                // Tighter on phones, so all four links fit on one line at 390px.
                "inline-block rounded-full px-2 py-1.5 text-sm font-medium transition-colors sm:px-3",
                active ? "bg-brand-soft text-brand-soft-ink" : "text-muted hover:bg-surface-muted hover:text-ink",
              )}
            >
              {t(link.label)}
            </Link>
          </li>
        );
      })}
    </ul>
  );
}
