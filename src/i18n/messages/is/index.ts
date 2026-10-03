import common from "./common";
import nav from "./nav";
import home from "./home";
import browse from "./browse";
import profile from "./profile";
import reviews from "./reviews";
import properties from "./properties";
import auth from "./auth";
import account from "./account";
import lookup from "./lookup";
import report from "./report";
import privacy from "./privacy";
import validation from "./validation";
import meta from "./meta";
import errors from "./errors";

const messages = {
  common,
  nav,
  home,
  browse,
  profile,
  reviews,
  properties,
  auth,
  account,
  lookup,
  report,
  privacy,
  validation,
  meta,
  errors,
} as const;

export default messages;
