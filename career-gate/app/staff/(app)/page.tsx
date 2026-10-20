import { Suspense } from "react";
import { redirect } from "next/navigation";
import { DashboardCore, DashboardExceptionsBadge, DashboardHeading, DashboardSystemSignals, DashboardTeamHealth } from "@/components/staff/OperationalDashboard";
import { Skeleton } from "@/components/ui/Skeleton";
import { getStaffSession } from "@/lib/auth";
import { dashboardExceptionCount, dashboardOperationalData, dashboardSystemHealth, type DashboardCommandData, type DashboardOperationalData, type DashboardSystemHealth } from "@/lib/operational-dashboard";
import { teamWorkload, type TeamWorkloadData } from "@/lib/operational-team";

export const dynamic = "force-dynamic";

function LoadingSection({label}:{label:string}){
  return <section className="ops-glass-card space-y-3" role="status" aria-label={`Loading ${label}`} aria-busy="true">
    <Skeleton className="h-6 w-48 max-w-full"/>
    <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
      {Array.from({length:4},(_,i)=><Skeleton key={i} className="h-24"/>)}
    </div>
  </section>;
}

async function Exceptions({operational,system}:{
  operational:Promise<DashboardOperationalData>;
  system:Promise<DashboardSystemHealth|null>;
}){
  const [metrics,health]=await Promise.all([operational,system]);
  return <DashboardExceptionsBadge exceptions={dashboardExceptionCount(metrics,health)}/>;
}

async function Core({result}:{result:Promise<DashboardOperationalData>}){
  return <DashboardCore data={await result}/>;
}

async function System({result}:{result:Promise<DashboardSystemHealth|null>}){
  return <DashboardSystemSignals system={await result}/>;
}

async function Team({operational,system,team}:{
  operational:Promise<DashboardOperationalData>;
  system:Promise<DashboardSystemHealth|null>;
  team:Promise<TeamWorkloadData>;
}){
  const [metrics,health,members]=await Promise.all([operational,system,team]);
  const data:DashboardCommandData={...metrics,team:members,system:health,exceptions:dashboardExceptionCount(metrics,health)};
  return <DashboardTeamHealth data={data}/>;
}

export default async function Dashboard({searchParams}:{searchParams:Promise<{tab?:string;period?:string}>}){
  const session=await getStaffSession();
  if (!session) redirect("/staff/login");

  const params=await searchParams;
  if (params.tab==="reports") redirect(`/staff/reports${params.period?`?period=${params.period}`:""}`);
  if (params.tab==="settings") redirect("/staff/settings");
  if (params.tab==="week") redirect("/staff");

  // Start independent reads together. Suspense streams resolved panels without
  // delaying operational KPIs behind team aggregation or admin-only health.
  const operational=dashboardOperationalData(session);
  const system=dashboardSystemHealth(session);
  const team=teamWorkload(session);

  return <div className="ops-page space-y-6" data-testid="dashboard-streaming">
    <DashboardHeading badge={
      <Suspense fallback={<span className="text-xs text-slate-400" role="status">Checking exceptions…</span>}>
        <Exceptions operational={operational} system={system}/>
      </Suspense>
    }/>
    <Suspense fallback={<LoadingSection label="operational metrics"/>}>
      <Core result={operational}/>
    </Suspense>
    <Suspense fallback={session.staff.role==="admin"?<LoadingSection label="system health"/>:null}>
      <System result={system}/>
    </Suspense>
    <Suspense fallback={<LoadingSection label="team workload"/>}>
      <Team operational={operational} system={system} team={team}/>
    </Suspense>
  </div>;
}
