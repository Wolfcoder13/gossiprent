import type { Shape } from "../../types";
import type is from "../is/home";

export default {
  accountClosed: "Your account is closed and the reviews you wrote have been deleted.",
  hero: {
    eyebrow: "Landlord & renter reviews",
    title: "Rent with your eyes open.",
    intro:
      "Renters review their landlords and the places they live. Landlords review their renters. Star ratings plus honest, written reviews — so everyone knows who they're dealing with.",
  },
  search: {
    label: "Search landlords, renters, and properties",
    placeholder: "Search a name, address, or postcode",
    button: "Search",
  },
  stats: {
    reviews: "Reviews",
    landlords: "Landlords",
    renters: "Renters",
    properties: "Properties",
  },
  paths: {
    heading: "What you can review",
    forRenters: "For renters",
    forLandlords: "For landlords",
    landlord: {
      title: "Review your landlord",
      body: "Were repairs quick? Was the deposit returned? Help the next tenant know what they're signing up for.",
      cta: "Find a landlord",
    },
    property: {
      title: "Review the place you rent",
      body: "Heating, damp or mould, noise, laundry, neighbours — share what living there is really like.",
      cta: "Find a property",
    },
    renter: {
      title: "Review your renters",
      body: "How they looked after the home, communication, consideration for the neighbours — recognise great tenants and flag problems.",
      cta: "Find a renter",
    },
  },
  latest: {
    heading: "Latest reviews",
    emptyTitle: "No reviews yet",
    emptyBody:
      "Once people start reviewing landlords, renters, and properties, the newest reviews will show up here.",
    emptyAction: "Be the first — sign up",
  },
  cta: {
    title: "Had a landlord or tenant worth talking about?",
    body: "Create a free account as a renter or a landlord and leave your first review in a couple of minutes.",
    renter: "I'm a renter",
    landlord: "I'm a landlord",
  },
} satisfies Shape<typeof is>;
