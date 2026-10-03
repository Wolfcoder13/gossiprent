"use client";

import { placeLine, streetLine, type AddressParts } from "@/i18n/address";
import { useT } from "@/i18n/client";
import { cx } from "./ui";

/**
 * A property's address on two lines: "Njálsgata 23, íbúð 0201" over
 * "101 Reykjavík". A client component (useT), so it works in server and client
 * trees alike; it renders spans, so it fits inside headings, links and
 * paragraphs. For plain text (titles, metadata) use streetLine / placeLine /
 * addressText from "@/i18n/address" with getT or useT.
 */
export function PropertyAddress({
  address,
  unit,
  postalCode,
  className,
  placeClassName = "text-sm font-normal text-muted",
}: AddressParts & {
  /** Classes for the whole address. */
  className?: string;
  /** Classes for the second line ("101 Reykjavík"). */
  placeClassName?: string;
}) {
  const t = useT();
  return (
    <span className={cx("block wrap-anywhere", className)}>
      <span className="block">{streetLine(t, { address, unit })}</span>
      <span className={cx("block", placeClassName)}>{placeLine(postalCode)}</span>
    </span>
  );
}
