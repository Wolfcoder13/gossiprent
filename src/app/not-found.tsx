import { ButtonLink } from "@/components/ui";

export default function NotFound() {
  return (
    <div className="mx-auto max-w-xl px-4 py-24 text-center">
      <p className="text-sm font-semibold uppercase tracking-wide text-brand">404</p>
      <h1 className="mt-2 text-3xl font-bold tracking-tight text-ink">We couldn&apos;t find that page</h1>
      <p className="mt-3 text-muted">
        The landlord, renter, or property you&apos;re looking for may have been removed, or the link is wrong.
      </p>
      <div className="mt-8 flex justify-center gap-3">
        <ButtonLink href="/">Go home</ButtonLink>
        <ButtonLink href="/search" variant="secondary">
          Search
        </ButtonLink>
      </div>
    </div>
  );
}
