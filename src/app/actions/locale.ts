"use server";

import { cookies } from "next/headers";
import { redirect, RedirectType } from "next/navigation";
import { isLocale, LOCALE_COOKIE } from "@/i18n/config";
import { safeRedirectPath } from "@/lib/validation";

const ONE_YEAR_IN_SECONDS = 60 * 60 * 24 * 365;

/**
 * The language switch (LanguageSwitch): remember the chosen language and go
 * back to the page it was used on. A plain form post, so it works without
 * JavaScript; URLs are the same in every language.
 */
export async function setLocale(formData: FormData): Promise<void> {
  const locale = formData.get("locale");
  if (isLocale(locale)) {
    (await cookies()).set(LOCALE_COOKIE, locale, {
      httpOnly: true,
      secure: process.env.NODE_ENV === "production",
      sameSite: "lax",
      path: "/",
      maxAge: ONE_YEAR_IN_SECONDS,
    });
  }
  // Replace: the page in the other language isn't a new step back in history.
  redirect(safeRedirectPath(formData.get("next"), "/"), RedirectType.replace);
}
