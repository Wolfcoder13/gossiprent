// Icelandic messages. Writing rules (see docs/iceland-spec.md §1):
// - Informal "þú". Buttons in the infinitive (Vista, Birta umsögn); instructions in the imperative.
// - Gender-neutral: role nouns (leigusali, leigjandi, aðili), "viðkomandi", impersonal or passive
//   voice. No participles about the reader or a subject (skráður/skráð, velkomin(n)).
// - Names and addresses only in nominative slots: headings, cards, after a colon, or as the subject.
//   Let a role noun carry any other case ("Hefur þú leigt af þessum leigusala?").
// - One whole sentence per role/kind variant; never build sentences from noun keys.
// - Plurals are { one, other } (Icelandic: 21 → one, 11 → other). „Gæsalappir“, "t.d.", decimal comma.
//
// Logging in and signing up (src/app/login, src/app/signup, src/app/actions/auth.ts).
import type { Tree } from "../../types";

export default {
  fields: {
    kennitala: "Kennitala",
    name: "Nafn",
    email: "Netfang",
    password: "Lykilorð",
    city: "Staður",
  },
  /** Under a new password field; {count} is the minimum length. */
  passwordHint: { one: "Minnst {count} stafur.", other: "Minnst {count} stafir." },
  login: {
    /** Gender-neutral on purpose (not „Velkomin(n) aftur“). */
    heading: "Gaman að sjá þig aftur",
    intro: "Skráðu þig inn til að skrifa umsagnir og halda utan um þær.",
    submit: "Skrá inn",
    pending: "Skráir inn…",
    newHere: "Ekki með aðgang?",
    signUp: "Stofna aðgang",
    noMatch: "Netfangið og lykilorðið passa ekki við neinn aðgang.",
  },
  signup: {
    heading: "Stofnaðu aðgang",
    intro: "Ókeypis og tekur bara mínútu. Netfangið þitt og kennitalan eru aldrei birt opinberlega.",
    roles: {
      legend: "Hvað á við um þig?",
      hint: "Veldu annað eða bæði. Ef þú leigir húsnæði og leigir líka út færðu sérstaka einkunn fyrir hvort hlutverk.",
      renter: {
        title: "Ég er leigjandi",
        body: "Skrifaðu umsagnir um leigusala þína og eignirnar sem þú hefur búið í.",
      },
      landlord: {
        title: "Ég er leigusali",
        body: "Skráðu eignirnar þínar og skrifaðu umsagnir um leigjendur þína.",
      },
    },
    /** Under the kennitala field, after the format hint. */
    kennitalaWhy:
      "Kennitalan tengir umsagnir við réttan aðila, jafnvel þegar nöfn eru eins. Hún er aldrei birt opinberlega. Þú getur ekki fjarlægt umsagnir sem aðrir skrifa um þig.",
    nameHint:
      "Birtist á síðunni þinni og með umsögnunum þínum. Ef umsögn hefur þegar verið skrifuð um þig heldur síðan nafninu sem þar var notað.",
    cityPlaceholder: "t.d. Reykjavík",
    submit: "Stofna aðgang",
    pending: "Stofnar aðgang…",
    haveAccount: "Áttu nú þegar aðgang?",
    logIn: "Skrá inn",
    company: "Ekki er enn hægt að stofna aðgang fyrir fyrirtæki.",
    underage: "Þú þarft að hafa náð 18 ára aldri til að stofna aðgang.",
    kennitalaTaken: "Aðgangur er þegar til fyrir þessa kennitölu.",
    /** Link to /report?target=account under kennitalaTaken. */
    notYou: "Ekki þú? Tilkynna það",
    emailTaken: "Aðgangur með þessu netfangi er þegar til. Prófaðu að skrá þig inn.",
  },
} as const satisfies Tree;
