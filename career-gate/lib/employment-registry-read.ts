/** Static, RLS-scoped lateral SELECT correlated to the caller's clients alias c.
 * An explicit attestation follows the latest placement context. Confirming a
 * previously pending relocation changes recorded_at and invalidates the prior
 * current stamp, without altering any immutable history. */
export const CURRENT_EMPLOYMENT_CONFIRMATION_SQL = `select ec.* from employment_confirmations ec
  left join lateral (select w.id,w.status,w.recorded_at,w.current_site_code,w.final_site_code from worksite_changes w
    where w.client_id=c.id order by w.created_at desc,w.id desc limit 1) episode on true
  where ec.client_id=c.id and ec.worksite_change_id is not distinct from episode.id
    and ec.worksite_recorded_at is not distinct from episode.recorded_at
    and (episode.id is null or (episode.status='confirmed' and ec.site_code=episode.final_site_code)
      or (episode.status='pending' and c.operational_location<>'worksite_change'
        and ec.site_code=coalesce((select p.site_code from client_preferences p where p.client_id=c.id and p.rank='primary'
          order by p.preference_order,p.id limit 1),episode.current_site_code)))
  order by ec.confirmed_at desc,ec.id desc limit 1`;
