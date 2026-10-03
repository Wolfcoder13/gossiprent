import type { Shape } from "../../types";
import type is from "../is/errors";

export default {
  notFound: {
    title: "We couldn't find that page",
    body: "The landlord, renter, or property you're looking for may have been removed, or the link is wrong.",
    home: "Go home",
    search: "Search",
  },
  generic: {
    title: "Something went wrong",
    body: "Sorry about that. Please try again in a moment.",
    reference: "Error reference: {digest}",
    retry: "Try again",
  },
  tooManyAttempts: "Too many attempts. Please wait a few minutes and try again.",
  tryLater: "Too many attempts. Please try again later.",
  logInAgain: "Please log in again.",
  setup: {
    eyebrow: "Almost there",
    title: "Connect a database",
    intro:
      "GossipRent is deployed, but it needs a Postgres database to store accounts and reviews. It takes about a minute:",
    storage: "Open this project in the Vercel dashboard and go to the {storage} tab.",
    create: "Choose {create}, pick {neon}, and connect it to this project. This sets {env} for you.",
    redeploy: "{redeploy}. The tables are created automatically during the build.",
    anyPostgres: "Any Postgres database works — just set {env} in your project's environment variables.",
  },
} satisfies Shape<typeof is>;
