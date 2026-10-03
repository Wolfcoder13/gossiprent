import type { Shape } from "../../types";
import type is from "../is/common";

export default {
  optional: "(optional)",
  roles: {
    landlord: "Landlord",
    renter: "Renter",
    property: "Property",
  },
  noAccount: "No account",
  kennitala: {
    hint: "10 digits, e.g. 123456-7890",
  },
  rating: {
    stars: "Rated {rating} out of 5 stars",
    none: "No ratings yet",
    reviewCount: { one: "{count} review", other: "{count} reviews" },
    noReviews: "No reviews yet",
    breakdown: "Rating breakdown",
    starCount: { one: "{count} star", other: "{count} stars" },
    reviewsUnit: { one: "review", other: "reviews" },
  },
  starInput: {
    legend: "Your rating",
    hint: "Tap a star",
    option: { one: "{count} star ({label})", other: "{count} stars ({label})" },
    terrible: "Terrible",
    poor: "Poor",
    okay: "Okay",
    good: "Good",
    excellent: "Excellent",
  },
  pagination: {
    label: "Pagination",
    previous: "← Previous",
    next: "Next →",
    status: "Page {page} of {pageCount}",
  },
  deleteReview: {
    button: "Delete",
    pending: "Deleting…",
    confirm: "Delete this review? This can't be undone.",
  },
  address: {
    apartment: "{address}, apt. {unit}",
    unit: "{address}, {unit}",
  },
} satisfies Shape<typeof is>;
