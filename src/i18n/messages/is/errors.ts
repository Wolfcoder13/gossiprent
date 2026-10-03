// Icelandic messages. Writing rules (see docs/iceland-spec.md §1):
// - Informal "þú". Buttons in the infinitive (Vista, Birta umsögn); instructions in the imperative.
// - Gender-neutral: role nouns (leigusali, leigjandi, aðili), "viðkomandi", impersonal or passive
//   voice. No participles about the reader or a subject (skráður/skráð, velkomin(n)).
// - Names and addresses only in nominative slots: headings, cards, after a colon, or as the subject.
//   Let a role noun carry any other case ("Hefur þú leigt af þessum leigusala?").
// - One whole sentence per role/kind variant; never build sentences from noun keys.
// - Plurals are { one, other } (Icelandic: 21 → one, 11 → other). „Gæsalappir“, "t.d.", decimal comma.
//
// Error pages, plus messages that several Server Actions share.
import type { Tree } from "../../types";

export default {
  notFound: {
    title: "Þessi síða fannst ekki",
    body: "Síðan sem þú leitar að gæti hafa verið fjarlægð, eða hlekkurinn er rangur.",
    home: "Á forsíðu",
    search: "Leita",
  },
  generic: {
    title: "Eitthvað fór úrskeiðis",
    body: "Því miður. Reyndu aftur eftir smástund.",
    reference: "Tilvísun villu: {digest}",
    retry: "Reyna aftur",
  },
  /** Short rate-limit windows (logins, sign-ups, password changes). */
  tooManyAttempts: "Of margar tilraunir. Bíddu í nokkrar mínútur og reyndu svo aftur.",
  /** Long (daily) rate-limit windows, e.g. kennitala checks and reports. */
  tryLater: "Of margar tilraunir. Reyndu aftur síðar.",
  /** The session ended (or the account was closed) while a form was open. */
  logInAgain: "Skráðu þig inn aftur.",
  setup: {
    eyebrow: "Næstum tilbúið",
    title: "Tengdu gagnagrunn",
    intro:
      "GossipRent er komið í loftið en þarf Postgres-gagnagrunn til að geyma aðganga og umsagnir. Það tekur um mínútu:",
    storage: "Opnaðu verkefnið í stjórnborði Vercel og farðu í flipann {storage}.",
    create: "Veldu {create}, svo {neon}, og tengdu gagnagrunninn við verkefnið. Þá er {env} stillt fyrir þig.",
    redeploy: "Veldu {redeploy}. Töflurnar verða til sjálfkrafa í smíðinni.",
    anyPostgres: "Allir Postgres-gagnagrunnar virka. Stilltu bara {env} í umhverfisbreytum verkefnisins.",
  },
} as const satisfies Tree;
