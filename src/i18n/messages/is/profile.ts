// Icelandic messages. Writing rules (see docs/iceland-spec.md §1):
// - Informal "þú". Buttons in the infinitive (Vista, Birta umsögn); instructions in the imperative.
// - Gender-neutral: role nouns (leigusali, leigjandi, aðili), "viðkomandi", impersonal or passive
//   voice. No participles about the reader or a subject (skráður/skráð, velkomin(n)).
// - Names and addresses only in nominative slots: headings, cards, after a colon, or as the subject.
//   Let a role noun carry any other case ("Hefur þú leigt af þessum leigusala?").
// - One whole sentence per role/kind variant; never build sentences from noun keys.
// - Plurals are { one, other } (Icelandic: 21 → one, 11 → other). „Gæsalappir“, "t.d.", decimal comma.
//
// A landlord's or renter's public page (/landlords/[id], /renters/[id]).
import type { Tree } from "../../types";

export default {
  /** {date} is a month and year ("október 2026"). */
  memberSince: "Á GossipRent síðan í {date}",
  cityMemberSince: "{city} · Á GossipRent síðan í {date}",
  /** A profile without an account: when the first review about them was written. */
  firstReviewed: "Fyrsta umsögn í {date}",
  identityNotVerified: "Auðkenni ekki staðfest",
  /**
   * On a profile without an account. True however the page came to be: a review,
   * a renter naming the landlord of a property, or a closed account. {signUp}
   * is the signUp link.
   */
  noAccountNote: {
    person:
      "Viðkomandi er ekki með aðgang að GossipRent og hefur ekki umsjón með þessari síðu. Aðrir gætu hafa slegið nafnið inn. Ert þetta þú? {signUp} til að taka yfir síðuna. Umsagnir sem aðrir skrifuðu um þig verða áfram á henni.",
    company:
      "Þetta fyrirtæki er ekki með aðgang að GossipRent og hefur ekki umsjón með þessari síðu. Aðrir gætu hafa slegið nafnið inn.",
  },
  signUp: "Stofnaðu aðgang með kennitölunni þinni",
  report: "Tilkynna þessa síðu",
  /** Links between the landlord and renter pages of someone with both roles. */
  tabs: {
    label: "Einkunnir eftir hlutverki",
    landlord: "Sem leigusali",
    renter: "Sem leigjandi",
    /** Read by screen readers after the average ("4,3 af 5"); never pluralize a decimal. */
    outOf: " af 5",
    noReviews: "(engar umsagnir)",
  },
  /** Above the rating summary of someone with both roles. The name comes first (nominative). */
  ratingHeading: {
    landlord: "{name}: einkunn sem leigusali",
    renter: "{name}: einkunn sem leigjandi",
  },
  /** Small screens: jumps to the review form. */
  reviewButton: "Skrifa umsögn: {name}",
  editButton: "Breyta umsögninni þinni",
  properties: {
    heading: "Eignir",
    showing: { one: "Hér sjást {shown} af {count} eign.", other: "Hér sjást {shown} af {count} eignum." },
    empty: "Engar eignir skráðar enn",
  },
  reviews: {
    /** For someone with both roles; otherwise the heading is just "Umsagnir". */
    heading: {
      landlord: "Umsagnir sem leigusali",
      renter: "Umsagnir sem leigjandi",
    },
    intro: {
      landlord: "{name} í augum leigjenda.",
      renter: "{name} í augum leigusala.",
    },
    empty: {
      landlord: "{name} hefur enn ekki fengið umsögn sem leigusali",
      renter: "{name} hefur enn ekki fengið umsögn sem leigjandi",
    },
    emptySelf: {
      landlord: "Umsagnir leigjenda um þig birtast hér.",
      renter: "Umsagnir leigusala um þig birtast hér.",
    },
    emptyOther: "Skrifaðu fyrstu umsögnina.",
  },
  /** In the review box, on your own page. */
  ownerNote: {
    landlord: "Þetta er opinbera síðan þín. Umsagnir leigjenda birtast hér. Ekki er hægt að skrifa umsögn um eigin aðgang.",
    renter: "Þetta er opinbera síðan þín. Umsagnir leigusala birtast hér. Ekki er hægt að skrifa umsögn um eigin aðgang.",
  },
} as const satisfies Tree;
