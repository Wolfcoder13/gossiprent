import type { Shape } from "../../types";
import type is from "../is/nav";

export default {
  skipToContent: "Skip to content",
  main: "Main",
  landlords: "Landlords",
  renters: "Renters",
  properties: "Properties",
  writeReview: "Write a review",
  myAccount: "My account",
  logIn: "Log in",
  logOut: "Log out",
  signUp: "Sign up",
  privacy: "Privacy",
  copyright: "© {year} GossipRent.",
  disclaimer: "Reviews are the opinions of their authors. Identities aren't verified.",
} satisfies Shape<typeof is>;
