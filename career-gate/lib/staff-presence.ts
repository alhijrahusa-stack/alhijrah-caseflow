import "server-only";
import { withStaff, type StaffSession } from "@/lib/auth";
import { ActionError } from "@/lib/service";
import { clientIdForPresencePath, isPresenceWorkspaceSection, safeStaffPresencePath, type PresenceWorkspaceSection, type StaffPresenceState, type TeamPresenceClient, type TeamPresenceMember } from "@/lib/presence-model";

export async function teamPresenceRoster(session: StaffSession, requestedClientIds: string[] = []): Promise<{ members: TeamPresenceMember[]; clients: TeamPresenceClient[] }> {
  if (session.staff.role !== "admin" && session.staff.role !== "manager") throw new ActionError("forbidden", "Team presence requires management access", 403);
  return withStaff(session, async tx => {
    const members = await tx`select s.id staff_id,s.auth_user_id,s.display_name,
      p.path,p.workspace_section,p.active_client_id,c.full_name active_client_name,c.ref active_client_ref,p.state,p.visible,p.seen_at::text
      from staff s left join staff_presence p on p.staff_id=s.id
      left join clients c on c.id=p.active_client_id and c.deleted_at is null
      where s.active and s.auth_user_id is not null order by s.display_name,s.id`;
    const clients = requestedClientIds.length ? await tx`select id,ref,full_name from clients where id=any(${requestedClientIds}::uuid[]) and deleted_at is null` : [];
    return { members: members as unknown as TeamPresenceMember[], clients: clients as unknown as TeamPresenceClient[] };
  });
}

export async function recordStaffPresence(session: StaffSession, input: { path: string; workspace_section?: PresenceWorkspaceSection | null; state: StaffPresenceState; visible: boolean }) {
  const path = safeStaffPresencePath(input.path);
  if (!path) throw new ActionError("invalid_path", "Choose a valid staff workspace", 400);
  const clientId = clientIdForPresencePath(path);
  const workspaceSection = path === "/staff/clients" && isPresenceWorkspaceSection(input.workspace_section) ? input.workspace_section : null;
  return withStaff(session, async tx => {
    if (clientId) {
      const [client] = await tx`select id from clients where id=${clientId} and deleted_at is null`;
      if (!client) throw new ActionError("not_found", "Client file is unavailable", 404);
    }
    const [row] = await tx`insert into staff_presence(staff_id,auth_user_id,path,workspace_section,active_client_id,state,visible)
      values(${session.staff.id},${session.authUserId},${path},${workspaceSection},${clientId},${input.state},${input.visible})
      on conflict(staff_id) do update set auth_user_id=excluded.auth_user_id,path=excluded.path,
        workspace_section=excluded.workspace_section,active_client_id=excluded.active_client_id,state=excluded.state,visible=excluded.visible,seen_at=now()
      returning path,workspace_section,active_client_id,state,visible,seen_at::text`;
    return { ...row, observed_at: new Date(String(row.seen_at)).getTime() };
  });
}
