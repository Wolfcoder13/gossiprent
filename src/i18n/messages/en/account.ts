import type { Shape } from "../../types";
import type is from "../is/account";

export default {
  dashboard: {
    greeting: "Hi, {name}",
    signedInAs: "Signed in as {email}",
    viewProfile: "View public profile",
    quickActions: "Quick actions",
    reviewLandlord: "Review a landlord",
    reviewRenter: "Review a renter",
    reviewProperty: "Review a property",
    addProperty: "Add a property",
    addPlaceYouRent: "Add the place you rent",
    showing: "Showing the latest {shown} of {total}.",
    keptName: "People had already reviewed you, so your page keeps the name they used. If it's wrong, {report}.",
    report: "report it",
  },
  aboutYou: {
    heading: "Reviews about you",
    asLandlord: "Reviews about you as a landlord",
    asRenter: "Reviews about you as a renter",
    cantRemove: "You can't remove reviews other people write about you, but you can report one that breaks the rules.",
    seeAll: "See them all on your profile",
    emptyLandlord: {
      title: "No renters have reviewed you yet",
      body: "When your renters review you, it'll show up here. Share your profile link with them!",
    },
    emptyRenter: {
      title: "No landlords have reviewed you yet",
      body: "When your landlords review you, it'll show up here.",
    },
  },
  propertyReviews: {
    heading: "Reviews of your properties",
    empty: "No property reviews yet",
  },
  written: {
    heading: "Reviews you've written",
    empty: "You haven't written any reviews yet",
    findLandlord: "Find your landlord",
    findRenter: "Find a renter to review",
  },
  properties: {
    managed: "Your properties",
    managedEmptyTitle: "You haven't listed any properties",
    managedEmptyBody:
      "Add the homes you rent out so your renters can review them. If a renter already listed one, open it and choose “I manage this property”.",
    addedAsRenter: "Places you added as a renter",
    added: "Properties you added",
    addedEmptyTitle: "You haven't added any properties",
    addedEmptyBody: "Can't find the place you rent? Add it so you can review it.",
    add: "Add a property",
  },
  roles: {
    heading: "Your roles",
    intro: "Rent a home and also rent one out? Have both. You get a separate rating for each.",
    add: {
      landlord: "I'm also a landlord",
      renter: "I'm also a renter",
    },
    remove: {
      landlord: "Remove landlord role",
      renter: "Remove renter role",
    },
    confirmRemove: {
      landlord:
        "Remove the landlord role? Your properties will no longer be linked to you, and nobody else can link you to them again. You can add the role back any time and link a property to yourself again with “I manage this property” on its page.",
      renter: "Remove the renter role? You can add it back any time.",
    },
    kept: {
      landlord: "Renters have reviewed you, so this role stays.",
      renter: "Landlords have reviewed you, so this role stays.",
    },
    notA: {
      landlord: "Not a landlord",
      renter: "Not a renter",
    },
    saving: "Saving…",
    invalid: "Something went wrong. Please try again.",
    needOne: "You need at least one role. Add the other one first.",
    reviewedAs: {
      landlord: "People have reviewed you as a landlord, so you can't remove that role.",
      renter: "People have reviewed you as a renter, so you can't remove that role.",
    },
    added: {
      landlord: "Done. You're now listed as a landlord too.",
      renter: "Done. You're now listed as a renter too.",
    },
    removed: {
      landlord: "Done. You're no longer listed as a landlord.",
      renter: "Done. You're no longer listed as a renter.",
    },
    back: "Back to write your review",
  },
  profile: {
    heading: "Your profile",
    intro: "This is what people see on your public page.",
    kennitala: "Your kennitala: {kennitala}",
    kennitalaNote: "Only you can see it here. It's never shown publicly.",
    name: "Name",
    city: "City",
    bio: "Bio",
    bioHint: {
      one: "A sentence or two about you. Max {count} character.",
      other: "A sentence or two about you. Max {count} characters.",
    },
    save: "Save profile",
    saving: "Saving…",
    saved: "Profile saved.",
    nameLocked: "Your name can't be changed after people have reviewed you. If it's wrong, report it.",
    nameLockedHint: "Your name can't be changed after people have reviewed you. If it's wrong, {report}.",
    report: "report it",
  },
  password: {
    heading: "Password & sessions",
    intro: "Changing your password signs you out everywhere else.",
    current: "Current password",
    newPassword: "New password",
    confirm: "Confirm new password",
    submit: "Change password",
    pending: "Changing…",
    notCurrent: "That isn't your current password.",
    changed: "Password changed. You've been signed out on your other devices.",
    signOutOthers: "Sign out other devices",
    signingOut: "Signing out…",
    signedOut: "You've been signed out on all your other devices.",
  },
  close: {
    heading: "Close account",
    body: "Deletes your login and the reviews you wrote. Reviews other people wrote about you stay on the site.",
    again: "If you sign up again with the same kennitala, you get your page back.",
    button: "Close my account",
    pending: "Closing…",
    confirm:
      "Close your account? Your login and the reviews you wrote will be permanently deleted. Reviews other people wrote about you stay on the site.",
  },
} satisfies Shape<typeof is>;
