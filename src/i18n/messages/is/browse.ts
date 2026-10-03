// Icelandic messages. Writing rules (see docs/iceland-spec.md §1):
// - Informal "þú". Buttons in the infinitive (Vista, Birta umsögn); instructions in the imperative.
// - Gender-neutral: role nouns (leigusali, leigjandi, aðili), "viðkomandi", impersonal or passive
//   voice. No participles about the reader or a subject (skráður/skráð, velkomin(n)).
// - Names and addresses only in nominative slots: headings, cards, after a colon, or as the subject.
//   Let a role noun carry any other case ("Hefur þú leigt af þessum leigusala?").
// - One whole sentence per role/kind variant; never build sentences from noun keys.
// - Plurals are { one, other } (Icelandic: 21 → one, 11 → other). „Gæsalappir“, "t.d.", decimal comma.
//
// Directories (/landlords, /renters; the filters also on /properties), cards, and /search.
// {query} is what the visitor searched for, always inside „…“ (a quoted search, not a name).
import type { Tree } from "../../types";

export default {
  /** The directory filter bar. */
  filters: {
    /** Screen-reader label of the search box. */
    label: "Leita",
    button: "Leita",
    sortLabel: "Raða eftir",
    clear: "Hreinsa leit",
  },
  sort: {
    top: "Hæsta einkunn",
    most: "Flestar umsagnir",
    newest: "Nýjast",
    /** Icelandic alphabetical order (Þ, Æ and Ö come last). */
    name: "A–Ö",
  },
  landlords: {
    title: "Leigusalar",
    description: "Sjáðu hvaða einkunnir leigusalar fá frá fólki sem hefur leigt af þeim.",
    placeholder: "Leita að leigusala eftir nafni eða stað",
    count: { one: "{count} leigusali", other: "{count} leigusalar" },
    countMatching: {
      one: "{count} leigusali passar við „{query}“",
      other: "{count} leigusalar passa við „{query}“",
    },
    noneMatching: "Enginn leigusali passar við „{query}“",
    none: "Engir leigusalar enn",
    empty: "Hér birtast leigusalar sem hafa stofnað aðgang eða fengið umsögn.",
    notListed:
      "Ef leigusalinn þinn er ekki enn á GossipRent getur þú skrifað fyrstu umsögnina með kennitölu viðkomandi, eða skrifað umsögn um eignina sem þú leigðir.",
  },
  renters: {
    title: "Leigjendur",
    description: "Sjáðu hvaða einkunnir leigjendur fá frá leigusölum sínum.",
    placeholder: "Leita að leigjanda eftir nafni eða stað",
    count: { one: "{count} leigjandi", other: "{count} leigjendur" },
    countMatching: {
      one: "{count} leigjandi passar við „{query}“",
      other: "{count} leigjendur passa við „{query}“",
    },
    noneMatching: "Enginn leigjandi passar við „{query}“",
    none: "Engir leigjendur enn",
    empty: "Hér birtast leigjendur sem hafa stofnað aðgang eða fengið umsögn.",
    notListed: "Ef leigjandinn þinn er ekki enn á GossipRent getur þú skrifað fyrstu umsögnina með kennitölu viðkomandi.",
  },
  tryAgain: "Prófaðu annað nafn eða annan stað.",
  writeReview: "Skrifa umsögn",
  reviewPropertyInstead: "Skrifa frekar umsögn um eignina",
  /** Person and property cards. */
  card: {
    properties: { one: "{count} eign", other: "{count} eignir" },
    /** A landlord card when no properties are linked to them. */
    noProperties: "Engar eignir enn",
    alsoRenter: "Einnig leigjandi",
    alsoLandlord: "Einnig leigusali",
    landlord: "Leigusali: {name}",
    /** The landlord was named by a renter and has no account (so hasn't confirmed it). */
    landlordUnconfirmed: "Leigusali: {name} (ekki staðfest)",
    noLandlord: "Leigusali er ekki enn á GossipRent",
  },
  /** /search */
  results: {
    title: "Leit",
    description: "Finndu leigusala, leigjendur og eignir eftir nafni, heimilisfangi, póstnúmeri eða stað.",
    label: "Leita",
    placeholder: "Nafn, heimilisfang eða póstnúmer",
    button: "Leita",
    heading: "Niðurstöður fyrir „{query}“",
    count: { one: "{count} niðurstaða", other: "{count} niðurstöður" },
    noneTitle: "Ekkert fannst",
    /** {add} is a link with the text below. */
    noneBody: "Prófaðu styttra nafn, bara staðinn eða götuheitið. Finnurðu ekki eignina sem þú leigir? {add}.",
    addIt: "Skráðu hana",
    landlords: "Leigusalar",
    properties: "Eignir",
    renters: "Leigjendur",
    seeAll: {
      landlords: "Sjá alla leigusala ({count}) →",
      properties: "Sjá allar eignir ({count}) →",
      renters: "Sjá alla leigjendur ({count}) →",
    },
  },
} as const satisfies Tree;
