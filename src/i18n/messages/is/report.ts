// Icelandic messages. Writing rules (see docs/iceland-spec.md §1):
// - Informal "þú". Buttons in the infinitive (Vista, Birta umsögn); instructions in the imperative.
// - Gender-neutral: role nouns (leigusali, leigjandi, aðili), "viðkomandi", impersonal or passive
//   voice. No participles about the reader or a subject (skráður/skráð, velkomin(n)).
// - Names and addresses only in nominative slots: headings, cards, after a colon, or as the subject.
//   Let a role noun carry any other case ("Hefur þú leigt af þessum leigusala?").
// - One whole sentence per role/kind variant; never build sentences from noun keys.
// - Plurals are { one, other } (Icelandic: 21 → one, 11 → other). „Gæsalappir“, "t.d.", decimal comma.
//
// /report?target=…&id=… and the createReport Server Action.
import type { Tree } from "../../types";

export default {
  title: "Tilkynna vandamál",
  intro:
    "Segðu okkur hvað er að. Aðeins umsjónarfólk GossipRent les tilkynningar og þær birtast hvergi á síðunni.",
  /** The link is broken, or what it pointed to is gone. */
  invalid: {
    title: "Ekki er hægt að tilkynna þetta.",
    body: "Hlekkurinn gæti verið rangur, eða efnið hefur verið fjarlægt.",
    home: "Fara á forsíðu",
  },
  /** What is being reported: label, then the review title, name or address (nominative, after the label). */
  subject: {
    heading: "Það sem þú tilkynnir",
    review: "Umsögn",
    reviewTitle: "„{title}“",
    profile: "Síða",
    property: "Eign",
    account: "Aðgangur",
    accountBody: "Til dæmis ef einhver annar hefur stofnað aðgang með kennitölunni þinni.",
    view: "Skoða síðuna",
  },
  fields: {
    reason: "Ástæða",
    chooseReason: "Veldu ástæðu",
    details: "Hvað er að?",
    detailsHint: "Lýstu vandanum eins nákvæmlega og þú getur.",
    /** For target=account: the operator needs to find the account. */
    detailsHintAccount: "Gefðu upp nafnið þitt og kennitöluna svo hægt sé að finna aðganginn.",
    /** Logged out: required. */
    email: "Netfangið þitt",
    emailHint: "Svo hægt sé að svara þér. Það birtist hvergi.",
    /** Logged in: optional. */
    replyEmail: "Netfang fyrir svar",
    replyEmailHint: "Ef þú skilur reitinn eftir auðan er svarað á netfang aðgangsins þíns.",
  },
  reasons: {
    wrong_person: "Þetta er um rangan aðila",
    wrong_name: "Nafnið er rangt",
    false_or_abusive: "Þetta er rangt, særandi eða ærumeiðandi",
    personal_data: "Hér koma fram persónuupplýsingar (t.d. um heilsu, skuldir, kennitölu eða símanúmer)",
    identity_claimed: "Einhver annar hefur stofnað aðgang með kennitölunni minni",
    other: "Annað",
  },
  submit: "Senda tilkynningu",
  pending: "Sendir…",
  sent: "Takk. Við skoðum málið.",
  back: "Til baka",
} as const satisfies Tree;
