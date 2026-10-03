// Icelandic messages. Writing rules (see docs/iceland-spec.md §1):
// - Informal "þú". Buttons in the infinitive (Vista, Birta umsögn); instructions in the imperative.
// - Gender-neutral: role nouns (leigusali, leigjandi, aðili), "viðkomandi", impersonal or passive
//   voice. No participles about the reader or a subject (skráður/skráð, velkomin(n)).
// - Names and addresses only in nominative slots: headings, cards, after a colon, or as the subject.
//   Let a role noun carry any other case ("Hefur þú leigt af þessum leigusala?").
// - One whole sentence per role/kind variant; never build sentences from noun keys.
// - Plurals are { one, other } (Icelandic: 21 → one, 11 → other). „Gæsalappir“, "t.d.", decimal comma.
import type { Tree } from "../../types";

export default {
  /** After an optional field's label. */
  optional: "(valfrjálst)",
  roles: {
    landlord: "Leigusali",
    renter: "Leigjandi",
    property: "Eign",
  },
  /** Badge on a profile whose person (or company) has no GossipRent account. */
  noAccount: "Án aðgangs",
  kennitala: {
    hint: "10 tölustafir, t.d. 123456-7890",
  },
  rating: {
    /** A rating is a decimal: never pluralize it. */
    stars: "Einkunn {rating} af 5",
    none: "Engin einkunn enn",
    reviewCount: { one: "{count} umsögn", other: "{count} umsagnir" },
    noReviews: "Engar umsagnir enn",
    breakdown: "Skipting einkunna",
    starCount: { one: "{count} stjarna", other: "{count} stjörnur" },
    /** Screen-reader unit after a number shown on its own ("3" → "3 umsagnir"). */
    reviewsUnit: { one: "umsögn", other: "umsagnir" },
  },
  starInput: {
    legend: "Einkunnin þín",
    hint: "Veldu stjörnu",
    option: { one: "{count} stjarna ({label})", other: "{count} stjörnur ({label})" },
    terrible: "Mjög slæmt",
    poor: "Slæmt",
    okay: "Sæmilegt",
    good: "Gott",
    excellent: "Frábært",
  },
  pagination: {
    label: "Síður",
    previous: "← Fyrri",
    next: "Næsta →",
    status: "Síða {page} af {pageCount}",
  },
  deleteReview: {
    button: "Eyða",
    pending: "Eyðir…",
    confirm: "Eyða þessari umsögn? Það er ekki hægt að afturkalla það.",
  },
  address: {
    /** An apartment number, e.g. 0201 (2. hæð, íbúð 01), 3, 2B or B. */
    apartment: "{address}, íbúð {unit}",
    /** Any other unit, as typed ("2. hæð til vinstri"). */
    unit: "{address}, {unit}",
  },
} as const satisfies Tree;
