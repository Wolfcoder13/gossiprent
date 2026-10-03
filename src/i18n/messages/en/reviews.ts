import type { Shape } from "../../types";
import type is from "../is/reviews";

export default {
  heading: "Reviews",

  panel: {
    invite: {
      landlord: "Have you rented from this landlord?",
      renter: "Have you rented to this renter?",
      property: "Have you lived at this property?",
    },
    logInOrSignUp: {
      renter: "Log in or create a free renter account to leave a star rating and a written review.",
      landlord: "Log in or create a free landlord account to leave a star rating and a written review.",
    },
    signUpAs: {
      renter: "Sign up as a renter",
      landlord: "Sign up as a landlord",
    },
    logIn: "Log in",
    notAllowed: {
      landlord: "Only renters can review landlords. If you rent too, {addRole}.",
      renter: "Only landlords can review renters. If you rent out a home too, {addRole}.",
      property: "Only renters can review properties. If you rent too, {addRole}.",
    },
    addRole: {
      renter: "add the renter role to your account",
      landlord: "add the landlord role to your account",
    },
    lostRole: {
      landlord:
        "You reviewed this landlord as a renter. To edit that review, {addRole} again. You can still delete it from the reviews list.",
      renter:
        "You reviewed this renter as a landlord. To edit that review, {addRole} again. You can still delete it from the reviews list.",
      property:
        "You reviewed this property as a renter. To edit that review, {addRole} again. You can still delete it from the reviews list.",
    },
    newHeading: "Review {name}",
    yourReview: "Your review",
    editIntro: "You can update your review any time. It's shown publicly with your name.",
    newIntro: {
      landlord: "Your review is public and shows your name. One review per landlord.",
      renter: "Your review is public and shows your name. One review per renter.",
      property: "Your review is public and shows your name. One review per property.",
    },
  },

  form: {
    kennitala: {
      landlord: "Landlord's kennitala",
      renter: "Renter's kennitala",
    },
    kennitalaHint: "Their Icelandic ID number: 10 digits, e.g. 123456-7890. It's never shown on GossipRent.",
    guidelines:
      "Write about your own experience. Don't mention debts or money owed, health, criminal accusations or family details, and don't include anyone's kennitala, phone number or address.",
    title: "Headline",
    titlePlaceholder: {
      landlord: "e.g. Fixes things fast, fair with the deposit",
      renter: "e.g. Took good care of the place, easy to talk to",
      property: "e.g. Bright and quiet, but the heating is weak",
    },
    body: "Your review",
    bodyPlaceholder: {
      landlord: "Did they answer quickly and fix things? Was the lease fair, and did you get the deposit back?",
      renter: "How did they look after the home? How was communication, including with neighbours?",
      property: "What's it like to live there? Heating, damp or mould, noise, laundry, parking, the area…",
    },
    bodyHint: { one: "At least {count} character.", other: "At least {count} characters." },
    post: "Post review",
    update: "Update review",
    posting: "Posting…",
    saving: "Saving…",
  },

  card: {
    you: "You",
    edited: "edited",
    subject: {
      landlord: "Reviewed {name}",
      renter: "Reviewed {name}",
      property: "Lived at {address}",
    },
    edit: "Edit",
    report: "Report",
  },

  messages: {
    logIn: "Please log in to leave a review.",
    live: "Thanks! Your review is live.",
    updated: "Your review was updated.",
    notAllowed: {
      landlord: "Only renters can review landlords.",
      renter: "Only landlords can review renters.",
      property: "Only renters can review properties.",
    },
    self: "You can't review yourself.",
    ownProperty: "You can't review a property you manage.",
    gone: {
      landlord: "That landlord no longer exists.",
      renter: "That renter no longer exists.",
      property: "That property no longer exists.",
    },
    ownKennitala: "That's your own kennitala.",
    minor: "We can't accept a review for this kennitala.",
    mismatch:
      "That kennitala doesn't match this profile. Several people can share a name, so check you're on the right page.",
    kennitalaRequired: {
      landlord: "Enter the landlord's kennitala.",
      renter: "Enter the renter's kennitala.",
    },
    confirmRequired: "Tick the box to confirm the kennitala is right.",
  },

  wizard: {
    title: "Write a review",
    intro: "Share your experience with a landlord or a renter.",
    choose: {
      legend: "Who do you want to review?",
      landlord: "A landlord",
      landlordHint: "You've rented a home from them.",
      renter: "A renter",
      renterHint: "You've rented a home to them.",
    },
    property: "Reviewing a property? Property reviews are written on each property's page.",
    findProperty: "Find a property",
    addProperty: "Add a property",
    heading: {
      landlord: "Review a landlord",
      renter: "Review a renter",
    },
    kennitalaIntro: {
      landlord: "Enter the landlord's kennitala so it's clear who the review is about. Several people can share a name.",
      renter: "Enter the renter's kennitala so it's clear who the review is about. Several people can share a name.",
    },
    continue: "Continue",
    checking: "Checking…",
    back: "Choose again",
    found: "This kennitala belongs to {name}",
    notFound: "Nobody with this kennitala is on GossipRent yet. Your review will create a page for them.",
    kennitala: "Kennitala: {kennitala}",
    born: "Date of birth: {date}",
    company: "Company",
    fullName: "Full name",
    companyName: "Company name",
    nameHint: "Shown on their page. Use the name they usually go by.",
    confirm: "I've checked that this kennitala is right",
    wrongKennitala: "Wrong kennitala? {startOver}",
    startOver: "Start over",
  },
} satisfies Shape<typeof is>;
