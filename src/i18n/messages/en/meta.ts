import type { Shape } from "../../types";
import type is from "../is/meta";

export default {
  title: "GossipRent — Landlord & renter reviews",
  description:
    "Renters review their landlords and the places they live. Landlords review their renters. Star ratings and honest, written reviews.",
  pages: {
    landlords: "Landlords",
    renters: "Renters",
    properties: "Properties",
    search: "Search",
    login: "Log in",
    signup: "Sign up",
    dashboard: "My account",
    newProperty: "Add a property",
    newReview: "Write a review",
    report: "Report a problem",
    privacy: "Privacy",
  },
  landlordProfile: {
    title: "{name} — landlord reviews",
    description: "Reviews of {name}, a landlord on GossipRent.",
    notFound: "Landlord not found",
  },
  renterProfile: {
    title: "{name} — renter reviews",
    description: "Reviews of {name}, a renter on GossipRent.",
    notFound: "Renter not found",
  },
  property: {
    title: "{address} — reviews",
    description: "Renter reviews of {address}.",
    notFound: "Property not found",
  },
} satisfies Shape<typeof is>;
