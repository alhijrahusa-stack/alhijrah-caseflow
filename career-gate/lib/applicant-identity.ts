/**
 * Applicant identity correlation — the single definition of "the same person".
 *
 * One contact email may legitimately serve several applicants: a client
 * submitting for a brother, a parent or another relative. So an email on its
 * own never proves an applicant is the same. It proves the same applicant only
 * when a real identity signal agrees with it.
 *
 * This is the rule the database guard
 * (`042_shared_email_different_applicant.sql`), the public intake duplicate
 * probe and the staff import preview all apply. It lives here, pure
 * and shared, because the one time these paths carried their own copies they
 * disagreed: the public probe allowed a shared email while staff staging still
 * rejected it as a duplicate.
 */

export type ApplicantIdentity = {
  fullName: string | null;
  dateOfBirth: string | null;
  phone: string | null;
};

/** Case- and whitespace-insensitive name key. */
export function normalizeApplicantName(value: string | null | undefined): string | null {
  return value?.trim().toLowerCase().replace(/\s+/g, " ") || null;
}

/** ISO date key; anything that is not a plain YYYY-MM-DD is not a usable signal. */
export function normalizeApplicantDob(value: string | null | undefined): string | null {
  const dob = value?.trim() || "";
  return /^\d{4}-\d{2}-\d{2}$/.test(dob) ? dob : null;
}

/** Digits-only phone key. */
export function normalizeApplicantPhone(value: string | null | undefined): string | null {
  const digits = value?.replace(/\D/g, "") ?? "";
  return digits || null;
}

export function applicantIdentity(input: {
  fullName?: string | null;
  dateOfBirth?: string | null;
  phone?: string | null;
}): ApplicantIdentity {
  return {
    fullName: normalizeApplicantName(input.fullName),
    dateOfBirth: normalizeApplicantDob(input.dateOfBirth),
    phone: normalizeApplicantPhone(input.phone),
  };
}

/** True when the applicant carries at least one signal that could correlate. */
export function hasIdentitySignal(identity: ApplicantIdentity): boolean {
  return Boolean(identity.fullName || identity.dateOfBirth || identity.phone);
}

/**
 * True when two records are the same applicant.
 *
 * Any one agreeing signal is enough: a name, a date of birth, or a phone
 * number. A signal missing on either side is not evidence of difference, so it
 * simply does not vote. With no agreeing signal the two are different
 * applicants who happen to share an email, which is allowed.
 */
export function sameApplicant(a: ApplicantIdentity, b: ApplicantIdentity): boolean {
  if (a.fullName && b.fullName && a.fullName === b.fullName) return true;
  if (a.dateOfBirth && b.dateOfBirth && a.dateOfBirth === b.dateOfBirth) return true;
  if (a.phone && b.phone && a.phone === b.phone) return true;
  return false;
}
