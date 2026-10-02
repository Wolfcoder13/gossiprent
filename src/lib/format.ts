const dateFormat = new Intl.DateTimeFormat("en-US", {
  month: "short",
  day: "numeric",
  year: "numeric",
  timeZone: "UTC",
});

const monthYearFormat = new Intl.DateTimeFormat("en-US", {
  month: "long",
  year: "numeric",
  timeZone: "UTC",
});

/** "Mar 4, 2026" */
export function formatDate(date: Date): string {
  return dateFormat.format(date);
}

/** "March 2026" */
export function formatMonthYear(date: Date): string {
  return monthYearFormat.format(date);
}

/** "1 review", "3 reviews" */
export function plural(count: number, singular: string, pluralForm = `${singular}s`): string {
  return `${count.toLocaleString("en-US")} ${count === 1 ? singular : pluralForm}`;
}
