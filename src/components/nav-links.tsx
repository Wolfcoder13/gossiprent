"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { cx } from "./ui";

const LINKS = [
  { href: "/landlords", label: "Landlords" },
  { href: "/renters", label: "Renters" },
  { href: "/properties", label: "Properties" },
];

export function NavLinks({ className }: { className?: string }) {
  const pathname = usePathname();
  return (
    <ul className={cx("flex flex-wrap items-center gap-x-1 gap-y-1.5", className)}>
      {LINKS.map((link) => {
        const active = pathname === link.href || pathname.startsWith(`${link.href}/`);
        return (
          <li key={link.href}>
            <Link
              href={link.href}
              aria-current={active ? "page" : undefined}
              className={cx(
                "inline-block rounded-full px-3 py-1.5 text-sm font-medium transition-colors",
                active ? "bg-brand-soft text-brand-soft-ink" : "text-muted hover:bg-surface-muted hover:text-ink",
              )}
            >
              {link.label}
            </Link>
          </li>
        );
      })}
    </ul>
  );
}
