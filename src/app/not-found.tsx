import { ButtonLink } from "@/components/ui";
import { getT } from "@/i18n/server";

export default async function NotFound() {
  const t = await getT();
  return (
    <div className="mx-auto max-w-xl px-4 py-24 text-center">
      <p className="text-sm font-semibold uppercase tracking-wide text-brand">404</p>
      <h1 className="mt-2 text-3xl font-bold tracking-tight text-ink">{t("errors.notFound.title")}</h1>
      <p className="mt-3 text-muted">{t("errors.notFound.body")}</p>
      <div className="mt-8 flex justify-center gap-3">
        <ButtonLink href="/">{t("errors.notFound.home")}</ButtonLink>
        <ButtonLink href="/search" variant="secondary">
          {t("errors.notFound.search")}
        </ButtonLink>
      </div>
    </div>
  );
}
