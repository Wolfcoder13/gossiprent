// Icelandic messages. Writing rules (see docs/iceland-spec.md §1):
// - Informal "þú". Buttons in the infinitive (Vista, Birta umsögn); instructions in the imperative.
// - Gender-neutral: role nouns (leigusali, leigjandi, aðili), "viðkomandi", impersonal or passive
//   voice. No participles about the reader or a subject (skráður/skráð, velkomin(n)).
// - Names and addresses only in nominative slots: headings, cards, after a colon, or as the subject.
//   Let a role noun carry any other case ("Hefur þú leigt af þessum leigusala?").
// - One whole sentence per role/kind variant; never build sentences from noun keys.
// - Plurals are { one, other } (Icelandic: 21 → one, 11 → other). „Gæsalappir“, "t.d.", decimal comma.
//
// "Look up a kennitala" (home page and /search) and its Server Action. Never put the number in a message.
import type { Tree } from "../../types";

export default {
  heading: "Fletta upp kennitölu",
  intro: "Finndu síðu eftir kennitölu, líka þegar fleiri bera sama nafn. Kennitalan sjálf birtist hvergi.",
  /** Under the form for visitors who aren't logged in; {logIn} is a link with the text below. */
  loggedOutHint: "Þú þarft að {logIn} til að fletta upp kennitölu.",
  logInLink: "skrá þig inn",
  field: "Kennitala",
  submit: "Fletta upp",
  pending: "Flettir upp…",
  /** The action's answer to a visitor who isn't logged in (with a "Skrá inn" link). */
  logInRequired: "Skráðu þig inn til að fletta upp kennitölu.",
  logIn: "Skrá inn",
  notFound: "Engin umsögn hefur enn verið skrifuð um þessa kennitölu.",
  writeFirst: "Skrifa fyrstu umsögnina",
  /** Shown when a kennitala was typed into a search box (/search?kt=1, or by the search box itself). */
  useFormBelow: "Notaðu formið hér fyrir neðan til að fletta upp kennitölu.",
} as const satisfies Tree;
