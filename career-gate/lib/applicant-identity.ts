/**
 * Applicant identity correlation — the single definition of "the same person".
 *
 * One contact email may legitimately serve several applicants: a client
 * submitting for a brother, a parent or another relative. So an email on its
 * own never proves an applicant is the same. It proves the same applicant only
 * when a real identity signal agrees with it.
 *
 * This is the rule the database guard
 * (`044_unified_public_applicant_identity.sql`), the public intake duplicate
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

/** At least two independent signals are required for a confirmed duplicate. */
export function hasIdentitySignal(identity: ApplicantIdentity): boolean {
  return [identity.fullName, identity.dateOfBirth, identity.phone && identity.phone.length >= 7 ? identity.phone : null]
    .filter(Boolean).length >= 2;
}

/**
 * Shared-contact rule. A common email, name, birth date, or phone alone is never
 * sufficient. Positive identification requires at least two matching signals.
 * Explicit name or DOB disagreement means a different applicant, even when a
 * relative shares the contact phone.
 */
export function sameApplicant(a: ApplicantIdentity, b: ApplicantIdentity): boolean {
  if (a.fullName && b.fullName && a.fullName !== b.fullName) return false;
  if (a.dateOfBirth && b.dateOfBirth && a.dateOfBirth !== b.dateOfBirth) return false;
  const nameMatches = Boolean(a.fullName && b.fullName && a.fullName === b.fullName);
  const dobMatches = Boolean(a.dateOfBirth && b.dateOfBirth && a.dateOfBirth === b.dateOfBirth);
  const phoneMatches = Boolean(
    a.phone && b.phone && a.phone.length >= 7 && b.phone.length >= 7 && a.phone === b.phone
  );
  return Number(nameMatches) + Number(dobMatches) + Number(phoneMatches) >= 2;
}
