import type { Shape } from "../../types";
import type is from "../is/lookup";

export default {
  heading: "Look up a kennitala",
  intro:
    "Find someone's page by their kennitala (Icelandic ID number), even when several people share a name. The number itself is never shown.",
  loggedOutHint: "You need to {logIn} to look up a kennitala.",
  logInLink: "log in",
  field: "Kennitala",
  submit: "Look up",
  pending: "Looking up…",
  logInRequired: "Log in to look up a kennitala.",
  logIn: "Log in",
  notFound: "Nobody with this kennitala has been reviewed yet.",
  writeFirst: "Write the first review",
  useFormBelow: "To look up a kennitala, use the form below.",
} satisfies Shape<typeof is>;
