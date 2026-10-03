import type { Shape } from "../../types";
import type is from "../is/validation";

export default {
  fixHighlighted: "Please fix the highlighted fields.",
  invalid: "Check this field.",
  tooLong: { one: "Must be {count} character or fewer.", other: "Must be {count} characters or fewer." },
  noKennitalaInText: "Don't include a kennitala here. ID numbers are never shown on GossipRent.",
  roles: {
    required: "Choose at least one: renter, landlord, or both.",
  },
  kennitala: {
    required: "Enter a kennitala.",
    invalid: "That isn't a valid kennitala. Enter 10 digits, e.g. 123456-7890.",
  },
  name: {
    tooShort: { one: "Name must be at least {count} character.", other: "Name must be at least {count} characters." },
    tooLong: { one: "Name must be {count} character or fewer.", other: "Name must be {count} characters or fewer." },
    personChars: "Use only letters, spaces, hyphens, apostrophes and periods in a name.",
    companyChars: "Use only letters, digits, spaces, &, hyphens, apostrophes and periods in a name.",
    noLink: "A name can't contain a web address.",
  },
  email: {
    invalid: "Enter a valid email address.",
    tooLong: "Email is too long.",
  },
  password: {
    required: "Enter your password.",
    currentRequired: "Enter your current password.",
    tooShort: {
      one: "Password must be at least {count} character.",
      other: "Password must be at least {count} characters.",
    },
    tooLong: {
      one: "Password must be {count} character or fewer.",
      other: "Password must be {count} characters or fewer.",
    },
    mismatch: "The new passwords don't match.",
  },
  city: {
    tooLong: { one: "City must be {count} character or fewer.", other: "City must be {count} characters or fewer." },
  },
  bio: {
    tooLong: { one: "Bio must be {count} character or fewer.", other: "Bio must be {count} characters or fewer." },
  },
  review: {
    kind: "Choose whether you're reviewing a landlord or a renter.",
    subject: "That review target doesn't exist.",
  },
  rating: {
    required: "Pick a star rating from 1 to 5.",
    whole: "Pick a star rating.",
  },
  title: {
    tooShort: { one: "Title must be at least {count} character.", other: "Title must be at least {count} characters." },
    tooLong: { one: "Title must be {count} character or fewer.", other: "Title must be {count} characters or fewer." },
  },
  body: {
    tooShort: {
      one: "Your review must be at least {count} character.",
      other: "Your review must be at least {count} characters.",
    },
    tooLong: {
      one: "Your review must be {count} character or fewer.",
      other: "Your review must be {count} characters or fewer.",
    },
  },
  address: {
    required: "Enter the street address.",
    tooLong: {
      one: "Address must be {count} character or fewer.",
      other: "Address must be {count} characters or fewer.",
    },
  },
  unit: {
    tooLong: {
      one: "Apartment must be {count} character or fewer.",
      other: "Apartment must be {count} characters or fewer.",
    },
  },
  postalCode: {
    required: "Choose a postcode.",
    invalid: "Choose a postcode from the list.",
  },
  description: {
    tooLong: {
      one: "Description must be {count} character or fewer.",
      other: "Description must be {count} characters or fewer.",
    },
  },
  relation: {
    required: "Choose whether you own or rent this place.",
  },
  report: {
    target: "That page can't be reported.",
    reason: "Choose a reason.",
    detailsRequired: "Describe the problem.",
    contactRequired: "Enter your email address so we can reply.",
  },
} satisfies Shape<typeof is>;
