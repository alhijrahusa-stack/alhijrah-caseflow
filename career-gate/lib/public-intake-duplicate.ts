import "server-only";
import { sql } from "@/lib/db";
import { normalizeClientEmail, type Tx } from "@/lib/service";
import { applicantIdentity, sameApplicant } from "@/lib/applicant-identity";

export type PublicDuplicateMatch = {
  exists: boolean;
  sharedEmail: boolean;
  /** Internal only. Never disclose an existing reference to a public probe. */
  publicRef: string | null;
  source: "client" | "smart_client" | null;
};

function caseNumber(value: string | null | undefined) {
  const ref = value?.trim().toUpperCase() || "";
  return /^CG-[0-9]{4}-[0-9]{6}$/.test(ref) ? ref : null;
}

/**
 * One applicant identity decision for the browser probe and the locked final
 * staging transaction. The exact reference always wins. Shared email alone
 * is not a duplicate; evidence must satisfy sameApplicant().
 */
export async function findPublicDuplicate(args: {
  email?: string | null;
  caseNumber?: string | null;
  fullName?: string | null;
  dateOfBirth?: string | null;
  phone?: string | null;
}, tx?: Tx): Promise<PublicDuplicateMatch> {
  const email = normalizeClientEmail(args.email);
  const ref = caseNumber(args.caseNumber);
  const identity = applicantIdentity({
    fullName: args.fullName,
    dateOfBirth: args.dateOfBirth,
    phone: args.phone,
  });
  const none: PublicDuplicateMatch = { exists: false, sharedEmail: false, publicRef: null, source: null };
  if (!email && !ref) return none;
  const db = tx ?? sql();

  if (ref) {
    const [canonical] = await db`select ref from clients where upper(ref)=${ref} limit 1`;
    if (canonical) return { exists: true, sharedEmail: false, publicRef: String(canonical.ref), source: "client" };
    const [staged] = await db`select public_ref from client_import_cases where upper(public_ref)=${ref} limit 1`;
    if (staged) return { exists: true, sharedEmail: false, publicRef: String(staged.public_ref), source: "smart_client" };
  }
  if (!email) return none;

  const canonical = await db`
    select ref,full_name,date_of_birth::text as date_of_birth,phone
    from clients
    where deleted_at is null and lower(trim(coalesce(email,'')))=${email}`;
  const staged = await db`
    select public_ref,
           mapped_draft #>> '{profile,full_name}' as full_name,
           mapped_draft #>> '{profile,date_of_birth}' as date_of_birth,
           mapped_draft #>> '{profile,phone}' as phone
    from client_import_cases
    where lower(trim(coalesce(mapped_draft #>> '{profile,email}','')))=${email}`;

  for (const row of canonical) {
    if (sameApplicant(identity, applicantIdentity({
      fullName: row.full_name, dateOfBirth: row.date_of_birth, phone: row.phone,
    }))) {
      return { exists: true, sharedEmail: false, publicRef: String(row.ref), source: "client" };
    }
  }
  for (const row of staged) {
    if (sameApplicant(identity, applicantIdentity({
      fullName: row.full_name, dateOfBirth: row.date_of_birth, phone: row.phone,
    }))) {
      return { exists: true, sharedEmail: false, publicRef: String(row.public_ref), source: "smart_client" };
    }
  }
  return { ...none, sharedEmail: canonical.length > 0 || staged.length > 0 };
}
