// Icelandic messages. Writing rules (see docs/iceland-spec.md §1):
// - Informal "þú". Buttons in the infinitive (Vista, Birta umsögn); instructions in the imperative.
// - Gender-neutral: role nouns (leigusali, leigjandi, aðili), "viðkomandi", impersonal or passive
//   voice. No participles about the reader or a subject (skráður/skráð, velkomin(n)).
// - Names and addresses only in nominative slots: headings, cards, after a colon, or as the subject.
//   Let a role noun carry any other case ("Hefur þú leigt af þessum leigusala?").
// - One whole sentence per role/kind variant; never build sentences from noun keys.
// - Plurals are { one, other } (Icelandic: 21 → one, 11 → other). „Gæsalappir“, "t.d.", decimal comma.
//
// Page titles and descriptions (generateMetadata). The root layout adds " · GossipRent".
import type { Tree } from "../../types";

export default {
  /** The home page's title, and the default for pages without one. */
  title: "GossipRent — umsagnir um leigusala og leigjendur",
  description:
    "Leigjendur skrifa umsagnir um leigusala sína og eignirnar sem þeir hafa búið í. Leigusalar skrifa umsagnir um leigjendur sína. Stjörnugjöf og heiðarlegar, skriflegar umsagnir.",
  pages: {
    landlords: "Leigusalar",
    renters: "Leigjendur",
    properties: "Eignir",
    search: "Leit",
    login: "Innskráning",
    signup: "Nýskráning",
    dashboard: "Mínar síður",
    newProperty: "Skrá eign",
    newReview: "Skrifa umsögn",
    report: "Tilkynna vandamál",
    privacy: "Persónuvernd",
  },
  landlordProfile: {
    title: "{name} (leigusali) — umsagnir",
    description: "{name} er leigusali á GossipRent. Hér eru umsagnir leigjenda.",
    notFound: "Leigusali fannst ekki",
  },
  renterProfile: {
    title: "{name} (leigjandi) — umsagnir",
    description: "{name} er leigjandi á GossipRent. Hér eru umsagnir leigusala.",
    notFound: "Leigjandi fannst ekki",
  },
  property: {
    title: "{address} — umsagnir",
    description: "Umsagnir leigjenda: {address}.",
    notFound: "Eign fannst ekki",
  },
} as const satisfies Tree;
