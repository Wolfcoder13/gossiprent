import type { Shape } from "../../types";
import type is from "../is/auth";

export default {
  fields: {
    kennitala: "Kennitala",
    name: "Name",
    email: "Email",
    password: "Password",
    city: "City",
  },
  passwordHint: { one: "At least {count} character.", other: "At least {count} characters." },
  login: {
    heading: "Welcome back",
    intro: "Log in to write and manage your reviews.",
    submit: "Log in",
    pending: "Logging in…",
    newHere: "New to GossipRent?",
    signUp: "Create an account",
    noMatch: "That email and password don't match an account.",
  },
  signup: {
    heading: "Create your account",
    intro: "Free, and it only takes a minute. Your email and kennitala are never shown publicly.",
    roles: {
      legend: "I'm joining as a…",
      hint: "Pick one or both. If you rent a home and also rent one out, you get a separate rating for each.",
      renter: {
        title: "I'm a renter",
        body: "Review your landlords and the places you've lived.",
      },
      landlord: {
        title: "I'm a landlord",
        body: "List your properties and review your renters.",
      },
    },
    kennitalaWhy:
      "Your kennitala (Icelandic ID number) links reviews to the right person, even when people share a name. It's never shown publicly. You can't remove reviews other people write about you.",
    nameHint:
      "Shown on your profile and reviews. If someone has already reviewed you, your page keeps the name they used.",
    cityPlaceholder: "e.g. Reykjavík",
    submit: "Create account",
    pending: "Creating account…",
    haveAccount: "Already have an account?",
    logIn: "Log in",
    company: "Company accounts aren't available yet.",
    underage: "You must be 18 or older to sign up.",
    kennitalaTaken: "This kennitala already has an account.",
    notYou: "Not you? Report it",
    emailTaken: "An account with this email already exists. Try logging in instead.",
  },
} satisfies Shape<typeof is>;
