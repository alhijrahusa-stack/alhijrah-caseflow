-- Synthetic population for performance measurement.
--
-- PURPOSE
--   The end-to-end seed (e2e/seed.sql) contains staff only, so nothing in it
--   exposes how a page behaves against an operating caseload. This file builds
--   a representative one so that route latency, main-thread blocking and query
--   plans can be measured rather than guessed.
--
-- SAFETY
--   Every row it creates is named 'TEST ...' and addressed at example.invalid.
--   Run it ONLY against a disposable local database. It is not idempotent by
--   design: it is meant for a database built fresh by e2e/run.sh, and it
--   refuses to run if a non-synthetic client is already present, so it cannot
--   be pointed at a real one by accident.
--
-- USAGE
--   psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -f scripts/perf-seed.sql
--   Then: scripts/measure.mjs (server) and scripts/profile-browser.mjs (browser).

\set clients 2000

do $$
begin
  if exists (select 1 from public.clients where full_name not like 'TEST %') then
    raise exception 'refusing to seed: this database holds non-synthetic clients';
  end if;
end $$;

-- The product's own status-override escape hatch, so the synthetic population
-- can span the whole pipeline instead of only the valid entry states. No
-- trigger, policy or constraint is altered.
set cg.status_override = 'perf-seed';

insert into clients (source, full_name, phone, email, current_status, next_step, assigned_staff,
                     pipeline_stage, city, state, zip, street, created_at, preferred_location)
select
  (array['public_intake','staff_manual'])[1 + (g % 2)],
  'TEST Client ' || g,
  '313555' || lpad((g % 10000)::text, 4, '0'),
  'test.client.' || g || '@example.invalid',
  (array['new_intake','needs_review','ready_to_apply','application_in_progress','assessment_required',
         'appointment_required','appointment_scheduled','i9_available','post_hire_tasks',
         'ready_for_first_day','completed'])[1 + (g % 11)],
  'TEST next step ' || g,
  case when g % 10 < 6
       then (select id from staff order by id limit 1 offset (g % greatest((select count(*) from staff), 1)))
       else null end,
  (array['portal_intake','no_amazon_account','interview_scheduled','interview_passed',
         'amazon_account_waiting_job'])[1 + (g % 5)],
  (array['Detroit','Romulus','Pontiac','Hamtramck','Dearborn'])[1 + (g % 5)],
  'MI', '481' || lpad((g % 100)::text, 2, '0'), g || ' TEST ST',
  now() - (g || ' hours')::interval,
  (array['Detroit','Romulus','Pontiac'])[1 + (g % 3)]
from generate_series(1, :clients) g;

insert into documents (client_id, doc_type, storage_path, file_name, mime_type, size_bytes, status, uploaded_at)
select c.id, (array['photo_id','work_authorization','social_security_card','resume','other'])[1 + (k % 5)],
  'test/' || c.id || '/' || k, 'test-' || k || '.png', 'image/png', 10240,
  (array['pending','processing','needs_review','needs_reupload','pending','processing'])[1 + ((k * 7 + length(c.full_name)) % 6)],
  now() - (k || ' days')::interval
from clients c, generate_series(1, 3) k
where c.full_name like 'TEST Client %' and (length(c.full_name) + k) % 6 <> 0;

insert into tasks (client_id, title, description, assigned_to, due_at, status, completed_at, completed_by, created_at)
select c.id, 'TEST task ' || k, 'TEST description ' || k, c.assigned_staff,
  case when k % 3 = 0 then now() - ((k * 3) || ' days')::interval else now() + (k || ' days')::interval end,
  (array['pending','in_progress','completed'])[1 + (k % 3)],
  case when (k % 3) = 2 then now() - '1 day'::interval end,
  case when (k % 3) = 2 then c.assigned_staff end,
  now() - (k || ' days')::interval
from clients c, generate_series(1, 2) k
where c.full_name like 'TEST Client %';

-- One appointment per client. resource_key and the time offset are both derived
-- from the row number because appointments carry a no-overlap exclusion
-- constraint per resource.
insert into appointments (client_id, appointment_type, scheduled_at, ends_at, location, status, resource_key, created_at)
select c.id, (array['intake','assessment','i9','orientation'])[1 + (c.rn % 4)],
  now() + ((c.rn * 20) || ' minutes')::interval,
  now() + ((c.rn * 20 + 15) || ' minutes')::interval,
  'TEST office', (array['scheduled','confirmed','rescheduled','attended','cancelled'])[1 + (c.rn % 5)],
  'office-' || (c.rn % 8), now()
from (select id, row_number() over (order by created_at) as rn
      from clients where full_name like 'TEST Client %') c;

insert into notes (client_id, note, staff_id, created_at)
select c.id, 'TEST note ' || k || ' — synthetic content for measurement only.',
  coalesce(c.assigned_staff, (select id from staff order by id limit 1)), now() - (k || ' hours')::interval
from clients c, generate_series(1, 3) k
where c.full_name like 'TEST Client %';

insert into contacts (client_id, method, result, staff_id, created_at)
select c.id, (array['call','whatsapp','email','in_person'])[1 + (k % 4)],
  (array['reached','no_answer','voicemail'])[1 + (k % 3)],
  coalesce(c.assigned_staff, (select id from staff order by id limit 1)), now() - (k || ' days')::interval
from clients c, generate_series(1, 2) k
where c.full_name like 'TEST Client %';

insert into followups (client_id, due_date, reason, status, completed_at, completed_by, created_at)
select c.id,
  case when k % 2 = 0 then (now() - '5 days'::interval)::date else (now() + '5 days'::interval)::date end,
  'TEST followup ' || k, (array['open','open','completed'])[1 + (k % 3)],
  case when (k % 3) = 2 then now() end,
  case when (k % 3) = 2 then (select id from staff order by id limit 1) end,
  now()
from clients c, generate_series(1, 1) k
where c.full_name like 'TEST Client %';

insert into employment_history (client_id, company, job_title, from_date, to_date)
select c.id, 'TEST Employer ' || k, 'TEST Role ' || k,
  (now() - ((k + 2) || ' years')::interval)::date, (now() - (k || ' years')::interval)::date
from clients c, generate_series(1, 2) k
where c.full_name like 'TEST Client %';

insert into client_preferences (client_id, rank, preference_order, city, site_code, site_name,
                                job_id, job_title, shift_code, days, hours)
select c.id, (array['primary','backup'])[1 + (k % 2)], k,
  (array['Detroit','Romulus','Pontiac'])[1 + (k % 3)], 'TST' || k, 'TEST Site ' || k,
  'J-' || k, 'TEST Job ' || k, 'S' || k, 'Mon-Fri', '7:00 AM - 3:30 PM'
from clients c, generate_series(1, 2) k
where c.full_name like 'TEST Client %';

insert into activity_log (client_id, action, staff_id, new_value, created_at)
select c.id,
  (array['client_created','status_changed','note_added','document_uploaded','task_added',
         'contact_logged','status_overridden','appointment_created'])[1 + (k % 8)],
  coalesce(c.assigned_staff, (select id from staff order by id limit 1)),
  jsonb_build_object('status', (array['new_intake','needs_review','ready_to_apply','completed'])[1 + (k % 4)]),
  now() - (k || ' hours')::interval
from clients c, generate_series(1, 8) k
where c.full_name like 'TEST Client %';

insert into requirements (client_id, requirement_key, stage, title, why, source, completion_rule, status)
select c.id, 'TEST_REQ_' || k, 'intake', 'TEST requirement ' || k, 'TEST why', 'workflow', 'manual',
  (array['missing','complete','complete','pending_review'])[1 + (k % 4)]
from clients c, generate_series(1, 5) k
where c.full_name like 'TEST Client %';

-- One deliberately heavy file. A long-running case accumulates far more history
-- than the average, and the client workspace has to stay usable on it.
insert into documents (client_id, doc_type, storage_path, file_name, mime_type, size_bytes, status, uploaded_at)
select c.id, (array['photo_id','work_authorization','social_security_card','resume','other'])[1 + (k % 5)],
  'test/heavy/' || k, 'heavy-' || k || '.png', 'image/png', 20480,
  (array['pending','processing','needs_review','needs_reupload'])[1 + (k % 4)], now() - (k || ' hours')::interval
from clients c, generate_series(1, 60) k where c.full_name = 'TEST Client 1';

insert into notes (client_id, note, staff_id, created_at)
select c.id, 'TEST heavy note ' || k || ' — ' || repeat('synthetic text ', 12),
  (select id from staff order by id limit 1), now() - (k || ' hours')::interval
from clients c, generate_series(1, 80) k where c.full_name = 'TEST Client 1';

insert into activity_log (client_id, action, staff_id, new_value, created_at)
select c.id, (array['status_changed','note_added','document_uploaded','task_added','contact_logged',
                    'status_overridden'])[1 + (k % 6)],
  (select id from staff order by id limit 1),
  jsonb_build_object('status', (array['new_intake','needs_review','ready_to_apply','completed'])[1 + (k % 4)]),
  now() - (k || ' hours')::interval
from clients c, generate_series(1, 250) k where c.full_name = 'TEST Client 1';

insert into tasks (client_id, title, assigned_to, due_at, status, created_at)
select c.id, 'TEST heavy task ' || k, (select id from staff order by id limit 1),
  now() + (k || ' days')::interval, (array['pending','in_progress'])[1 + (k % 2)], now()
from clients c, generate_series(1, 40) k where c.full_name = 'TEST Client 1';

insert into contacts (client_id, method, result, staff_id, created_at)
select c.id, (array['call','whatsapp','email','in_person'])[1 + (k % 4)], 'reached',
  (select id from staff order by id limit 1), now() - (k || ' days')::interval
from clients c, generate_series(1, 40) k where c.full_name = 'TEST Client 1';

analyze;

select 'clients' as table_name, count(*) from clients
union all select 'documents', count(*) from documents
union all select 'tasks', count(*) from tasks
union all select 'appointments', count(*) from appointments
union all select 'notes', count(*) from notes
union all select 'activity_log', count(*) from activity_log
union all select 'requirements', count(*) from requirements
order by 1;
