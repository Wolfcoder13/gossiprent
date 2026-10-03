import { createElement, type ComponentProps, type ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { RatingSummary } from "@/components/rating-summary";
import { StarInput } from "@/components/star-input";
import { RatingInline, Stars } from "@/components/stars";
import { I18nProvider } from "@/i18n/client";
import type { Locale } from "@/i18n/config";
import { createFormat } from "@/i18n/format";
import { MESSAGES } from "@/i18n/messages";
import type { RatingSummary as RatingSummaryData } from "@/lib/data";

/** Server-render `node` the way the root layout does: inside the visitor's language. */
function render(locale: Locale, node: ReactNode): string {
  const props = { locale, messages: MESSAGES[locale] } as ComponentProps<typeof I18nProvider>;
  return renderToStaticMarkup(createElement(I18nProvider, props, node));
}

/** The text a screen reader gets for a markup snippet (tags removed). */
const text = (html: string) => html.replace(/<[^>]+>/g, "");

const ariaLabels = (html: string) => [...html.matchAll(/aria-label="([^"]*)"/g)].map((match) => match[1]);

describe("format.rating", () => {
  it.each([
    [null, "—", "—"],
    [5, "5", "5"],
    [1, "1", "1"],
    [4.5, "4.5", "4,5"],
    [3.33, "3.3", "3,3"],
    [2.67, "2.7", "2,7"],
    [4.75, "4.8", "4,8"],
  ] as const)("rating(%s) is %j in English and %j in Icelandic", (input, english, icelandic) => {
    expect(createFormat("en").rating(input)).toBe(english);
    expect(createFormat("is").rating(input)).toBe(icelandic);
  });
});

describe("Stars", () => {
  it.each([
    ["en", 4, "Rated 4 out of 5 stars"],
    ["en", 2.5, "Rated 2.5 out of 5 stars"],
    ["is", 4.3, "Einkunn 4,3 af 5"],
    ["is", 1, "Einkunn 1 af 5"],
    ["en", null, "No ratings yet"],
    ["is", null, "Engin einkunn enn"],
  ] as const)("in %s, %s reads %j (never a plural of a decimal)", (locale, rating, label) => {
    expect(ariaLabels(render(locale, createElement(Stars, { rating })))).toEqual([label]);
  });

  it("fills the stars in proportion to the rating", () => {
    expect(render("en", createElement(Stars, { rating: 4.3 }))).toContain("width:86%");
    expect(render("en", createElement(Stars, { rating: null }))).toContain("width:0%");
  });
});

describe("RatingInline", () => {
  it("shows the average and the number of reviews", () => {
    expect(text(render("en", createElement(RatingInline, { average: 4.25, count: 12 })))).toBe("4.3 · 12 reviews");
    expect(text(render("en", createElement(RatingInline, { average: 3, count: 1 })))).toBe("3 · 1 review");
    expect(text(render("is", createElement(RatingInline, { average: 4.25, count: 21 })))).toBe("4,3 · 21 umsögn");
    expect(text(render("is", createElement(RatingInline, { average: 4, count: 1234 })))).toBe("4 · 1.234 umsagnir");
  });

  it("says when there are no reviews", () => {
    expect(text(render("en", createElement(RatingInline, { average: null, count: 0 })))).toBe("No reviews yet");
    expect(text(render("is", createElement(RatingInline, { average: null, count: 0 })))).toBe("Engar umsagnir enn");
  });
});

describe("RatingSummary", () => {
  const summary: RatingSummaryData = { average: 4.5, count: 2, distribution: [0, 0, 0, 1, 1] };

  it("shows the average, the count and a 5→1 breakdown", () => {
    const html = render("en", createElement(RatingSummary, { summary }));
    expect(html).toContain('aria-label="Rating breakdown"');
    const rows = [...html.matchAll(/<li[^>]*>(.*?)<\/li>/g)].map((match) => text(match[1]));
    expect(rows).toEqual(["5 stars1 review", "4 stars1 review", "3 stars0 reviews", "2 stars0 reviews", "1 star0 reviews"]);
    expect(text(html)).toContain("4.52 reviews");
  });

  it("speaks Icelandic", () => {
    const html = render("is", createElement(RatingSummary, { summary }));
    expect(html).toContain('aria-label="Skipting einkunna"');
    const rows = [...html.matchAll(/<li[^>]*>(.*?)<\/li>/g)].map((match) => text(match[1]));
    expect(rows[0]).toBe("5 stjörnur1 umsögn");
    expect(rows[4]).toBe("1 stjarna0 umsagnir");
    expect(text(html)).toContain("4,52 umsagnir");
  });
});

describe("StarInput", () => {
  it("labels each star with its meaning", () => {
    const english = text(render("en", createElement(StarInput, {})));
    for (const label of ["1 star (Terrible)", "2 stars (Poor)", "3 stars (Okay)", "4 stars (Good)", "5 stars (Excellent)"]) {
      expect(english).toContain(label);
    }
    expect(english).toContain("Your rating");
    expect(english).toContain("Tap a star");

    const icelandic = text(render("is", createElement(StarInput, {})));
    for (const label of ["1 stjarna (Mjög slæmt)", "2 stjörnur (Slæmt)", "3 stjörnur (Sæmilegt)", "4 stjörnur (Gott)", "5 stjörnur (Frábært)"]) {
      expect(icelandic).toContain(label);
    }
  });

  it("shows the meaning of the chosen rating", () => {
    expect(text(render("is", createElement(StarInput, { defaultValue: 5 })))).toMatch(/Frábært$/);
    expect(text(render("en", createElement(StarInput, { defaultValue: 1 })))).toMatch(/Terrible$/);
  });
});
