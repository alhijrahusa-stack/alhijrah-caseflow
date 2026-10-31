import "server-only";
import type { Tx } from "@/lib/auth";
import { normalizeRegistrySearch, registryPhoneSearchDigits } from "@/lib/registry-filters";

/** The caller must already scope alias c through withStaff/RLS and lifecycle filters. */
export function registrySearchPredicate(tx: Tx, query: string) {
  const normalized = normalizeRegistrySearch(query.trim());
  const like = `%${normalized.replace(/[\\%_]/g, m => `\\${m}`)}%`;
  const rawLike = `%${query.trim().replace(/[\\%_]/g, m => `\\${m}`)}%`;
  const digits = registryPhoneSearchDigits(query);
  // Codes, phone numbers and emails use exact substring matching, never fuzzy identity matching.
  const fuzzy = normalized.length >= 4 && /^[\p{L}\s]+$/u.test(normalized);
  return tx`(c.ref ilike ${rawLike} or c.email ilike ${rawLike}
    or career_gate_private.normalize_search(c.full_name) like ${like}
    ${digits.length >= 3 ? tx`or regexp_replace(c.phone,'[^0-9]','','g') like ${`%${digits}%`}` : tx``}
    ${fuzzy ? tx`or career_gate_private.normalize_search(c.full_name) %> ${normalized}` : tx``}
    or exists (select 1 from document_extractions e where e.client_id=c.id and e.status='succeeded'
      and career_gate_private.normalize_search(e.fields::text) like ${like}))`;
}
