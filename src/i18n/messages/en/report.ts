import type { Shape } from "../../types";
import type is from "../is/report";

export default {
  title: "Report a problem",
  intro: "Tell us what's wrong. Reports are only read by the people who run GossipRent and are never shown on the site.",
  invalid: {
    title: "This can't be reported.",
    body: "The link may be wrong, or what it pointed to has been removed.",
    home: "Go home",
  },
  subject: {
    heading: "What you're reporting",
    review: "Review",
    reviewTitle: "“{title}”",
    profile: "Profile",
    property: "Property",
    account: "Account",
    accountBody: "For example, someone else has signed up with your kennitala.",
    view: "View the page",
  },
  fields: {
    reason: "Reason",
    chooseReason: "Choose a reason",
    details: "What's wrong?",
    detailsHint: "Be as specific as you can.",
    detailsHintAccount: "Give your name and kennitala so we can find the account.",
    email: "Your email",
    emailHint: "So we can reply to you. It's never shown.",
    replyEmail: "Email for a reply",
    replyEmailHint: "Leave it empty to get the reply at your account's email.",
  },
  reasons: {
    wrong_person: "It's about the wrong person",
    wrong_name: "The name is wrong",
    false_or_abusive: "It's false, abusive or defamatory",
    personal_data: "It shares personal information (e.g. health, debts, a kennitala or a phone number)",
    identity_claimed: "Someone else has an account with my kennitala",
    other: "Something else",
  },
  submit: "Send report",
  pending: "Sending…",
  sent: "Thanks. We'll look into it.",
  back: "Go back",
} satisfies Shape<typeof is>;
