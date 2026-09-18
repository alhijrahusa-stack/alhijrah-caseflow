\set ON_ERROR_STOP on
begin;

insert into public.clients(id,legal_name)
values('28000000-0000-0000-0000-000000000001','P8 Deterministic Review');

insert into public.cases(id,client_id,client_name,case_type,status,service_code)
values('38000000-0000-0000-0000-000000000001','28000000-0000-0000-0000-000000000001','P8 Deterministic Review','I-90','active','I-90');

insert into public.form_findings(
  id,case_id,category,severity,claim,source_references,rule_source,status,created_by_type
) values(
  '88000000-0000-0000-0000-000000000001',
  '38000000-0000-0000-0000-000000000001',
  'CROSS_FORM_CONFLICT','blocker','Synthetic deterministic conflict.','[]'::jsonb,
  jsonb_build_object('engine','cross_form_consistency','deterministic_key',repeat('a',64),'fingerprint',repeat('b',64)),
  'open','deterministic'
);

do $$
begin
  begin
    insert into public.form_findings(
      id,case_id,category,severity,claim,source_references,rule_source,status,created_by_type
    ) values(
      '88000000-0000-0000-0000-000000000002',
      '38000000-0000-0000-0000-000000000001',
      'CROSS_FORM_CONFLICT','blocker','Duplicate deterministic conflict.','[]'::jsonb,
      jsonb_build_object('engine','cross_form_consistency','deterministic_key',repeat('a',64),'fingerprint',repeat('c',64)),
      'open','deterministic'
    );
    raise exception 'duplicate open deterministic finding unexpectedly succeeded';
  exception
    when unique_violation then null;
  end;
end $$;

update public.form_findings
set status='resolved',resolved_at=now()
where id='88000000-0000-0000-0000-000000000001';

insert into public.form_findings(
  id,case_id,category,severity,claim,source_references,rule_source,status,created_by_type
) values(
  '88000000-0000-0000-0000-000000000003',
  '38000000-0000-0000-0000-000000000001',
  'CROSS_FORM_CONFLICT','blocker','Reopened deterministic conflict.','[]'::jsonb,
  jsonb_build_object('engine','cross_form_consistency','deterministic_key',repeat('a',64),'fingerprint',repeat('d',64)),
  'open','deterministic'
),(
  '88000000-0000-0000-0000-000000000004',
  '38000000-0000-0000-0000-000000000001',
  'HUMAN_REVIEW','review','Human finding is outside deterministic uniqueness.','[]'::jsonb,
  jsonb_build_object('deterministic_key',repeat('a',64)),
  'open','human'
);

do $$
begin
  if (select count(*) from public.form_findings
      where case_id='38000000-0000-0000-0000-000000000001'
        and created_by_type='deterministic'
        and status='open'
        and rule_source->>'deterministic_key'=repeat('a',64)) <> 1 then
    raise exception 'deterministic open finding identity is not unique';
  end if;

  if (select count(*) from public.form_findings
      where case_id='38000000-0000-0000-0000-000000000001'
        and status='open') <> 2 then
    raise exception 'resolved/human finding lifecycle was not preserved';
  end if;
end $$;

rollback;
select 'P8_DETERMINISTIC_CASE_REVIEW_PASS' as result;
