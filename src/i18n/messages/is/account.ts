// Icelandic messages. Writing rules (see docs/iceland-spec.md §1):
// - Informal "þú". Buttons in the infinitive (Vista, Birta umsögn); instructions in the imperative.
// - Gender-neutral: role nouns (leigusali, leigjandi, aðili), "viðkomandi", impersonal or passive
//   voice. No participles about the reader or a subject (skráður/skráð, velkomin(n)).
// - Names and addresses only in nominative slots: headings, cards, after a colon, or as the subject.
//   Let a role noun carry any other case ("Hefur þú leigt af þessum leigusala?").
// - One whole sentence per role/kind variant; never build sentences from noun keys.
// - Plurals are { one, other } (Icelandic: 21 → one, 11 → other). „Gæsalappir“, "t.d.", decimal comma.
//
// Mínar síður (src/app/dashboard) and src/app/actions/account.ts.
import type { Tree } from "../../types";

export default {
  dashboard: {
    /** {name} is the first name (nominative, which is also the form used to address someone). */
    greeting: "Hæ, {name}",
    signedInAs: "Netfang: {email}",
    viewProfile: "Skoða opinbera síðu",
    quickActions: "Flýtileiðir",
    reviewLandlord: "Skrifa umsögn um leigusala",
    reviewRenter: "Skrifa umsögn um leigjanda",
    reviewProperty: "Skrifa umsögn um eign",
    addProperty: "Skrá eign",
    addPlaceYouRent: "Skrá eignina sem þú leigir",
    /** Under a list cut short; numbers are formatted. */
    showing: "Hér eru nýjustu {shown} af {total}.",
    /** After signing up with a kennitala someone had already reviewed. {report} is the link text below. */
    keptName:
      "Umsagnir höfðu þegar verið skrifaðar um þig, svo síðan þín heldur nafninu sem þar var notað. Ef það er rangt geturðu {report}.",
    report: "tilkynnt það",
  },
  aboutYou: {
    heading: "Umsagnir um þig",
    asLandlord: "Umsagnir um þig sem leigusala",
    asRenter: "Umsagnir um þig sem leigjanda",
    cantRemove:
      "Þú getur ekki fjarlægt umsagnir sem aðrir skrifa um þig, en þú getur tilkynnt umsögn sem brýtur reglurnar.",
    seeAll: "Sjá allar á síðunni þinni",
    emptyLandlord: {
      title: "Engir leigjendur hafa skrifað umsögn um þig enn",
      body: "Umsagnir leigjenda þinna birtast hér. Deildu hlekknum á síðuna þína með þeim!",
    },
    emptyRenter: {
      title: "Engir leigusalar hafa skrifað umsögn um þig enn",
      body: "Umsagnir leigusala þinna birtast hér.",
    },
  },
  propertyReviews: {
    heading: "Umsagnir um eignirnar þínar",
    empty: "Engar umsagnir um eignirnar þínar enn",
  },
  written: {
    heading: "Umsagnir sem þú hefur skrifað",
    empty: "Þú hefur ekki skrifað neinar umsagnir enn",
    findLandlord: "Finna leigusalann þinn",
    findRenter: "Finna leigjanda til að skrifa um",
  },
  properties: {
    managed: "Eignirnar þínar",
    managedEmptyTitle: "Þú hefur ekki skráð neinar eignir",
    managedEmptyBody:
      "Skráðu íbúðirnar sem þú leigir út svo leigjendur geti skrifað umsagnir um þær. Ef leigjandi hefur þegar skráð eignina skaltu opna hana og velja „Ég er leigusali hér“.",
    addedAsRenter: "Eignir sem þú skráðir sem leigjandi",
    added: "Eignir sem þú skráðir",
    addedEmptyTitle: "Þú hefur ekki skráð neinar eignir",
    addedEmptyBody: "Finnurðu ekki eignina sem þú leigir? Skráðu hana svo þú getir skrifað umsögn um hana.",
    add: "Skrá eign",
  },
  roles: {
    heading: "Hlutverkin þín",
    intro: "Leigir þú húsnæði og leigir líka út? Hafðu bæði hlutverkin. Þú færð sérstaka einkunn fyrir hvort hlutverk.",
    add: {
      landlord: "Ég er líka leigusali",
      renter: "Ég er líka leigjandi",
    },
    remove: {
      landlord: "Fjarlægja hlutverk leigusala",
      renter: "Fjarlægja hlutverk leigjanda",
    },
    confirmRemove: {
      landlord:
        "Fjarlægja hlutverk leigusala? Eignirnar þínar verða ekki lengur tengdar þér og enginn annar getur tengt þig við þær aftur. Þú getur bætt hlutverkinu við aftur hvenær sem er og tengt eign aftur við þig með „Ég er leigusali hér“ á síðu eignarinnar.",
      renter: "Fjarlægja hlutverk leigjanda? Þú getur bætt því við aftur hvenær sem er.",
    },
    kept: {
      landlord: "Leigjendur hafa skrifað umsagnir um þig, svo þetta hlutverk helst.",
      renter: "Leigusalar hafa skrifað umsagnir um þig, svo þetta hlutverk helst.",
    },
    notA: {
      landlord: "Ekki leigusali",
      renter: "Ekki leigjandi",
    },
    saving: "Vistar…",
    invalid: "Eitthvað fór úrskeiðis. Reyndu aftur.",
    needOne: "Þú þarft að hafa minnst eitt hlutverk. Bættu hinu við fyrst.",
    reviewedAs: {
      landlord: "Leigjendur hafa skrifað umsagnir um þig sem leigusala, svo þú getur ekki fjarlægt það hlutverk.",
      renter: "Leigusalar hafa skrifað umsagnir um þig sem leigjanda, svo þú getur ekki fjarlægt það hlutverk.",
    },
    added: {
      landlord: "Komið. Nú ert þú líka leigusali á GossipRent.",
      renter: "Komið. Nú ert þú líka leigjandi á GossipRent.",
    },
    removed: {
      landlord: "Komið. Þú ert ekki lengur leigusali á GossipRent.",
      renter: "Komið. Þú ert ekki lengur leigjandi á GossipRent.",
    },
    /** Link back to the review form that sent them to add a role. */
    back: "Halda áfram með umsögnina",
  },
  profile: {
    heading: "Síðan þín",
    intro: "Þetta sjá aðrir á opinberu síðunni þinni.",
    /** {kennitala} is formatted 123456-7890. Shown only to its owner. */
    kennitala: "Kennitalan þín: {kennitala}",
    kennitalaNote: "Aðeins þú sérð hana hér. Hún er aldrei birt opinberlega.",
    name: "Nafn",
    city: "Staður",
    bio: "Um mig",
    bioHint: {
      one: "Ein eða tvær setningar um þig. Mest {count} stafur.",
      other: "Ein eða tvær setningar um þig. Mest {count} stafir.",
    },
    save: "Vista",
    saving: "Vistar…",
    saved: "Vistað.",
    nameLocked:
      "Ekki er hægt að breyta nafninu eftir að aðrir hafa skrifað umsögn um þig. Ef það er rangt geturðu tilkynnt það.",
    /** Same sentence as nameLocked, with {report} as a link (the text below). */
    nameLockedHint:
      "Ekki er hægt að breyta nafninu eftir að aðrir hafa skrifað umsögn um þig. Ef það er rangt geturðu {report}.",
    report: "tilkynnt það",
  },
  password: {
    heading: "Lykilorð og innskráningar",
    intro: "Ef þú breytir lykilorðinu lokast innskráningar á öllum öðrum tækjum.",
    current: "Núverandi lykilorð",
    newPassword: "Nýtt lykilorð",
    confirm: "Nýja lykilorðið aftur",
    submit: "Breyta lykilorði",
    pending: "Breytir…",
    notCurrent: "Þetta er ekki núverandi lykilorðið þitt.",
    changed: "Lykilorðinu var breytt. Innskráningum á öðrum tækjum var lokað.",
    signOutOthers: "Skrá út á öðrum tækjum",
    signingOut: "Skráir út…",
    signedOut: "Innskráningum á öllum öðrum tækjum var lokað.",
  },
  close: {
    heading: "Eyða aðgangi",
    body: "Eyðir innskráningunni þinni og umsögnunum sem þú skrifaðir. Umsagnir sem aðrir skrifuðu um þig verða áfram á vefnum.",
    again: "Ef þú stofnar aðgang aftur með sömu kennitölu færðu síðuna þína til baka.",
    button: "Eyða aðgangi",
    pending: "Eyðir…",
    confirm:
      "Eyða aðganginum? Innskráningunni þinni og umsögnunum sem þú skrifaðir verður eytt varanlega. Umsagnir sem aðrir skrifuðu um þig verða áfram á vefnum.",
  },
} as const satisfies Tree;
