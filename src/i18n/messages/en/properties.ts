import type { Shape } from "../../types";
import type is from "../is/properties";

export default {
  list: {
    title: "Properties",
    description: "Homes and apartments, reviewed by the renters who've lived there.",
    add: "Add a property",
    searchPlaceholder: "Search by address, postcode or town",
    count: { one: "{count} property", other: "{count} properties" },
    matching: { one: "{count} property matching “{query}”", other: "{count} properties matching “{query}”" },
    clearSearch: "Clear search",
    noMatchTitle: "No properties match “{query}”",
    noMatchBody: "Try just the street name or the city — or add it if it's not listed yet.",
    emptyTitle: "No properties yet",
    emptyBody: "Add the place you rent so you (and others) can review it.",
    addRented: "Add the place you rent",
  },

  new: {
    title: "Add a property",
    intro: {
      both: "List a home you own or manage, or add the place you rent so you can review it. Please check it isn't already listed first.",
      landlord:
        "List a home or apartment you own or manage. It will appear on your landlord profile so your renters can review it.",
      renter:
        "Add the place you rent (or used to rent) so you can review it. Please check it isn't already listed first.",
    },
  },

  form: {
    address: "Address",
    addressHint: "e.g. Njálsgata 23",
    unit: "Apartment",
    unitHint: "e.g. 0201 (floor 02, flat 01) or 2nd floor left",
    postalCode: "Postcode",
    choosePostcode: "Choose a postcode",
    description: "Short description",
    descriptionPlaceholder: "e.g. Three-room apartment on the second floor, shared laundry",
    relation: {
      legend: "This is a place I…",
      own: "Own or manage",
      ownHint: "It will show on your landlord profile.",
      rent: "Rent or used to rent",
      rentHint: "So you can review it as a renter.",
    },
    landlord: {
      kennitala: "Landlord's kennitala",
      kennitalaHint:
        "If you know it: their Icelandic ID number, 10 digits, e.g. 123456-7890. It links the property to the landlord's page and is never shown on GossipRent.",
      check: "Check",
      checking: "Checking…",
      found: "This kennitala belongs to {name}",
      notFound: "Nobody with this kennitala is on GossipRent yet. Enter the landlord's name to add them.",
      company: "This is a company's kennitala.",
      born: "Date of birth: {date}",
      name: "Landlord's name",
      nameHint: "Shown on their page. Use the name they usually go by, or the company's name.",
      confirm: "I've checked that this kennitala is right",
    },
    submit: "Add property",
    submitting: "Adding…",
  },

  page: {
    listed: "Listed {date}",
    landlord: "Landlord: {name}",
    unconfirmed: "Added by a renter, not confirmed",
    noLandlord: "No landlord linked",
    claim: "I manage this property",
    unlink: "Not my property",
    unlinkConfirm:
      "Remove yourself as the landlord of this property? The listing and its reviews stay on GossipRent.",
    saving: "Saving…",
    report: "Report this page",
    editReview: "Edit your review",
    reviewThis: "Review this property",
    reviewsIntro: "What renters say about living here.",
    noReviewsTitle: "No reviews for this property yet",
    noReviewsBody: "Live here, or used to? Be the first to share what it's like.",
    ownerNote: "You're the landlord for this property. Reviews from your renters appear here.",
  },

  relink: {
    link: "Link the landlord",
    change: "Change the landlord",
    intro:
      "You added this property, so you can link its landlord by kennitala, or leave the field empty to remove the link. Once the landlord has an account, only they can change it.",
    save: "Save landlord",
    saving: "Saving…",
  },

  messages: {
    logIn: "Please log in to add a property.",
    alreadyListed: "This property is already listed on GossipRent.",
    alreadyListedClaimable:
      "This property is already listed, without a landlord. If you manage it, you can claim it.",
    goToListing: "Go to the existing listing",
    goToClaim: "Go to the listing to claim it",
    onlyLandlordsOwn: "Only landlords can list a property as their own.",
    ownKennitala: "That's your own kennitala. You can't be the landlord of a place you rent.",
    minor: "This kennitala can't be linked as a landlord.",
    nameRequired: "Nobody with this kennitala is on GossipRent yet. Enter the landlord's name.",
    confirmRequired: "Tick the box to confirm the kennitala is right.",
    unknownAction: "Something went wrong. Reload the page and try again.",
    missing: "That property doesn't exist.",
    claimed: "Done. You're now listed as this property's landlord.",
    claimNotLandlord: "Only landlords can claim a property.",
    claimTaken: "Another landlord already manages this property.",
    claimReviewed:
      "You've reviewed this property as a renter, so you can't also be its landlord. Delete your review first.",
    unlinked: "Done. You're no longer listed as this property's landlord.",
    unlinkNotListed: "You aren't listed as this property's landlord.",
    relinked: "Done. The property's landlord was changed.",
    relinkCleared: "Done. The property no longer has a landlord linked.",
    relinkNotCreator: "You can only change the landlord of a property you added.",
    relinkHasAccount:
      "The landlord has a GossipRent account, so only they can remove the link (with “Not my property”). If it's wrong, report this page.",
  },
} satisfies Shape<typeof is>;
