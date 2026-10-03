"use server";

import { getDb, sanitizeDbError } from "@/db";
import { reports } from "@/db/schema";
import { getT } from "@/i18n/server";
import { getCurrentUser } from "@/lib/auth/current-user";
import { clientIp, consumeAttempt, reportLimits } from "@/lib/auth/rate-limit";
import type { FormState } from "@/lib/form-state";
import { formValues, parseForm, reportSchema } from "@/lib/validation";
import { findReportTarget } from "../report/target";

/**
 * The /report form (docs/iceland-spec.md §10): a problem with a review,
 * profile or property, or "someone has an account with my kennitala".
 * Stored for the operator (scripts/admin.ts reports); never shown on the site.
 *
 * Visitors who aren't logged in must leave an email address so they can get
 * a reply; logged-in ones are recorded as the reporter. Rate limited per
 * account and per network. The details may name a kennitala (someone whose
 * identity was claimed has to say whose), so a failed insert is rethrown
 * without its parameters, and nothing here is logged.
 */
export async function createReport(_prev: FormState, formData: FormData): Promise<FormState> {
  const user = await getCurrentUser();
  const t = await getT();
  const contactRequired = [t("validation.report.contactRequired")];
  const loggedOutWithoutEmail = !user && !String(formData.get("contactEmail") ?? "").trim();

  const parsed = parseForm(reportSchema, formData, t);
  if (!parsed.success) {
    const fieldErrors = { ...parsed.state.fieldErrors };
    // Show every problem at once, including the email a logged-out visitor must give.
    if (loggedOutWithoutEmail) fieldErrors.contactEmail ??= contactRequired;
    // target and id are hidden fields: a bad one can only be a broken link, so say that.
    const badTarget = Boolean(fieldErrors.target ?? fieldErrors.id);
    return {
      ...parsed.state,
      message: badTarget ? t("validation.report.target") : parsed.state.message,
      fieldErrors,
    };
  }
  const report = parsed.data;
  const values = formValues(formData);

  if (!user && !report.contactEmail) {
    return {
      status: "error",
      message: t("validation.fixHighlighted"),
      fieldErrors: { contactEmail: contactRequired },
      values,
    };
  }

  // The review, profile or property may have been deleted since the page was opened.
  if (!(await findReportTarget(report.target, report.id))) {
    const message = t("validation.report.target");
    return { status: "error", message, fieldErrors: { target: [message] }, values };
  }

  const attempt = await consumeAttempt(reportLimits(user?.id ?? null, await clientIp()));
  if (attempt.limited) return { status: "error", message: t("errors.tryLater"), values };

  const db = await getDb();
  try {
    await db.insert(reports).values({
      targetKind: report.target,
      targetId: report.id,
      reason: report.reason,
      details: report.details,
      contactEmail: report.contactEmail,
      reporterId: user?.id ?? null,
    });
  } catch (error) {
    // Drizzle's message would include the details and the email address.
    throw sanitizeDbError(error);
  }
  return { status: "success", message: t("report.sent") };
}
