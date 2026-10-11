import "server-only";
import { sql } from "@/lib/db";
import { normalizeClientEmail } from "@/lib/service";

export type PublicDuplicateMatch = {
  exists: boolean;
  /** Internal stable case reference; never return this from a public unauthenticated endpoint. */
  publicRef: string | null;
  source: "client" | "smart_client" | null;
};

function normalizeCaseNumber(value: string | null | undefined) {
  const ref = value?.trim().toUpperCase() || "";
  return /^CG-[0-9]{4}-[0-9]{6}$/.test(ref) ? ref : null;
}

/**
 * One Career Gate identity maps to one lifecycle.
 * A matching case number OR email is treated as an existing application.
 */
export async function findPublicDuplicate(args: {
  email?: string | null;
  caseNumber?: string | null;
}): Promise<PublicDuplicateMatch> {
  const email = normalizeClientEmail(args.email);
  const caseNumber = normalizeCaseNumber(args.caseNumber);
  if (!email && !caseNumber) return { exists: false, publicRef: null, source: null };

  const db = sql();

  if (caseNumber) {
    const [clientByRef] = await db`
      select ref
      from clients
      where deleted_at is null and upper(ref)=${caseNumber}
      limit 1`;
    if (clientByRef?.ref) return { exists: true, publicRef: String(clientByRef.ref), source: "client" };

    const [pendingByRef] = await db`
      select public_ref
      from client_import_cases
      where upper(public_ref)=${caseNumber}
      order by created_at asc
      limit 1`;
    if (pendingByRef?.public_ref) {
      return { exists: true, publicRef: String(pendingByRef.public_ref), source: "smart_client" };
    }
  }

  if (email) {
    const [clientByEmail] = await db`
      select ref
      from clients
      where deleted_at is null
        and lower(trim(coalesce(email,'')))=${email}
      order by created_at asc
      limit 1`;
    if (clientByEmail?.ref) return { exists: true, publicRef: String(clientByEmail.ref), source: "client" };

    const [pendingByEmail] = await db`
      select public_ref
      from client_import_cases
      where lower(trim(coalesce(mapped_draft #>> '{profile,email}','')))=${email}
      order by created_at asc
      limit 1`;
    if (pendingByEmail?.public_ref) {
      return { exists: true, publicRef: String(pendingByEmail.public_ref), source: "smart_client" };
    }
  }

  return { exists: false, publicRef: null, source: null };
}

export async function findPublicDuplicateByEmail(emailInput: string | null | undefined) {
  return findPublicDuplicate({ email: emailInput });
}
