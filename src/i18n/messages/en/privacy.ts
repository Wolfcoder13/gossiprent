import type { Shape } from "../../types";
import type is from "../is/privacy";

export default {
  title: "Privacy",
  intro: "What GossipRent stores, why, and what you can do about it.",
  kennitala: {
    heading: "Why we use kennitalas",
    why: "Many people in Iceland share a name. A kennitala (Icelandic ID number) is the only reliable way to tell namesakes apart, so a review ends up on the right person's page and not on the page of someone with the same name.",
    when: "When you review a landlord or a renter, you enter their kennitala. When you sign up, you enter your own.",
  },
  hidden: {
    heading: "Kennitalas are never shown",
    body: "No kennitala is ever shown on the site: not on people's pages, in page addresses, or to other users. Only you see your own, on My account. Looking one up needs a login, and the number of lookups is limited.",
  },
  verified: {
    heading: "Identities aren't verified",
    body: "GossipRent doesn't check that people enter their own kennitala or the right names. The name on a page without an account is the one the first review's author typed. Reviews are the opinions of their authors.",
  },
  reviews: {
    heading: "Reviews about you",
    remove: "You can't remove reviews others have written about you. If a review is false, abusive, about the wrong person or reveals personal information, report it with the link on the review and we'll look into it.",
    noAccount: "When someone reviews a kennitala that has no account, a page is created with the name its author typed. If that's you, sign up with your kennitala to take the page over.",
  },
  closing: {
    heading: "Closing your account",
    body: "You can close your account on My account. The reviews you wrote are deleted, along with your email and password. If others have reviewed you, your page stays, with their reviews on it. Signing up again with the same kennitala takes it back over.",
  },
  stored: {
    heading: "What we store",
    account: "For an account we store your kennitala, name, email and roles, and your city and bio if you give them. Your password itself is never stored, only a hash of it.",
    cookies: "We use two cookies: one that keeps you logged in and one that remembers your language. No advertising or tracking cookies.",
    abuse: "To prevent abuse we record attempts to log in, sign up, look up a kennitala or send a report, with the IP address they came from. These records count for at most a day and are then deleted.",
    reports: "Reports are kept with the email you give, so we can reply to you.",
  },
  contact: {
    heading: "Contact",
    body: "To report a review or a page, use the report link on it. For anything else, for example if someone has signed up with your kennitala, use {form}.",
    form: "the report form",
  },
} satisfies Shape<typeof is>;
