// Icelandic messages. Writing rules (see docs/iceland-spec.md §1):
// - Informal "þú". Buttons in the infinitive (Vista, Birta umsögn); instructions in the imperative.
// - Gender-neutral: role nouns (leigusali, leigjandi, aðili), "viðkomandi", impersonal or passive
//   voice. No participles about the reader or a subject (skráður/skráð, velkomin(n)).
// - Names and addresses only in nominative slots: headings, cards, after a colon, or as the subject.
//   Let a role noun carry any other case ("Hefur þú leigt af þessum leigusala?").
// - One whole sentence per role/kind variant; never build sentences from noun keys.
// - Plurals are { one, other } (Icelandic: 21 → one, 11 → other). „Gæsalappir“, "t.d.", decimal comma.
//
// The home page (src/app/page.tsx).
import type { Tree } from "../../types";

export default {
  /** After closing an account (/?account=deleted). */
  accountClosed: "Aðganginum þínum hefur verið lokað og umsögnunum sem þú skrifaðir hefur verið eytt.",
  hero: {
    eyebrow: "Umsagnir um leigusala og leigjendur",
    title: "Leigðu með opin augun.",
    intro:
      "Leigjendur skrifa umsagnir um leigusala sína og eignirnar sem þeir búa í. Leigusalar skrifa umsagnir um leigjendur sína. Stjörnugjöf og heiðarlegar, skriflegar umsagnir, svo fólk viti við hvern það er að eiga.",
  },
  search: {
    /** Accessible name of the search box. */
    label: "Leita að leigusölum, leigjendum og eignum",
    placeholder: "Nafn, heimilisfang eða póstnúmer",
    button: "Leita",
  },
  /** Labels of the four numbers under the search box (column headings, so always plural). */
  stats: {
    reviews: "Umsagnir",
    landlords: "Leigusalar",
    renters: "Leigjendur",
    properties: "Eignir",
  },
  paths: {
    /** Screen-reader heading of the three cards. */
    heading: "Um hvað er hægt að skrifa umsögn",
    forRenters: "Fyrir leigjendur",
    forLandlords: "Fyrir leigusala",
    landlord: {
      title: "Skrifaðu umsögn um leigusalann þinn",
      body: "Var fljótt gert við það sem bilaði? Fékkstu trygginguna til baka? Hjálpaðu næsta leigjanda að vita hvað bíður.",
      cta: "Finna leigusala",
    },
    property: {
      title: "Skrifaðu umsögn um eignina sem þú leigir",
      body: "Kynding, raki eða mygla, hávaði, þvottahús, nágrannar: segðu frá því hvernig er í raun að búa þar.",
      cta: "Finna eign",
    },
    renter: {
      title: "Skrifaðu umsögn um leigjendur þína",
      body: "Umgengni um heimilið, samskipti og tillitssemi við nágranna: hrósaðu góðum leigjendum og segðu frá því sem fór úrskeiðis.",
      cta: "Finna leigjanda",
    },
  },
  latest: {
    heading: "Nýjustu umsagnir",
    emptyTitle: "Engar umsagnir enn",
    emptyBody: "Þegar fólk fer að skrifa umsagnir um leigusala, leigjendur og eignir birtast þær nýjustu hér.",
    /** Button to /signup in the empty state, for visitors who aren't logged in. */
    emptyAction: "Nýskráning: skrifaðu fyrstu umsögnina",
  },
  /** The closing call to action, for visitors who aren't logged in. */
  cta: {
    title: "Hefur þú haft leigusala eða leigjanda sem vert er að segja frá?",
    body: "Stofnaðu ókeypis aðgang sem leigjandi eða leigusali og skrifaðu fyrstu umsögnina á örfáum mínútum.",
    renter: "Ég er leigjandi",
    landlord: "Ég er leigusali",
  },
} as const satisfies Tree;
