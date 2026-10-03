import Link from "next/link";
import type { ComponentProps, ReactNode } from "react";

// A client component (its label is translated with useT); re-exported so
// server and client components can keep importing it from here.
export { NoAccountBadge, RoleBadge } from "./role-badge";

/** Tiny className joiner. */
export function cx(...classes: (string | false | null | undefined)[]): string {
  return classes.filter(Boolean).join(" ");
}

export const buttonStyles = {
  base: "inline-flex items-center justify-center gap-2 rounded-full px-4 py-2 text-sm font-semibold transition-colors aria-disabled:cursor-wait aria-disabled:opacity-60",
  primary: "bg-brand text-brand-ink hover:bg-brand-hover",
  secondary: "border border-line-strong bg-surface text-ink hover:bg-surface-muted",
  ghost: "text-ink hover:bg-surface-muted",
  danger: "border border-danger/40 bg-surface text-danger hover:bg-danger-soft",
};

export function ButtonLink({
  variant = "primary",
  className,
  ...props
}: ComponentProps<typeof Link> & { variant?: keyof Omit<typeof buttonStyles, "base"> }) {
  return (
    <Link
      className={cx(buttonStyles.base, buttonStyles[variant], className)}
      {...props}
    />
  );
}

export function Card({ children, as: Tag = "div" }: { children: ReactNode; as?: "div" | "section" }) {
  return (
    <Tag className="rounded-2xl border border-line bg-surface p-5 shadow-sm sm:p-6">{children}</Tag>
  );
}

const AVATAR_COLORS = [
  "bg-rose-200 text-rose-900",
  "bg-amber-200 text-amber-900",
  "bg-lime-200 text-lime-900",
  "bg-emerald-200 text-emerald-900",
  "bg-cyan-200 text-cyan-900",
  "bg-indigo-200 text-indigo-900",
  "bg-fuchsia-200 text-fuchsia-900",
];

// Company-form suffixes don't count as a name part ("Hamar ehf." → "H", not "HE").
const COMPANY_FORM = /^(?:ehf|hf|ohf|hses|sf|slf)\.?$/i;

export function Avatar({
  name,
  id,
  size = "md",
}: {
  name: string;
  id: string;
  size?: "sm" | "md" | "lg";
}) {
  const initials =
    name
      .split(/\s+/)
      .filter((part) => part && !COMPANY_FORM.test(part))
      .slice(0, 2)
      .map((part) => Array.from(part)[0]!.toLocaleUpperCase("is"))
      .join("") || "?";
  let hash = 0;
  for (const char of id) hash = (hash * 31 + char.charCodeAt(0)) >>> 0;
  const sizes = { sm: "size-8 text-xs", md: "size-11 text-sm", lg: "size-16 text-xl" };
  return (
    <span
      aria-hidden
      className={cx(
        "inline-flex shrink-0 items-center justify-center rounded-full font-semibold",
        AVATAR_COLORS[hash % AVATAR_COLORS.length],
        sizes[size],
      )}
    >
      {initials}
    </span>
  );
}

export function EmptyState({
  title,
  children,
  action,
}: {
  title: string;
  children?: ReactNode;
  action?: ReactNode;
}) {
  return (
    <div className="rounded-2xl border border-dashed border-line-strong bg-surface/60 px-6 py-10 text-center">
      <p className="font-semibold wrap-anywhere text-ink">{title}</p>
      {children && (
        <div className="mx-auto mt-1 max-w-md text-sm wrap-anywhere text-muted">{children}</div>
      )}
      {action && <div className="mt-4">{action}</div>}
    </div>
  );
}

export function PageHeader({
  title,
  description,
  actions,
}: {
  title: ReactNode;
  description?: ReactNode;
  actions?: ReactNode;
}) {
  return (
    <div className="flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
      <div className="min-w-0">
        <h1 className="text-3xl font-bold tracking-tight wrap-anywhere text-ink sm:text-4xl">{title}</h1>
        {description && <p className="mt-2 max-w-2xl text-muted">{description}</p>}
      </div>
      {actions && <div className="flex shrink-0 gap-2">{actions}</div>}
    </div>
  );
}

export function Notice({
  tone,
  children,
}: {
  tone: "success" | "error";
  children: ReactNode;
}) {
  const tones = {
    success: "border-success/30 bg-success-soft text-success",
    error: "border-danger/30 bg-danger-soft text-danger",
  };
  return (
    <div
      role={tone === "error" ? "alert" : "status"}
      tabIndex={-1}
      className={cx("rounded-xl border px-4 py-3 text-sm focus:outline-none", tones[tone])}
    >
      {children}
    </div>
  );
}
