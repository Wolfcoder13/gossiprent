// Icelandic messages. Writing rules (see docs/iceland-spec.md §1):
// - Informal "þú". Buttons in the infinitive (Vista, Birta umsögn); instructions in the imperative.
// - Gender-neutral: role nouns (leigusali, leigjandi, aðili), "viðkomandi", impersonal or passive
//   voice. No participles about the reader or a subject (skráður/skráð, velkomin(n)).
// - Names and addresses only in nominative slots: headings, cards, after a colon, or as the subject.
//   Let a role noun carry any other case ("Hefur þú leigt af þessum leigusala?").
// - One whole sentence per role/kind variant; never build sentences from noun keys.
// - Plurals are { one, other } (Icelandic: 21 → one, 11 → other). „Gæsalappir“, "t.d.", decimal comma.
//
// Writing, editing and listing reviews: the review box on profile and property
// pages, the review form, review cards, the /reviews/new wizard, and the
// messages of the review Server Actions.
import type { Tree } from "../../types";

export default {
  /** Default heading over a list of reviews; the count follows in brackets. */
  heading: "Umsagnir",

  /** The "write a review" box next to a profile or property. */
  panel: {
    /** Heading for visitors who aren't logged in. */
    invite: {
      landlord: "Hefur þú leigt af þessum leigusala?",
      renter: "Hefur þú leigt þessum leigjanda?",
      property: "Hefur þú búið í þessari eign?",
    },
    /** By the role needed to write the review. */
    logInOrSignUp: {
      renter: "Skráðu þig inn eða stofnaðu ókeypis aðgang sem leigjandi til að gefa stjörnur og skrifa umsögn.",
      landlord: "Skráðu þig inn eða stofnaðu ókeypis aðgang sem leigusali til að gefa stjörnur og skrifa umsögn.",
    },
    signUpAs: {
      renter: "Stofna aðgang sem leigjandi",
      landlord: "Stofna aðgang sem leigusali",
    },
    logIn: "Skrá inn",
    /** {addRole} is the addRole link below. */
    notAllowed: {
      landlord: "Aðeins leigjendur geta skrifað umsagnir um leigusala. Ef þú ert líka leigjandi skaltu {addRole}.",
      renter: "Aðeins leigusalar geta skrifað umsagnir um leigjendur. Ef þú ert líka leigusali skaltu {addRole}.",
      property: "Aðeins leigjendur geta skrifað umsagnir um eignir. Ef þú ert líka leigjandi skaltu {addRole}.",
    },
    /** Link text inside notAllowed and lostRole (infinitive, after "skaltu"). */
    addRole: {
      renter: "bæta hlutverkinu „leigjandi“ við aðganginn þinn",
      landlord: "bæta hlutverkinu „leigusali“ við aðganginn þinn",
    },
    /** The viewer wrote a review here but has since removed the role it was written in. */
    lostRole: {
      landlord:
        "Þú skrifaðir umsögn um þennan leigusala sem leigjandi. Til að breyta henni skaltu {addRole} aftur. Þú getur samt eytt henni úr listanum yfir umsagnir.",
      renter:
        "Þú skrifaðir umsögn um þennan leigjanda sem leigusali. Til að breyta henni skaltu {addRole} aftur. Þú getur samt eytt henni úr listanum yfir umsagnir.",
      property:
        "Þú skrifaðir umsögn um þessa eign sem leigjandi. Til að breyta henni skaltu {addRole} aftur. Þú getur samt eytt henni úr listanum yfir umsagnir.",
    },
    /** Heading over the form for a new review. The name or address follows the colon. */
    newHeading: "Skrifa umsögn: {name}",
    yourReview: "Umsögnin þín",
    editIntro: "Þú getur uppfært umsögnina hvenær sem er. Hún birtist opinberlega með nafninu þínu.",
    newIntro: {
      landlord: "Umsögnin er opinber og nafnið þitt birtist með henni. Ein umsögn á hvern leigusala.",
      renter: "Umsögnin er opinber og nafnið þitt birtist með henni. Ein umsögn á hvern leigjanda.",
      property: "Umsögnin er opinber og nafnið þitt birtist með henni. Ein umsögn á hverja eign.",
    },
  },

  /** The review form (profile and property pages, and the wizard's last step). */
  form: {
    kennitala: {
      landlord: "Kennitala leigusala",
      renter: "Kennitala leigjanda",
    },
    kennitalaHint: "10 tölustafir, t.d. 123456-7890. Kennitalan birtist hvergi á GossipRent.",
    /** Shown above every review form. */
    guidelines:
      "Skrifaðu um eigin reynslu. Ekki skrifa um skuldir eða vanskil, heilsufar, ásakanir um afbrot eða fjölskylduhagi, og ekki setja inn kennitölur, símanúmer eða heimilisföng fólks.",
    title: "Fyrirsögn",
    titlePlaceholder: {
      landlord: "t.d. Fljót viðbrögð og sanngjörn skil á tryggingu",
      renter: "t.d. Gekk vel um og samskiptin voru góð",
      property: "t.d. Björt og róleg en kyndingin er slöpp",
    },
    body: "Umsögnin þín",
    bodyPlaceholder: {
      landlord:
        "Svaraði leigusalinn fljótt og var gert við það sem bilaði? Var leigusamningurinn sanngjarn og fékkst tryggingin endurgreidd?",
      renter: "Hvernig gekk leigjandinn um heimilið? Hvernig voru samskiptin, líka við nágranna?",
      property: "Hvernig er að búa þar? Kynding, raki eða mygla, hávaði, þvottaaðstaða, bílastæði, hverfið…",
    },
    bodyHint: { one: "Minnst {count} stafur.", other: "Minnst {count} stafir." },
    post: "Birta umsögn",
    update: "Uppfæra umsögn",
    posting: "Birtir…",
    saving: "Vistar…",
  },

  /** One review in a list. */
  card: {
    /** Next to the author's name on the viewer's own review. */
    you: "Þú",
    /** After the date, when the review was changed later. */
    edited: "breytt",
    /** In lists that mix subjects (home page, dashboard). */
    subject: {
      landlord: "Umsögn um leigusala: {name}",
      renter: "Umsögn um leigjanda: {name}",
      property: "Umsögn um eign: {address}",
    },
    edit: "Breyta",
    report: "Tilkynna",
  },

  /** Results of the review Server Actions. */
  messages: {
    logIn: "Skráðu þig inn til að skrifa umsögn.",
    live: "Takk! Umsögnin þín er komin á vefinn.",
    updated: "Umsögnin þín var uppfærð.",
    notAllowed: {
      landlord: "Aðeins leigjendur geta skrifað umsagnir um leigusala.",
      renter: "Aðeins leigusalar geta skrifað umsagnir um leigjendur.",
      property: "Aðeins leigjendur geta skrifað umsagnir um eignir.",
    },
    self: "Ekki er hægt að skrifa umsögn um eigin aðgang.",
    ownProperty: "Þú getur ekki skrifað umsögn um eign sem þú leigir út.",
    gone: {
      landlord: "Síða þessa leigusala er ekki lengur til.",
      renter: "Síða þessa leigjanda er ekki lengur til.",
      property: "Þessi eign er ekki lengur til.",
    },
    ownKennitala: "Þetta er þín eigin kennitala.",
    /** Deliberately neutral: never say why (e.g. that the person is under 18). */
    minor: "Ekki er hægt að taka við umsögn um þessa kennitölu.",
    /** The same whether the number is unknown or belongs to someone else. */
    mismatch: "Kennitalan passar ekki við þessa síðu. Nöfn eru ekki einstök, svo athugaðu hvort þú sért á réttri síðu.",
    kennitalaRequired: {
      landlord: "Sláðu inn kennitölu leigusalans.",
      renter: "Sláðu inn kennitölu leigjandans.",
    },
    confirmRequired: "Hakaðu í reitinn til að staðfesta að kennitalan sé rétt.",
  },

  /** /reviews/new: choose a landlord or renter, enter their kennitala, then write the review. */
  wizard: {
    title: "Skrifa umsögn",
    intro: "Segðu frá reynslu þinni af leigusala eða leigjanda.",
    choose: {
      /** Answered by the options below (accusative: "Um hvern? Leigusala."). */
      legend: "Um hvern viltu skrifa?",
      landlord: "Leigusala",
      landlordHint: "Þú hefur leigt húsnæði af viðkomandi.",
      renter: "Leigjanda",
      renterHint: "Þú hefur leigt viðkomandi húsnæði.",
    },
    property: "Viltu skrifa um eign? Umsagnir um eignir eru skrifaðar á síðu hverrar eignar.",
    findProperty: "Finna eign",
    addProperty: "Skrá eign",
    heading: {
      landlord: "Umsögn um leigusala",
      renter: "Umsögn um leigjanda",
    },
    kennitalaIntro: {
      landlord: "Sláðu inn kennitölu leigusalans svo ljóst sé um hvern umsögnin er. Nöfn eru ekki einstök.",
      renter: "Sláðu inn kennitölu leigjandans svo ljóst sé um hvern umsögnin er. Nöfn eru ekki einstök.",
    },
    continue: "Áfram",
    checking: "Athugar…",
    back: "Velja aftur",
    /** The name follows the colon (nominative). */
    found: "Þessi kennitala tilheyrir: {name}",
    notFound: "Þessi kennitala er ekki enn á GossipRent. Umsögnin þín býr til síðu fyrir viðkomandi.",
    kennitala: "Kennitala: {kennitala}",
    born: "Fæðingardagur: {date}",
    company: "Fyrirtæki",
    fullName: "Fullt nafn",
    companyName: "Nafn fyrirtækis",
    nameHint: "Birtist á síðunni. Notaðu nafnið sem viðkomandi gengur undir.",
    confirm: "Ég hef gengið úr skugga um að kennitalan sé rétt",
    wrongKennitala: "Röng kennitala? {startOver}",
    startOver: "Byrja aftur",
  },
} as const satisfies Tree;
