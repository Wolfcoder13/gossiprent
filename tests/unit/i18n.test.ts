/**
 * The language system: translate (plurals, placeholders, rich text), locale
 * formatting, the dictionaries' Icelandic/English parity, reading the
 * language cookie, and the language switch's Server Action.
 */
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

/** The fake request: its cookie jar (with the options each cookie was set with), headers and URL. */
const request = vi.hoisted(() => ({
  cookies: new Map<string, { value: string; options?: Record<string, unknown> }>(),
  headers: new Headers(),
  pathname: "/",
  search: "",
}));

vi.mock("next/headers", () => ({
  headers: async () => request.headers,
  cookies: async () => ({
    get: (name: string) => {
      const cookie = request.cookies.get(name);
      return cookie && { name, value: cookie.value };
    },
    set: (name: string, value: string, options?: Record<string, unknown>) => {
      request.cookies.set(name, { value, options });
    },
  }),
}));

class RedirectSignal extends Error {
  constructor(
    readonly url: string,
    readonly type: string | undefined,
  ) {
    super(`redirect to ${url}`);
  }
}

vi.mock("next/navigation", () => ({
  RedirectType: { push: "push", replace: "replace" },
  redirect: (url: string, type?: string) => {
    throw new RedirectSignal(url, type);
  },
  usePathname: () => request.pathname,
  useSearchParams: () => new URLSearchParams(request.search),
}));

import { setLocale } from "@/app/actions/locale";
import { EnglishHint } from "@/components/language-switch";
import { prefersIcelandic } from "@/i18n/accept-language";
import { addressText, placeLine, streetLine } from "@/i18n/address";
import { LOCALE_COOKIE } from "@/i18n/config";
import { createFormat } from "@/i18n/format";
import { MESSAGES } from "@/i18n/messages";
import { getLocale, getT, shouldOfferEnglish } from "@/i18n/server";
import { createT } from "@/i18n/translate";
import type { Plural, Tree } from "@/i18n/types";

beforeEach(() => {
  request.cookies = new Map();
  request.headers = new Headers();
  request.pathname = "/";
  request.search = "";
});

// A small dictionary of its own, so these tests don't depend on the site's wording.
const TEST_MESSAGES = {
  greeting: "Hello {name}",
  reviews: { one: "{count} review by {name}", other: "{count} reviews by {name}" },
  signup: "Read the {terms} first.",
  nested: { deep: { leaf: "Leaf" } },
} as const;

describe("createT", () => {
  const is = createT(MESSAGES.is, "is");
  const en = createT(MESSAGES.en, "en");

  it.each([
    [1, "1 umsögn"],
    [2, "2 umsagnir"],
    [11, "11 umsagnir"],
    [21, "21 umsögn"],
    [111, "111 umsagnir"],
  ])("picks the Icelandic plural for %i (21 is singular, 11 and 111 aren't)", (count, expected) => {
    expect(is("common.rating.reviewCount", { count })).toBe(expected);
  });

  it.each([
    [1, "1 review"],
    [2, "2 reviews"],
  ])("picks the English plural for %i", (count, expected) => {
    expect(en("common.rating.reviewCount", { count })).toBe(expected);
  });

  it("fills placeholders, formatting numbers for the locale", () => {
    const t = createT(TEST_MESSAGES, "is");
    expect(t("greeting", { name: "Sigrún" })).toBe("Hello Sigrún");
    expect(t("reviews", { count: 12345, name: "Kári" })).toBe("12.345 reviews by Kári");
    expect(createT(TEST_MESSAGES, "en")("reviews", { count: 12345, name: "Kári" })).toBe("12,345 reviews by Kári");
    expect(en("common.pagination.status", { page: 2, pageCount: 3 })).toBe("Page 2 of 3");
  });

  it("leaves strings passed as params alone (e.g. a year, which as a number would read 2.026)", () => {
    expect(is("nav.copyright", { year: "2026" })).toBe("© 2026 GossipRent.");
  });

  it("rich() puts React nodes into a sentence", () => {
    const t = createT(TEST_MESSAGES, "en");
    const link = createElement("a", { href: "/terms" }, "terms");
    expect(renderToStaticMarkup(t.rich("signup", { terms: link }))).toBe('Read the <a href="/terms">terms</a> first.');
    expect(renderToStaticMarkup(t.rich("reviews", { count: 2, name: createElement("b", null, "Ása") }))).toBe(
      "2 reviews by <b>Ása</b>",
    );
  });

  it("has() is true only for messages (strings and plurals), not for areas or unknown keys", () => {
    const t = createT(TEST_MESSAGES, "en");
    expect(t.has("greeting")).toBe(true);
    expect(t.has("reviews")).toBe(true);
    expect(t.has("nested.deep.leaf")).toBe(true);
    expect(t.has("nested.deep")).toBe(false);
    expect(t.has("nested.missing")).toBe(false);
    expect(t.has("Invalid input: expected string")).toBe(false);
  });

  it("throws on a missing key outside production", () => {
    const t = createT(TEST_MESSAGES, "en") as unknown as (key: string) => string;
    expect(() => t("nested.missing")).toThrow('Missing message "nested.missing"');
  });
});

describe("createFormat", () => {
  const is = createFormat("is");
  const en = createFormat("en");

  it("formats numbers", () => {
    expect(is.number(12345)).toBe("12.345");
    expect(en.number(12345)).toBe("12,345");
  });

  it("formats an average rating to one decimal, with a decimal comma in Icelandic", () => {
    expect(is.rating(4.3)).toBe("4,3");
    expect(en.rating(4.3)).toBe("4.3");
    expect(is.rating(4.75)).toBe("4,8");
    expect(is.rating(5)).toBe("5");
    expect(is.rating(null)).toBe("—");
  });

  it("formats dates in Iceland's time zone", () => {
    const date = new Date("2026-10-03T12:00:00Z");
    expect(is.date(date)).toBe("3. okt. 2026");
    expect(en.date(date)).toBe("3 Oct 2026");
    // Late on Dec 31 UTC is still Dec 31 in Reykjavík, whatever the server's time zone.
    expect(is.date(new Date("2025-12-31T23:30:00Z"))).toBe("31. des. 2025");
    expect(is.monthYear(date)).toBe("október 2026");
    expect(en.monthYear(date)).toBe("October 2026");
  });

  it("joins lists", () => {
    expect(is.list(["Reykjavík", "Kópavogur", "Akureyri"])).toBe("Reykjavík, Kópavogur og Akureyri");
    expect(en.list(["Reykjavík", "Kópavogur", "Akureyri"])).toBe("Reykjavík, Kópavogur and Akureyri");
  });
});

describe("addresses", () => {
  const is = createT(MESSAGES.is, "is");
  const en = createT(MESSAGES.en, "en");

  it("prefixes an apartment number with “íbúð” / “apt.” and shows other units as typed", () => {
    expect(streetLine(is, { address: "Njálsgata 23", unit: "0201" })).toBe("Njálsgata 23, íbúð 0201");
    expect(streetLine(en, { address: "Njálsgata 23", unit: "0201" })).toBe("Njálsgata 23, apt. 0201");
    expect(streetLine(is, { address: "Hamraborg 14", unit: "503" })).toBe("Hamraborg 14, íbúð 503");
    expect(streetLine(en, { address: "Laugavegur 5", unit: "2. hæð til vinstri" })).toBe(
      "Laugavegur 5, 2. hæð til vinstri",
    );
    expect(streetLine(is, { address: "Laugavegur 5", unit: "kjallari" })).toBe("Laugavegur 5, kjallari");
    expect(streetLine(en, { address: "Laugavegur 5", unit: "12345" })).toBe("Laugavegur 5, 12345");
    expect(streetLine(is, { address: "Hringbraut 79", unit: null })).toBe("Hringbraut 79");
  });

  // The property form stores "íbúð 3", "apt. 2B" and "#B" as "3", "2B" and "B"
  // (normalizeUnit): the prefix comes back, so they never read like a house number.
  it.each([
    ["3", "Hringbraut 79, íbúð 3", "Hringbraut 79, apt. 3"],
    ["12", "Hringbraut 79, íbúð 12", "Hringbraut 79, apt. 12"],
    ["2B", "Hringbraut 79, íbúð 2B", "Hringbraut 79, apt. 2B"],
    ["0201a", "Hringbraut 79, íbúð 0201a", "Hringbraut 79, apt. 0201a"],
    ["B", "Hringbraut 79, íbúð B", "Hringbraut 79, apt. B"],
  ])("prefixes the short apartment number %j too", (unit, icelandic, english) => {
    expect(streetLine(is, { address: "Hringbraut 79", unit })).toBe(icelandic);
    expect(streetLine(en, { address: "Hringbraut 79", unit })).toBe(english);
  });

  it.each([["2B3"], ["AB"], ["2. hæð"], ["3 t.v."]])("shows %j as typed", (unit) => {
    expect(streetLine(is, { address: "Hringbraut 79", unit })).toBe(`Hringbraut 79, ${unit}`);
    expect(streetLine(en, { address: "Hringbraut 79", unit })).toBe(`Hringbraut 79, ${unit}`);
  });

  it("shows the postcode with its place", () => {
    expect(placeLine(101)).toBe("101 Reykjavík");
    expect(placeLine(600)).toBe("600 Akureyri");
    expect(addressText(is, { address: "Njálsgata 23", unit: "0201", postalCode: 101 })).toBe(
      "Njálsgata 23, íbúð 0201, 101 Reykjavík",
    );
  });
});

describe("no-account notes on a profile", () => {
  const is = createT(MESSAGES.is, "is");
  const en = createT(MESSAGES.en, "en");

  // A page without an account comes from a review, from a renter naming the
  // landlord of a property, or from a closed account: the note is true for all.
  it("don't say how the page came to be, only that nobody with an account manages it", () => {
    expect(en("profile.noAccountNote.company")).toBe(
      "This company doesn't have a GossipRent account and doesn't manage this page. The name may have been entered by someone else.",
    );
    expect(is("profile.noAccountNote.company")).toBe(
      "Þetta fyrirtæki er ekki með aðgang að GossipRent og hefur ekki umsjón með þessari síðu. Aðrir gætu hafa slegið nafnið inn.",
    );
    const signUp = createElement("a", { href: "/signup" }, "SIGN UP");
    expect(renderToStaticMarkup(en.rich("profile.noAccountNote.person", { signUp }))).toBe(
      "This person doesn&#x27;t have a GossipRent account and doesn&#x27;t manage this page. The name may have been entered by someone else. Is this you? <a href=\"/signup\">SIGN UP</a> to take over the page. Reviews others wrote about you stay on it.",
    );
    expect(renderToStaticMarkup(is.rich("profile.noAccountNote.person", { signUp }))).toBe(
      "Viðkomandi er ekki með aðgang að GossipRent og hefur ekki umsjón með þessari síðu. Aðrir gætu hafa slegið nafnið inn. Ert þetta þú? <a href=\"/signup\">SIGN UP</a> til að taka yfir síðuna. Umsagnir sem aðrir skrifuðu um þig verða áfram á henni.",
    );
    for (const messages of [MESSAGES.en, MESSAGES.is]) {
      for (const note of Object.values(messages.profile.noAccountNote)) {
        expect(note).not.toMatch(/review was written|umsögnin var skrifuð|its author|höfundur/);
      }
    }
  });
});

describe("dictionaries", () => {
  type Leaf = { key: string; value: string | Plural };

  function isPlural(value: unknown): value is Plural {
    return typeof value === "object" && value !== null && "one" in value && "other" in value;
  }

  /** Every message in a dictionary, with its dot-separated key. */
  function leaves(tree: Tree, prefix = ""): Leaf[] {
    return Object.entries(tree).flatMap(([name, value]) =>
      typeof value === "string" || isPlural(value)
        ? [{ key: `${prefix}${name}`, value }]
        : leaves(value, `${prefix}${name}.`),
    );
  }

  const placeholders = (text: string) => [...text.matchAll(/\{(\w+)\}/g)].map((match) => match[1]).sort();
  const texts = (value: string | Plural) => (typeof value === "string" ? [value] : [value.one, value.other]);

  const is = leaves(MESSAGES.is);
  const en = new Map(leaves(MESSAGES.en).map((leaf) => [leaf.key, leaf.value]));

  it("cover every area", () => {
    expect(Object.keys(MESSAGES.en)).toEqual(Object.keys(MESSAGES.is));
  });

  it("have the same keys in Icelandic and English", () => {
    expect([...en.keys()].sort()).toEqual(is.map((leaf) => leaf.key).sort());
  });

  it.each(is.map((leaf) => [leaf.key, leaf.value] as const))(
    "%s: same kind, same placeholders and no empty text in both languages",
    (key, isValue) => {
      const enValue = en.get(key)!;
      expect(isPlural(enValue), "plural in one language only").toBe(isPlural(isValue));
      for (const text of [...texts(isValue), ...texts(enValue)]) expect(text.trim()).not.toBe("");
      const isHoles = new Set(texts(isValue).flatMap(placeholders));
      const enHoles = new Set(texts(enValue).flatMap(placeholders));
      expect([...enHoles].sort()).toEqual([...isHoles].sort());
    },
  );
});

describe("getLocale", () => {
  it.each([
    ["no cookie", undefined, "is"],
    ["English", "en", "en"],
    ["Icelandic", "is", "is"],
    ["an unknown language", "de", "is"],
    ["an empty value", "", "is"],
    ["a different case", "EN", "is"],
  ])("with %s, is %j", async (_label, cookie, expected) => {
    if (cookie !== undefined) request.cookies.set(LOCALE_COOKIE, { value: cookie });
    expect(await getLocale()).toBe(expected);
  });

  it("drives getT", async () => {
    expect((await getT())("nav.logIn")).toBe("Skrá inn");
    request.cookies.set(LOCALE_COOKIE, { value: "en" });
    expect((await getT())("nav.logIn")).toBe("Log in");
  });
});

describe("offering English", () => {
  it.each([
    ["is-IS,is;q=0.9,en;q=0.8", true],
    ["is", true],
    ["IS-is", true],
    ["en;q=0.5, is", true],
    ["en-GB,en;q=0.9,is;q=0.8", false],
    ["en-US", false],
    ["isl", false],
    ["*", false],
    ["is;q=0, en", false],
    ["", false],
  ])("prefersIcelandic(%j) is %s", (header, expected) => {
    expect(prefersIcelandic(header)).toBe(expected);
  });

  it("happens when there's no language cookie and the browser doesn't prefer Icelandic", async () => {
    request.headers = new Headers({ "accept-language": "en-GB,en;q=0.9" });
    expect(await shouldOfferEnglish()).toBe(true);
    request.headers = new Headers();
    expect(await shouldOfferEnglish()).toBe(true);
  });

  it("doesn't happen for an Icelandic browser or once a language was picked", async () => {
    request.headers = new Headers({ "accept-language": "is-IS,en;q=0.5" });
    expect(await shouldOfferEnglish()).toBe(false);

    request.headers = new Headers({ "accept-language": "en-GB" });
    request.cookies.set(LOCALE_COOKIE, { value: "is" });
    expect(await shouldOfferEnglish()).toBe(false);
    request.cookies.set(LOCALE_COOKIE, { value: "nonsense" });
    expect(await shouldOfferEnglish()).toBe(true);
  });
});

describe("EnglishHint", () => {
  /** The hint's buttons: [locale value, lang attribute, text]. */
  function buttons(): string[][] {
    const html = renderToStaticMarkup(createElement(EnglishHint));
    return [...html.matchAll(/<button([^>]*)>([^<]*)<\/button>/g)].map(([, attributes, label]) => [
      /value="([^"]*)"/.exec(attributes)?.[1] ?? "",
      /lang="([^"]*)"/.exec(attributes)?.[1] ?? "",
      label,
    ]);
  }

  it("offers English, and staying in Icelandic (in Icelandic), so the line can be dismissed either way", () => {
    expect(buttons()).toEqual([
      ["en", "en", "Switch to English"],
      ["is", "is", "Halda áfram á íslensku"],
    ]);
  });

  it("comes back to the same page and query with either button", () => {
    request.pathname = "/landlords";
    request.search = "q=K%C3%B3pavogur&page=2";
    const html = renderToStaticMarkup(createElement(EnglishHint));
    const next = [...html.matchAll(/name="next" value="([^"]*)"/g)].map((match) => match[1]);
    expect(next).toEqual(["/landlords?q=K%C3%B3pavogur&amp;page=2", "/landlords?q=K%C3%B3pavogur&amp;page=2"]);
  });

  it("goes away for good once Icelandic is chosen, on the same page", async () => {
    request.headers = new Headers({ "accept-language": "en-GB,en;q=0.9" });
    expect(await shouldOfferEnglish()).toBe(true);
    const data = new FormData();
    data.set("locale", "is");
    data.set("next", "/renters?q=J%C3%B3n");
    const redirect = await setLocale(data).then(
      () => undefined,
      (thrown: unknown) => thrown,
    );
    expect(redirect).toMatchObject({ url: "/renters?q=J%C3%B3n", type: "replace" });
    expect(request.cookies.get(LOCALE_COOKIE)?.value).toBe("is");
    expect(await shouldOfferEnglish()).toBe(false);
    expect(await getLocale()).toBe("is");
  });
});

describe("setLocale", () => {
  function form(fields: Record<string, string>): FormData {
    const data = new FormData();
    for (const [key, value] of Object.entries(fields)) data.set(key, value);
    return data;
  }

  /** Run the action and return where it redirected to. */
  async function submit(fields: Record<string, string>): Promise<RedirectSignal> {
    const error = await setLocale(form(fields)).then(
      () => undefined,
      (thrown: unknown) => thrown,
    );
    expect(error).toBeInstanceOf(RedirectSignal);
    return error as RedirectSignal;
  }

  it("remembers the language for a year in an httpOnly, SameSite=Lax cookie", async () => {
    await submit({ locale: "en", next: "/" });
    expect(request.cookies.get(LOCALE_COOKIE)).toEqual({
      value: "en",
      options: { httpOnly: true, secure: false, sameSite: "lax", path: "/", maxAge: 60 * 60 * 24 * 365 },
    });
    await submit({ locale: "is", next: "/" });
    expect(request.cookies.get(LOCALE_COOKIE)?.value).toBe("is");
  });

  it("goes back to the same page and query, replacing the history entry", async () => {
    const redirect = await submit({ locale: "en", next: "/landlords?q=K%C3%B3pavogur&page=2" });
    expect(redirect.url).toBe("/landlords?q=K%C3%B3pavogur&page=2");
    expect(redirect.type).toBe("replace");
  });

  it.each([["//evil.example"], ["https://evil.example/"], ["/\\evil.example"], [""]])(
    "never redirects off the site (next = %j)",
    async (next) => {
      expect((await submit({ locale: "en", next })).url).toBe("/");
    },
  );

  it("goes home when there's no next", async () => {
    expect((await submit({ locale: "en" })).url).toBe("/");
  });

  it("ignores an unknown language, but still goes back", async () => {
    const redirect = await submit({ locale: "de", next: "/renters" });
    expect(request.cookies.has(LOCALE_COOKIE)).toBe(false);
    expect(redirect.url).toBe("/renters");
  });
});
