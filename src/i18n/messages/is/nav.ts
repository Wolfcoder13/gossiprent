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
  skipToContent: "Fara beint í efni",
  /** Accessible name of the header's navigation landmark. */
  main: "Aðalvalmynd",
  landlords: "Leigusalar",
  renters: "Leigjendur",
  properties: "Eignir",
  writeReview: "Skrifa umsögn",
  myAccount: "Mínar síður",
  logIn: "Skrá inn",
  logOut: "Skrá út",
  signUp: "Nýskráning",
  privacy: "Persónuvernd",
  copyright: "© {year} GossipRent.",
  disclaimer: "Umsagnir lýsa skoðunum höfunda sinna. Ekki er gengið úr skugga um hver fólk er.",
} as const satisfies Tree;
