import "server-only";
import { withStaff, type StaffSession } from "@/lib/auth";

export type ClientReadiness = {
  total_requirements: number;
  completed_requirements: number;
  readiness_percent: number | null;
} | null;

export async function clientRequirements(session: StaffSession, clientId: string) {
  return withStaff(session, async (tx) => {
    const [requirements, readinessRows] = await Promise.all([
      tx`select r.*,d.file_name related_document_name,t.title related_task_title,u.display_name updated_by_name
         from requirements r
         left join documents d on d.id=r.related_document_id
         left join tasks t on t.id=r.related_task_id
         left join staff u on u.id=r.updated_by
         where r.client_id=${clientId}
         order by case r.status when 'missing' then 0 when 'rejected' then 1 when 'expired' then 2 when 'pending_review' then 3 when 'complete' then 4 else 5 end,
                  r.due_at nulls last,r.created_at`,
      tx`select total_requirements,completed_requirements,readiness_percent from client_readiness where client_id=${clientId}`,
    ]);
    const readiness = readinessRows[0] ? {
      total_requirements: Number(readinessRows[0].total_requirements),
      completed_requirements: Number(readinessRows[0].completed_requirements),
      readiness_percent: readinessRows[0].readiness_percent == null ? null : Number(readinessRows[0].readiness_percent),
    } : null;
    return { requirements, readiness };
  });
}
