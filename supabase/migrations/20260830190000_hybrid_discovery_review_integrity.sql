begin;

alter table public.ai_review_runs add column if not exists tool_names text[] not null default '{}'::text[];
alter table public.ai_review_runs add column if not exists input_snapshot jsonb;
alter table public.ai_review_runs add column if not exists input_snapshot_sha256 text check(input_snapshot_sha256 is null or input_snapshot_sha256~'^[0-9a-f]{64}$');
alter table public.ai_review_runs add column if not exists output_sha256 text check(output_sha256 is null or output_sha256~'^[0-9a-f]{64}$');
alter table public.ai_review_runs add column if not exists human_review_required boolean not null default true check(human_review_required=true);
alter table public.ai_findings add column if not exists finding_key text;
alter table public.ai_findings add column if not exists source_snapshot_sha256 text check(source_snapshot_sha256 is null or source_snapshot_sha256~'^[0-9a-f]{64}$');
create unique index if not exists ai_findings_run_key_unique on public.ai_findings(review_run_id,finding_key) where finding_key is not null;

create or replace function public.protect_ai_review_integrity()
returns trigger language plpgsql security definer set search_path=public,pg_temp as $$
declare run public.ai_review_runs%rowtype;
begin
  select * into run from public.ai_review_runs where id=new.review_run_id;
  if not found or run.case_id<>new.case_id then raise exception 'AI finding is outside its pinned review case'; end if;
  if new.requires_owner_approval is distinct from true then raise exception 'AI finding requires Owner review'; end if;
  if jsonb_typeof(new.source_references)<>'array' or jsonb_array_length(new.source_references)=0 then raise exception 'AI finding requires traceable sources'; end if;
  if new.source_snapshot_sha256 is null or new.source_snapshot_sha256 is distinct from run.input_snapshot_sha256 then raise exception 'AI finding source snapshot mismatch'; end if;
  if new.participant_id is not null and not exists(select 1 from public.case_people where case_id=new.case_id and person_id=new.participant_id) then raise exception 'AI finding participant is outside its case'; end if;
  if new.form_instance_id is not null and not exists(select 1 from public.form_instances where id=new.form_instance_id and case_id=new.case_id) then raise exception 'AI finding form is outside its case'; end if;
  if tg_op='UPDATE' and (old.review_run_id,old.case_id,old.participant_id,old.form_instance_id,old.finding_key,old.category,old.severity,old.field_path,old.claim,old.source_references,old.source_snapshot_sha256,old.reason,old.suggested_action,old.confidence,old.requires_owner_approval)
    is distinct from (new.review_run_id,new.case_id,new.participant_id,new.form_instance_id,new.finding_key,new.category,new.severity,new.field_path,new.claim,new.source_references,new.source_snapshot_sha256,new.reason,new.suggested_action,new.confidence,new.requires_owner_approval)
  then raise exception 'AI finding evidence and claim are immutable'; end if;
  return new;
end;
$$;

create or replace function public.protect_ai_run_integrity()
returns trigger language plpgsql set search_path=public,pg_temp as $$
begin
  if tg_op='UPDATE' and (old.case_id,old.background_job_id,old.provider,old.model_version,old.workflow_version,old.requested_by,old.approved_by,old.started_at,old.tool_names,old.input_snapshot,old.input_snapshot_sha256,old.human_review_required)
    is distinct from (new.case_id,new.background_job_id,new.provider,new.model_version,new.workflow_version,new.requested_by,new.approved_by,new.started_at,new.tool_names,new.input_snapshot,new.input_snapshot_sha256,new.human_review_required)
    and old.input_snapshot_sha256 is not null
  then raise exception 'AI review input provenance is immutable'; end if;
  if new.input_snapshot is not null and (new.input_snapshot_sha256 is null or jsonb_typeof(new.input_snapshot)<>'object') then raise exception 'AI review snapshot requires a pinned digest'; end if;
  if new.status='review_required' and (new.input_snapshot_sha256 is null or new.output_sha256 is null) then raise exception 'Completed AI review requires input and output digests'; end if;
  return new;
end;
$$;

do $$ begin
  if not exists(select 1 from pg_trigger where tgname='ai_findings_integrity' and tgrelid='public.ai_findings'::regclass and not tgisinternal) then
    create trigger ai_findings_integrity before insert or update on public.ai_findings for each row execute function public.protect_ai_review_integrity();
  end if;
  if not exists(select 1 from pg_trigger where tgname='ai_review_runs_integrity' and tgrelid='public.ai_review_runs'::regclass and not tgisinternal) then
    create trigger ai_review_runs_integrity before insert or update on public.ai_review_runs for each row execute function public.protect_ai_run_integrity();
  end if;
end $$;

comment on column public.ai_review_runs.input_snapshot is 'Exact case-scoped read-tool results sent to the configured AI provider; pinned before provider execution.';
comment on column public.ai_findings.source_snapshot_sha256 is 'Digest of the immutable review input snapshot supporting this finding. AI output never mutates canonical data without human action.';

commit;
