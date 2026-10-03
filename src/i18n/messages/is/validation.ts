// Icelandic messages. Writing rules (see docs/iceland-spec.md §1):
// - Informal "þú". Buttons in the infinitive (Vista, Birta umsögn); instructions in the imperative.
// - Gender-neutral: role nouns (leigusali, leigjandi, aðili), "viðkomandi", impersonal or passive
//   voice. No participles about the reader or a subject (skráður/skráð, velkomin(n)).
// - Names and addresses only in nominative slots: headings, cards, after a colon, or as the subject.
//   Let a role noun carry any other case ("Hefur þú leigt af þessum leigusala?").
// - One whole sentence per role/kind variant; never build sentences from noun keys.
// - Plurals are { one, other } (Icelandic: 21 → one, 11 → other). „Gæsalappir“, "t.d.", decimal comma.
//
// Form validation (src/lib/validation.ts). parseForm fills {count} with the
// length limit that failed (from LIMITS), so these are plurals.
import type { Tree } from "../../types";

export default {
  /** Banner above a form that has field errors. */
  fixHighlighted: "Lagaðu merktu reitina.",
  /** Any problem without a message of its own (usually a tampered request). */
  invalid: "Athugaðu þennan reit.",
  tooLong: { one: "Hámark {count} stafur.", other: "Hámark {count} stafir." },
  noKennitalaInText: "Ekki skrifa kennitölu hér. Kennitölur eru aldrei birtar á GossipRent.",
  roles: {
    required: "Veldu að minnsta kosti eitt: leigjandi, leigusali eða hvort tveggja.",
  },
  kennitala: {
    required: "Sláðu inn kennitölu.",
    invalid: "Þetta er ekki gild kennitala. Sláðu inn 10 tölustafi, t.d. 123456-7890.",
  },
  name: {
    tooShort: { one: "Nafn þarf að vera minnst {count} stafur.", other: "Nafn þarf að vera minnst {count} stafir." },
    tooLong: { one: "Nafn má mest vera {count} stafur.", other: "Nafn má mest vera {count} stafir." },
    personChars: "Nafn má aðeins innihalda bókstafi, bil, bandstrik, úrfellingarmerki og punkta.",
    companyChars: "Nafn má aðeins innihalda bókstafi, tölustafi, bil, &, bandstrik, úrfellingarmerki og punkta.",
    noLink: "Nafn má ekki innihalda vefslóð.",
  },
  email: {
    invalid: "Sláðu inn gilt netfang.",
    tooLong: "Netfangið er of langt.",
  },
  password: {
    required: "Sláðu inn lykilorðið þitt.",
    currentRequired: "Sláðu inn núverandi lykilorð.",
    tooShort: {
      one: "Lykilorð þarf að vera minnst {count} stafur.",
      other: "Lykilorð þarf að vera minnst {count} stafir.",
    },
    tooLong: { one: "Lykilorð má mest vera {count} stafur.", other: "Lykilorð má mest vera {count} stafir." },
    mismatch: "Nýju lykilorðin eru ekki eins.",
  },
  city: {
    tooLong: { one: "Staður má mest vera {count} stafur.", other: "Staður má mest vera {count} stafir." },
  },
  bio: {
    tooLong: { one: "„Um mig“ má mest vera {count} stafur.", other: "„Um mig“ má mest vera {count} stafir." },
  },
  review: {
    kind: "Veldu hvort umsögnin er um leigusala eða leigjanda.",
    subject: "Það sem umsögnin á að fjalla um fannst ekki.",
  },
  rating: {
    required: "Veldu einkunn, 1 til 5 stjörnur.",
    whole: "Veldu einkunn.",
  },
  title: {
    tooShort: {
      one: "Fyrirsögn þarf að vera minnst {count} stafur.",
      other: "Fyrirsögn þarf að vera minnst {count} stafir.",
    },
    tooLong: { one: "Fyrirsögn má mest vera {count} stafur.", other: "Fyrirsögn má mest vera {count} stafir." },
  },
  body: {
    tooShort: {
      one: "Umsögnin þín þarf að vera minnst {count} stafur.",
      other: "Umsögnin þín þarf að vera minnst {count} stafir.",
    },
    tooLong: {
      one: "Umsögnin þín má mest vera {count} stafur.",
      other: "Umsögnin þín má mest vera {count} stafir.",
    },
  },
  address: {
    required: "Sláðu inn heimilisfang.",
    tooLong: {
      one: "Heimilisfang má mest vera {count} stafur.",
      other: "Heimilisfang má mest vera {count} stafir.",
    },
  },
  unit: {
    tooLong: { one: "Íbúðarnúmer má mest vera {count} stafur.", other: "Íbúðarnúmer má mest vera {count} stafir." },
  },
  postalCode: {
    required: "Veldu póstnúmer.",
    invalid: "Veldu póstnúmer af listanum.",
  },
  description: {
    tooLong: { one: "Lýsing má mest vera {count} stafur.", other: "Lýsing má mest vera {count} stafir." },
  },
  relation: {
    required: "Veldu hvort þú átt eða leigir þessa eign.",
  },
  report: {
    target: "Ekki er hægt að tilkynna þessa síðu.",
    reason: "Veldu ástæðu.",
    detailsRequired: "Lýstu vandanum.",
    contactRequired: "Sláðu inn netfang svo hægt sé að svara þér.",
  },
} as const satisfies Tree;
