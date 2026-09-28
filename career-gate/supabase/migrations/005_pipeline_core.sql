create table if not exists public.pipeline_stages (
  key text primary key,
  position smallint not null unique,
  label_en text not null,
  label_ar text not null,
  color text not null,
  terminal boolean not null default false
);

insert into public.pipeline_stages (key, position, label_en, label_ar, color, terminal) values
('portal_intake',1,'Career Gate Intake','عملاء بوابة التوظيف','#64748B',false),
('no_amazon_account',2,'No Amazon Account','عملاء جدد بدون حسابات Amazon','#6366F1',false),
('amazon_account_waiting_job',3,'Amazon Account — Waiting for Job','عملاء لديهم حسابات Amazon بانتظار وظيفة','#8B5CF6',false),
('interview_scheduled',4,'Interview Scheduled','عملاء لديهم مقابلات','#22D3EE',false),
('interview_passed',5,'Interview Passed','عملاء نجحوا في المقابلة','#10B981',false),
('interview_rejected',6,'Interview Rejected','عملاء مرفوضون في المقابلة','#EF4444',true),
('post_interview_completion',7,'Post-Interview Completion','ناجحون بانتظار استكمال البيانات بعد المقابلة','#F59E0B',false)
on conflict (key) do update set position=excluded.position,label_en=excluded.label_en,label_ar=excluded.label_ar,color=excluded.color,terminal=excluded.terminal;

alter table public.clients add column if not exists pipeline_stage text not null default 'portal_intake';
create index if not exists clients_pipeline_stage_idx on public.clients (pipeline_stage, updated_at desc) where deleted_at is null;
