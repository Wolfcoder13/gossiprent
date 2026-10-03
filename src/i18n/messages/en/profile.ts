import type { Shape } from "../../types";
import type is from "../is/profile";

export default {
  memberSince: "Member since {date}",
  cityMemberSince: "{city} · Member since {date}",
  firstReviewed: "First reviewed {date}",
  identityNotVerified: "Identity not verified",
  noAccountNote: {
    person:
      "This person doesn't have a GossipRent account and doesn't manage this page. The name may have been entered by someone else. Is this you? {signUp} to take over the page. Reviews others wrote about you stay on it.",
    company:
      "This company doesn't have a GossipRent account and doesn't manage this page. The name may have been entered by someone else.",
  },
  signUp: "Sign up with your kennitala",
  report: "Report this page",
  tabs: {
    label: "Ratings by role",
    landlord: "As a landlord",
    renter: "As a renter",
    outOf: " stars",
    noReviews: "(no reviews)",
  },
  ratingHeading: {
    landlord: "{name}'s rating as a landlord",
    renter: "{name}'s rating as a renter",
  },
  reviewButton: "Review {name}",
  editButton: "Edit your review",
  properties: {
    heading: "Properties",
    showing: { one: "Showing {shown} of {count} property.", other: "Showing {shown} of {count} properties." },
    empty: "No properties listed yet",
  },
  reviews: {
    heading: {
      landlord: "Reviews as a landlord",
      renter: "Reviews as a renter",
    },
    intro: {
      // The name isn't sentence-final: company names end in a period ("ehf.").
      landlord: "{name}, as rated by their renters.",
      renter: "{name}, as rated by their landlords.",
    },
    empty: {
      landlord: "No reviews for {name} yet",
      renter: "No reviews for {name} yet",
    },
    emptySelf: {
      landlord: "When renters review you, their reviews will show up here.",
      renter: "When landlords review you, their reviews will show up here.",
    },
    emptyOther: "Be the first to share your experience.",
  },
  ownerNote: {
    landlord: "This is your public profile. Reviews from renters appear here — you can't review yourself.",
    renter: "This is your public profile. Reviews from landlords appear here — you can't review yourself.",
  },
} satisfies Shape<typeof is>;
