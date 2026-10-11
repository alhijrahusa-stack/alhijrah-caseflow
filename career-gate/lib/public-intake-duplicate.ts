import "server-only";
import { sql } from "@/lib/db";
import { normalizeClientEmail, normalizeClientPhone } from "@/lib/service";

export type PublicDuplicateMatch = {
  exists: boolean;
  sharedEmail: boolean;
  /** Internal stable case reference; never return this from a public unauthenticated endpoint. */
  publicRef: string | null;
  source: "client" | "smart_client" | null;
};

function normalizeCaseNumber(value: string | null | undefined) {
  const ref = value?.trim().toUpperCase() || "";
  return /^CG-[0-9]{4}-[0-9]{6}$/.test(ref) ? ref : null;
}

function normalizeName(value: string | null | undefined) {
  return value?.trim().toLowerCase().replace(/\s+/g, " ") || null;
}

function normalizeDob(value: string | null | undefined) {
  const dob = value?.trim() || "";
  return /^\d{4}-\d{2}-\d{2}$/.test(dob) ? dob : null;
}

/**
 * Duplicate policy:
 * - exact Case Number: always an existing lifecycle;
 * - email + matching applicant identity (name, DOB, or phone): duplicate;
 * - email already used by a different applicant: allowed, but surfaced as sharedEmail.
 */
export async function findPublicDuplicate(args: {
  email?: string | null;
  caseNumber?: string | null;
  fullName?: string | null;
  dateOfBirth?: string | null;
  phone?: string | null;
}): Promise<PublicDuplicateMatch> {
  const email = normalizeClientEmail(args.email);
  const caseNumber = normalizeCaseNumber(args.caseNumber);
  const fullName = normalizeName(args.fullName);
  const dateOfBirth = normalizeDob(args.dateOfBirth);
  const phone = normalizeClientPhone(args.phone);

  if (!email && !caseNumber) return { exists: false, sharedEmail: false, publicRef: null, source: null };
  const db = sql();

  if (caseNumber) {
    const [clientByRef] = await db`
      select ref
      from clients
      where deleted_at is null and upper(ref)=${caseNumber}
      limit 1`;
    if (clientByRef?.ref) return { exists: true, sharedEmail: false, publicRef: String(clientByRef.ref), source: "client" };

    const [pendingByRef] = await db`
      select public_ref
      from client_import_cases
      where upper(public_ref)=${caseNumber}
      order by created_at asc
      limit 1`;
    if (pendingByRef?.public_ref) {
      return { exists: true, sharedEmail: false, publicRef: String(pendingByRef.public_ref), source: "smart_client" };
    }
  }

  if (!email) return { exists: false, sharedEmail: false, publicRef: null, source: null };

  const hasIdentity = Boolean(fullName || dateOfBirth || phone);
  if (hasIdentity) {
    const [clientByEmail] = await db`
      select ref
      from clients
      where deleted_at is null
        and lower(trim(coalesce(email,'')))=${email}
        and (
          (${fullName}::text is not null and lower(regexp_replace(trim(coalesce(full_name,'')),'\\s+',' ','g'))=${fullName})
          or (${dateOfBirth}::text is not null and date_of_birth::text=${dateOfBirth})
          or (${phone}::text is not null and regexp_replace(coalesce(phone,''),'\\D','','g')=${phone})
        )
      order by created_at asc
      limit 1`;
    if (clientByEmail?.ref) return { exists: true, sharedEmail: false, publicRef: String(clientByEmail.ref), source: "client" };

    const [pendingByEmail] = await db`
      select public_ref
      from client_import_cases
      where lower(trim(coalesce(mapped_draft #>> '{profile,email}','')))=${email}
        and (
          (${fullName}::text is not null and lower(regexp_replace(trim(coalesce(mapped_draft #>> '{profile,full_name}','')),'\\s+',' ','g'))=${fullName})
          or (${dateOfBirth}::text is not null and coalesce(mapped_draft #>> '{profile,date_of_birth}','')=${dateOfBirth})
          or (${phone}::text is not null and regexp_replace(coalesce(mapped_draft #>> '{profile,phone}',''),'\\D','','g')=${phone})
        )
      order by created_at asc
      limit 1`;
    if (pendingByEmail?.public_ref) {
      return { exists: true, sharedEmail: false, publicRef: String(pendingByEmail.public_ref), source: "smart_client" };
    }
  }

  const [sharedClient] = await db`
    select ref
    from clients
    where deleted_at is null and lower(trim(coalesce(email,'')))=${email}
    order by created_at asc
    limit 1`;
  if (sharedClient?.ref) {
    return { exists: false, sharedEmail: true, publicRef: String(sharedClient.ref), source: "client" };
  }

  const [sharedPending] = await db`
    select public_ref
    from client_import_cases
    where lower(trim(coalesce(mapped_draft #>> '{profile,email}','')))=${email}
    order by created_at asc
    limit 1`;
  if (sharedPending?.public_ref) {
    return { exists: false, sharedEmail: true, publicRef: String(sharedPending.public_ref), source: "smart_client" };
  }

  return { exists: false, sharedEmail: false, publicRef: null, source: null };
}
