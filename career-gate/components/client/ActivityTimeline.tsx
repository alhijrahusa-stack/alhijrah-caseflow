import { Card } from "@/components/ui/Card";
import { dateTime } from "@/lib/format";
import type { ActivityRow } from "@/lib/types";

export function ActivityTimeline({ activity }: { activity: ActivityRow[] }) {
  return (
    <Card title="Activity">
      {activity.length ? (
        <ol className="relative space-y-4 border-l border-slate-200 pl-4 text-sm">
          {activity.map((a) => (
            <li key={a.id}>
              <span className="absolute -left-1.5 mt-1.5 h-3 w-3 rounded-full border-2 border-white bg-brand-500" />
              <p>{a.summary}</p>
              <p className="text-xs text-slate-500">{dateTime(a.created_at)}</p>
            </li>
          ))}
        </ol>
      ) : (
        <p className="text-sm text-slate-500">No activity yet.</p>
      )}
    </Card>
  );
}
