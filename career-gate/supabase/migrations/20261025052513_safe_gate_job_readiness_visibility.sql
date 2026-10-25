CREATE SCHEMA IF NOT EXISTS career_gate_private;
REVOKE ALL ON SCHEMA career_gate_private FROM PUBLIC, anon;
GRANT USAGE ON SCHEMA career_gate_private TO authenticated, service_role;

CREATE OR REPLACE FUNCTION career_gate_private.has_ready_gate_job_account(cid uuid)
RETURNS boolean
LANGUAGE sql
STABLE SECURITY DEFINER
SET search_path = ''
AS $function$
  SELECT public.cg_can_access_client(cid)
    AND EXISTS (
      SELECT 1 FROM public.gate_job_accounts a
      WHERE a.assigned_to_client_id = cid
        AND a.status = 'READY'
    );
$function$;

REVOKE ALL ON FUNCTION career_gate_private.has_ready_gate_job_account(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION career_gate_private.has_ready_gate_job_account(uuid) TO authenticated, service_role;
