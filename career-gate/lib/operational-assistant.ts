import "server-only";
import { withStaff, type StaffSession } from "@/lib/auth";
import { G3_STAGES } from "@/lib/g3-stages";
import { OFFICE } from "@/lib/office";
import { ActionError } from "@/lib/service";
import { teamWorkload } from "@/lib/operational-team";
import { assistantIntent, projectFlow, type AssistantIntent, type FlowForecast } from "@/lib/operational-assistant-core";

type AssistantLink = { label: string; labelAr: string; href: string; amount?: number };
export type OperationalAnswer = {
  intent: AssistantIntent;
  generated_at: string;
  title: string;
  titleAr: string;
  answer: string;
  answerAr: string;
  method: string;
  methodAr: string;
  facts: { label: string; labelAr: string; value: number; unit?: "USD" | "days" }[];
  links: AssistantLink[];
  forecast?: FlowForecast[];
};

const STAGE_MAP = Object.fromEntries(G3_STAGES.flatMap((stage) => stage.statuses.map((status) => [status, stage.id])));
const num = (value: unknown) => Number(value ?? 0);

export async function operationalAnswer(session: StaffSession, question: string): Promise<OperationalAnswer> {
  if (session.staff.role === "staff") throw new ActionError("forbidden", "Operational assistant requires manager or admin access", 403);
  const intent = assistantIntent(question);
  const base = {
    intent, generated_at: new Date().toISOString(), facts: [], links: [],
    method: "Read-only operational data, scoped to your signed-in permissions. No external messages are sent.",
    methodAr: "بيانات تشغيلية للقراءة وفق صلاحيات حسابك. لا تُرسل رسائل خارجية.",
  } satisfies Omit<OperationalAnswer, "title" | "titleAr" | "answer" | "answerAr">;
  if (intent === "unpaid_interviews") {
    const result = await withStaff(session, async (tx) => {
      await tx`select set_config('statement_timeout','6500',true)`;
      // The newest recorded outcome determines success; old passed interviews never override a later failure.
      const rows = await tx`with latest as (
        select distinct on(o.client_id) o.client_id,o.decision,o.recorded_at
        from appointment_outcomes o order by o.client_id,o.recorded_at desc,o.appointment_id desc
      ), unpaid as (
        select c.id,c.ref,c.full_name,greatest(b.balance,0)::numeric balance,o.recorded_at
        from clients c join latest o on o.client_id=c.id join client_account_balances b on b.client_id=c.id
        where c.deleted_at is null and c.current_status<>'cancelled' and o.decision='pass' and b.balance>0
          and o.recorded_at>=date_trunc('month',now() at time zone ${OFFICE.timeZone}) at time zone ${OFFICE.timeZone}
      ) select (select count(*)::int from unpaid) total,(select coalesce(sum(balance),0) from unpaid) amount,
          coalesce((select jsonb_agg(x) from(select id,ref,full_name,balance from unpaid order by recorded_at,id limit 5)x),'[]'::jsonb) clients`;
      return rows[0];
    });
    const count = num(result?.total); const amount = num(result?.amount);
    return { ...base, title: "Successful interviews awaiting payment", titleAr: "مقابلات ناجحة بانتظار السداد",
      answer: `${count} clients have a latest successful interview recorded this office month and an outstanding balance of $${amount.toFixed(2)}.`,
      answerAr: `${count} عملاء سُجلت أحدث مقابلاتهم بنجاح خلال الشهر الحالي بتوقيت المكتب، وإجمالي رصيدهم المستحق $${amount.toFixed(2)}.`,
      method: `Latest recorded interview outcome per client + actual account balance. Month boundary uses ${OFFICE.timeZone}.`,
      methodAr: "أحدث نتيجة مقابلة لكل عميل مع الرصيد الفعلي للحساب، وحدود الشهر بتوقيت المكتب.",
      facts: [{ label: "Clients", labelAr: "العملاء", value: count }, { label: "Outstanding", labelAr: "المستحقات", value: amount, unit: "USD" }],
      links: (result?.clients as { id: string; ref: string; full_name: string; balance: number }[] ?? []).map((client) => ({ label: `${client.ref} · ${client.full_name}`, labelAr: `${client.ref} · ${client.full_name}`, href: `/staff/client/${client.id}?tab=account`, amount: num(client.balance) })),
    };
  }
  if (intent === "team_load") {
    const team = await teamWorkload(session);
    const ranked = team.members.filter((member) => member.active).sort((a, b) => b.overdue_tasks - a.overdue_tasks || b.active_clients + b.open_tasks - a.active_clients - a.open_tasks).slice(0, 3);
    return { ...base, title: "Current team load", titleAr: "حمل الفريق الحالي",
      answer: `${team.active_clients} active client files, ${team.open_tasks} open tasks and ${team.overdue_tasks} overdue tasks. Review the busiest staff below before reassigning work.`,
      answerAr: `${team.active_clients} ملفات عملاء نشطة و${team.open_tasks} مهام مفتوحة، منها ${team.overdue_tasks} متأخرة. راجع الموظفين الأعلى حملاً قبل إعادة التوزيع.`,
      facts: [{ label: "Active files", labelAr: "الملفات النشطة", value: team.active_clients }, { label: "Overdue tasks", labelAr: "المهام المتأخرة", value: team.overdue_tasks }],
      links: ranked.map((member) => ({ label: `${member.display_name} · ${member.active_clients} files / ${member.open_tasks} tasks / ${member.overdue_tasks} overdue`, labelAr: `${member.display_name} · ${member.active_clients} ملفات / ${member.open_tasks} مهام / ${member.overdue_tasks} متأخرة`, href: `/staff/staff?tab=team&member=${member.id}` })),
    };
  }
  if (intent === "document_blockers") {
    const rows = await withStaff(session, (tx) => tx`with latest as (
      select distinct on(d.client_id,d.doc_type) d.client_id,d.status from documents d order by d.client_id,d.doc_type,d.uploaded_at desc,d.id desc
    ), blocked as (
      select distinct c.id,c.ref,c.full_name from clients c join latest d on d.client_id=c.id
      where c.deleted_at is null and c.current_status not in('completed','cancelled') and d.status in('needs_review','needs_reupload','rejected')
    ) select (select count(*)::int from blocked) total,coalesce((select jsonb_agg(x) from(select id,ref,full_name from blocked order by ref limit 5)x),'[]'::jsonb) clients`);
    const result = rows[0]; const count = num(result?.total);
    return { ...base, title: "Document review blockers", titleAr: "عوائق مراجعة الوثائق",
      answer: `${count} active clients have a latest document awaiting review, rejected or requiring reupload. This count covers uploaded documents; unsubmitted requirements need a separate readiness review.`,
      answerAr: `${count} عملاء نشطين لديهم وثيقة مرفوعة حديثة تحتاج مراجعة أو إعادة رفع أو رُفضت. لا يشمل العدد وثائق لم تُرفع بعد؛ تُراجع ضمن جاهزية الملف.`,
      facts: [{ label: "Clients affected", labelAr: "العملاء المتأثرون", value: count }],
      links: (result?.clients as { id: string; ref: string; full_name: string }[] ?? []).map((client) => ({ label: `${client.ref} · ${client.full_name}`, labelAr: `${client.ref} · ${client.full_name}`, href: `/staff/client/${client.id}?tab=documents` })),
    };
  }
  if (intent === "flow_forecast") {
    const rows = await withStaff(session, async (tx) => {
      await tx`select set_config('statement_timeout','6500',true)`;
      return tx`with stage_map as(select ${tx.json(STAGE_MAP)}::jsonb m), queued as (
        select m->>c.current_status stage,count(*)::int queued from clients c cross join stage_map
          where c.deleted_at is null and c.current_status not in('completed','cancelled') group by m->>c.current_status
      ), exits as (
        select m->>(l.old_value->>'status') stage,count(*)::int exits_28d,
          count(*) filter(where l.created_at>=now()-interval '7 days')::int exits_7d
        from activity_log l join clients c on c.id=l.client_id cross join stage_map
        where c.deleted_at is null and l.created_at>=now()-interval '28 days' and l.action in('status_changed','status_overridden')
          and m->>(l.old_value->>'status') is not null and m->>(l.new_value->>'status') is not null
          and m->>(l.old_value->>'status') is distinct from m->>(l.new_value->>'status')
        group by m->>(l.old_value->>'status')
      ) select coalesce(q.stage,e.stage) stage,coalesce(q.queued,0)::int queued,coalesce(e.exits_28d,0)::int exits_28d,coalesce(e.exits_7d,0)::int exits_7d
        from queued q full join exits e on e.stage=q.stage`;
    });
    const forecast = projectFlow(rows.map((row) => ({ stage: String(row.stage), queued: num(row.queued), exits_28d: num(row.exits_28d), exits_7d: num(row.exits_7d) })));
    const slowest = forecast.filter((row) => row.sample === "sufficient" && row.queued > 0).sort((a, b) => (b.estimated_clearance_days ?? 0) - (a.estimated_clearance_days ?? 0))[0];
    return { ...base, title: "Workflow capacity projection", titleAr: "تقدير طاقة مسار العمل",
      answer: slowest ? `${slowest.label} has ${slowest.queued} queued files and ${slowest.exits_28d} recorded stage exits in 28 days. At that average pace, clearing today's queue takes about ${slowest.estimated_clearance_days} days, with ${slowest.beyond_week_capacity} files beyond one week's capacity.` : "There is not enough recent stage-exit history to estimate a bottleneck reliably. Actual queue and recorded throughput counts are shown below.",
      answerAr: slowest ? `قسم ${slowest.labelAr} لديه ${slowest.queued} ملفات بالانتظار و${slowest.exits_28d} انتقالاً مسجلاً للخروج خلال 28 يوماً. وفق متوسط الوتيرة، يحتاج صف الانتظار الحالي نحو ${slowest.estimated_clearance_days} يوماً، و${slowest.beyond_week_capacity} ملفات تتجاوز طاقة أسبوع.` : "لا توجد عينة كافية من انتقالات الأقسام الحديثة لتقدير الاختناق بثقة. تظهر أعداد الانتظار والانتقالات المسجلة أدناه.",
      method: "Baseline = current queue ÷ (recorded stage exits in 28 days ÷ 28). At least 5 exits are required. Assumes unchanged throughput and no new arrivals. This estimates capacity, not missed deadlines or an AI prediction.",
      methodAr: "الأساس = الانتظار الحالي ÷ (الانتقالات المسجلة خلال 28 يوماً ÷ 28). يلزم 5 انتقالات على الأقل. يفترض ثبات الوتيرة وعدم ورود ملفات جديدة. هذا تقدير للطاقة، وليس حكماً بتأخر المواعيد أو تنبؤاً بالذكاء الاصطناعي.",
      forecast, links: slowest ? [{ label: `Review ${slowest.label}`, labelAr: `مراجعة ${slowest.labelAr}`, href: slowest.href }, { label: "Review team load", labelAr: "مراجعة حمل الفريق", href: "/staff/staff?tab=team" }] : [],
    };
  }
  return { ...base, title: "Ask your operations data", titleAr: "اسأل بيانات التشغيل",
    answer: "I can check successful interviews awaiting payment this month, current team load, document review blockers, and workflow capacity. Choose a question below or ask in Arabic or English.",
    answerAr: "يمكنني مراجعة المقابلات الناجحة بانتظار السداد هذا الشهر، وحمل الفريق، وعوائق مراجعة الوثائق، وطاقة مسار العمل. اختر سؤالاً أو اكتب بالعربية أو الإنجليزية.",
  };
}
