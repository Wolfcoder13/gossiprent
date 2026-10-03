// Icelandic messages. Writing rules (see docs/iceland-spec.md §1):
// - Informal "þú". Buttons in the infinitive (Vista, Birta umsögn); instructions in the imperative.
// - Gender-neutral: role nouns (leigusali, leigjandi, aðili), "viðkomandi", impersonal or passive
//   voice. No participles about the reader or a subject (skráður/skráð, velkomin(n)).
// - Names and addresses only in nominative slots: headings, cards, after a colon, or as the subject.
//   Let a role noun carry any other case ("Hefur þú leigt af þessum leigusala?").
// - One whole sentence per role/kind variant; never build sentences from noun keys.
// - Plurals are { one, other } (Icelandic: 21 → one, 11 → other). „Gæsalappir“, "t.d.", decimal comma.
//
// /privacy (footer link "Persónuvernd"). Each section: a heading and one or more paragraphs.
import type { Tree } from "../../types";

export default {
  title: "Persónuvernd",
  intro: "Hér segir frá því hvaða upplýsingar GossipRent geymir, hvers vegna, og hvað þú getur gert.",
  kennitala: {
    heading: "Af hverju kennitala?",
    why: "Algengt er að fólk á Íslandi beri sama nafn. Kennitalan er eina örugga leiðin til að greina nafna í sundur, svo umsögn lendi á síðu rétts aðila en ekki á síðu einhvers sem heitir það sama.",
    when: "Þegar þú skrifar umsögn um leigusala eða leigjanda slærðu inn kennitölu viðkomandi. Við nýskráningu slærðu inn þína eigin.",
  },
  hidden: {
    heading: "Kennitölur eru aldrei birtar",
    body: "Kennitölur birtast hvergi á síðunni: hvorki á síðum fólks, í vefslóðum né öðrum notendum. Aðeins þú sérð þína eigin, á Mínum síðum. Aðeins er hægt að fletta upp kennitölu eftir innskráningu, og fjöldi uppflettinga er takmarkaður.",
  },
  verified: {
    heading: "Ekki er gengið úr skugga um hver fólk er",
    body: "GossipRent kannar ekki hvort fólk slær inn eigin kennitölu eða rétt nöfn. Nafn á síðu án aðgangs er nafnið sem höfundur fyrstu umsagnarinnar sló inn. Umsagnir lýsa skoðunum höfunda sinna.",
  },
  reviews: {
    heading: "Umsagnir um þig",
    remove: "Þú getur ekki fjarlægt umsagnir sem aðrir hafa skrifað um þig. Ef umsögn er röng, særandi, um rangan aðila eða inniheldur persónuupplýsingar geturðu tilkynnt hana með hlekknum á umsögninni og við skoðum málið.",
    noAccount: "Þegar einhver skrifar umsögn um kennitölu sem enginn aðgangur er til fyrir verður til síða með nafninu sem höfundurinn sló inn. Ef þetta ert þú geturðu tekið síðuna yfir með því að nýskrá þig með kennitölunni þinni.",
  },
  closing: {
    heading: "Ef þú lokar aðganginum",
    body: "Þú getur lokað aðganginum þínum á Mínum síðum. Þá er umsögnunum sem þú skrifaðir eytt, ásamt netfangi og lykilorði. Ef aðrir hafa skrifað umsagnir um þig stendur síðan þín eftir með þeim umsögnum. Ef þú nýskráir þig aftur með sömu kennitölu tekur þú síðuna yfir á ný.",
  },
  stored: {
    heading: "Hvað er geymt",
    account: "Fyrir aðgang geymum við kennitölu, nafn, netfang og hlutverk, og stað og texta í „Um mig“ ef þú gefur þau upp. Lykilorðið sjálft er aldrei geymt, aðeins tætigildi þess.",
    cookies: "Við notum tvær vafrakökur: eina sem heldur innskráningunni þinni virkri og aðra sem man tungumálið sem þú valdir. Engar auglýsinga- eða rakningarkökur.",
    abuse: "Til að hindra misnotkun skráum við tilraunir til innskráningar, nýskráningar, uppflettinga og tilkynninga, ásamt IP-tölunni sem þær komu frá. Skráningarnar gilda í mesta lagi í sólarhring og er svo eytt.",
    reports: "Tilkynningar eru geymdar ásamt netfanginu sem þú gefur upp, svo hægt sé að svara þér.",
  },
  contact: {
    heading: "Hafa samband",
    /** {form} is a link to the report form with the text below. */
    body: "Til að tilkynna umsögn eða síðu skaltu nota tilkynningarhlekkinn á henni. Fyrir allt annað, t.d. ef einhver hefur stofnað aðgang með kennitölunni þinni, skaltu nota {form}.",
    form: "tilkynningarformið",
  },
} as const satisfies Tree;
