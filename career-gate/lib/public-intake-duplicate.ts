import "server-only";
import { sql } from "@/lib/db";
import { normalizeClientEmail } from "@/lib/service";

export type PublicDuplicateMatch = {
  exists: boolean;
  /** Internal stable case reference; never return this from a public unauthenticated endpoint. */
  publicRef: string | null;
  source: "client" | "smart_client" | null;
};

/**
 * One email maps to one Career Gate lifecycle.
 * Approved clients and still-pending Smart Client cases are checked together.
 */
export async function findPublicDuplicateByEmail(emailInput: string | null | undefined): Promise<PublicDuplicateMatch> {
  const email = normalizeClientEmail(emailInput);
  if (!email) return { exists: false, publicRef: null, source: null };

  const db = sql();
  const [client] = await db`
    select ref
    from clients
    where deleted_at is null
      and lower(trim(coalesce(email,'')))=${email}
    order by created_at asc
    limit 1`;
  if (client?.ref) return { exists: true, publicRef: String(client.ref), source: "client" };

  const [pending] = await db`
    select public_ref
    from client_import_cases
    where created_client_id is null
      and lower(trim(coalesce(mapped_draft #>> '{profile,email}','')))=${email}
    order by created_at asc
    limit 1`;
  if (pending?.public_ref) return { exists: true, publicRef: String(pending.public_ref), source: "smart_client" };

  return { exists: false, publicRef: null, source: null };
}
