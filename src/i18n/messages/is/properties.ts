// Icelandic messages. Writing rules (see docs/iceland-spec.md §1):
// - Informal "þú". Buttons in the infinitive (Vista, Birta umsögn); instructions in the imperative.
// - Gender-neutral: role nouns (leigusali, leigjandi, aðili), "viðkomandi", impersonal or passive
//   voice. No participles about the reader or a subject (skráður/skráð, velkomin(n)).
// - Names and addresses only in nominative slots: headings, cards, after a colon, or as the subject.
//   Let a role noun carry any other case ("Hefur þú leigt af þessum leigusala?").
// - One whole sentence per role/kind variant; never build sentences from noun keys.
// - Plurals are { one, other } (Icelandic: 21 → one, 11 → other). „Gæsalappir“, "t.d.", decimal comma.
//
// Properties: the /properties directory, the add-a-property form (/properties/new),
// a property's page and its landlord controls, and the property Server Actions.
import type { Tree } from "../../types";

export default {
  /** /properties */
  list: {
    title: "Eignir",
    description: "Hús og íbúðir, með umsögnum leigjenda sem hafa búið þar.",
    add: "Skrá eign",
    searchPlaceholder: "Leita eftir heimilisfangi, póstnúmeri eða bæ",
    count: { one: "{count} eign", other: "{count} eignir" },
    /** {query} is what the visitor searched for, in quotes. */
    matching: { one: "{count} eign passar við „{query}“", other: "{count} eignir passa við „{query}“" },
    clearSearch: "Hreinsa leit",
    noMatchTitle: "Engar eignir passa við „{query}“",
    noMatchBody: "Prófaðu bara götuheitið, póstnúmerið eða bæinn, eða skráðu eignina ef hún er ekki komin á vefinn.",
    emptyTitle: "Engar eignir enn",
    emptyBody: "Skráðu eignina sem þú leigir svo að þú og aðrir getið skrifað umsögn um hana.",
    addRented: "Skrá eignina sem þú leigir",
  },

  /** /properties/new */
  new: {
    title: "Skrá eign",
    /** By the roles of the person adding it. */
    intro: {
      both: "Skráðu hús eða íbúð sem þú átt eða sérð um, eða eignina sem þú leigir svo að þú getir skrifað umsögn um hana. Athugaðu fyrst hvort hún sé ekki þegar á vefnum.",
      landlord:
        "Skráðu hús eða íbúð sem þú átt eða sérð um. Eignin birtist á síðunni þinni sem leigusali svo að leigjendur þínir geti skrifað umsögn um hana.",
      renter:
        "Skráðu eignina sem þú leigir (eða leigðir áður) svo að þú getir skrifað umsögn um hana. Athugaðu fyrst hvort hún sé ekki þegar á vefnum.",
    },
  },

  /** The add-a-property form, and the landlord fields it shares with the "change landlord" form. */
  form: {
    address: "Heimilisfang",
    addressHint: "t.d. Njálsgata 23",
    unit: "Íbúð",
    unitHint: "t.d. 0201 (2. hæð, íbúð 01) eða 2. hæð til vinstri",
    postalCode: "Póstnúmer",
    choosePostcode: "Veldu póstnúmer",
    description: "Stutt lýsing",
    descriptionPlaceholder: "t.d. Þriggja herbergja íbúð á annarri hæð með sameiginlegu þvottahúsi",
    /** Only for people who are both landlords and renters. */
    relation: {
      legend: "Hvernig tengist þú eigninni?",
      own: "Ég á hana eða sé um hana",
      ownHint: "Hún birtist á síðunni þinni sem leigusali.",
      rent: "Ég leigi hana eða leigði áður",
      rentHint: "Svo að þú getir skrifað umsögn um hana sem leigjandi.",
    },
    landlord: {
      kennitala: "Kennitala leigusala",
      kennitalaHint:
        "Ef þú veist hana: 10 tölustafir, t.d. 123456-7890. Hún tengir eignina við síðu leigusalans og birtist hvergi á GossipRent.",
      check: "Athuga",
      checking: "Athugar…",
      /** The name follows the colon (nominative). */
      found: "Þessi kennitala tilheyrir: {name}",
      notFound: "Þessi kennitala er ekki enn á GossipRent. Sláðu inn nafn leigusalans til að bæta viðkomandi við.",
      company: "Þetta er kennitala fyrirtækis.",
      born: "Fæðingardagur: {date}",
      name: "Nafn leigusala",
      nameHint: "Birtist á síðu leigusalans. Notaðu nafnið sem viðkomandi gengur undir, eða nafn fyrirtækisins.",
      confirm: "Ég hef gengið úr skugga um að kennitalan sé rétt",
    },
    submit: "Skrá eign",
    submitting: "Skráir…",
  },

  /** A property's page. */
  page: {
    /** {date} is a month and year ("október 2026"). */
    listed: "Skráð í {date}",
    /** {name} is a link to the landlord's page (nominative, after the colon). */
    landlord: "Leigusali: {name}",
    /** Next to a landlord without a GossipRent account: a renter named them. */
    unconfirmed: "Tilgreint af leigjanda, ekki staðfest",
    noLandlord: "Enginn leigusali tengdur",
    claim: "Ég er leigusali hér",
    unlink: "Ekki mín eign",
    unlinkConfirm: "Fjarlægja tenginguna við þig sem leigusala? Eignin og umsagnir um hana verða áfram á GossipRent.",
    saving: "Vistar…",
    report: "Tilkynna þessa síðu",
    editReview: "Breyta umsögninni þinni",
    reviewThis: "Skrifa umsögn um eignina",
    reviewsIntro: "Hvað leigjendur segja um að búa hér.",
    noReviewsTitle: "Engar umsagnir um þessa eign enn",
    noReviewsBody: "Býrð þú hér eða bjóst þú hér áður? Segðu frá því hvernig er að búa hér.",
    ownerNote: "Þú ert leigusali þessarar eignar. Umsagnir leigjenda þinna birtast hér.",
  },

  /** The creator of a property links, changes or removes its landlord (while the landlord has no account). */
  relink: {
    link: "Tengja leigusala",
    change: "Breyta leigusala",
    intro:
      "Þú skráðir þessa eign, svo þú getur tengt leigusala við hana með kennitölu, eða skilið reitinn eftir tóman til að fjarlægja tenginguna. Þegar leigusalinn er kominn með aðgang getur aðeins viðkomandi breytt henni.",
    save: "Vista leigusala",
    saving: "Vistar…",
  },

  /** Results of the property Server Actions. */
  messages: {
    logIn: "Skráðu þig inn til að skrá eign.",
    alreadyListed: "Þessi eign er þegar á GossipRent.",
    alreadyListedClaimable:
      "Þessi eign er þegar á vefnum, án leigusala. Ef þú leigir hana út getur þú tengt hana við síðuna þína.",
    goToListing: "Fara á eignina",
    goToClaim: "Fara á eignina til að tengja hana við þig",
    onlyLandlordsOwn: "Aðeins leigusalar geta skráð eign sem sína eigin.",
    ownKennitala: "Þetta er þín eigin kennitala. Þú getur ekki verið leigusali eignar sem þú leigir.",
    /** Deliberately neutral: never say why (e.g. that the person is under 18). */
    minor: "Ekki er hægt að tengja þessa kennitölu sem leigusala.",
    nameRequired: "Þessi kennitala er ekki enn á GossipRent. Sláðu inn nafn leigusalans.",
    confirmRequired: "Hakaðu í reitinn til að staðfesta að kennitalan sé rétt.",
    unknownAction: "Eitthvað fór úrskeiðis. Endurhladdu síðuna og reyndu aftur.",
    missing: "Þessi eign er ekki til.",
    claimed: "Komið. Eignin er nú tengd við þig sem leigusala.",
    claimNotLandlord: "Aðeins leigusalar geta tengt eign við sig.",
    claimTaken: "Annar leigusali sér þegar um þessa eign.",
    claimReviewed:
      "Þú hefur skrifað umsögn um þessa eign sem leigjandi og getur því ekki líka verið leigusali hennar. Eyddu umsögninni fyrst.",
    unlinked: "Komið. Eignin er ekki lengur tengd við þig.",
    unlinkNotListed: "Eignin er ekki tengd við þig sem leigusala.",
    relinked: "Komið. Búið er að breyta leigusala eignarinnar.",
    relinkCleared: "Komið. Tengingin við leigusalann var fjarlægð.",
    relinkNotCreator: "Þú getur aðeins breytt leigusala eigna sem þú skráðir.",
    relinkHasAccount:
      "Leigusalinn er með aðgang að GossipRent, svo aðeins er hægt að fjarlægja tenginguna úr þeim aðgangi (með „Ekki mín eign“). Ef hún er röng skaltu tilkynna síðuna.",
  },
} as const satisfies Tree;
