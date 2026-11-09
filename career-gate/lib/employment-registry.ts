import "server-only";
import { withStaff, type StaffSession, type Tx } from "@/lib/auth";
import { todayInOffice } from "@/lib/format";
import { moveWorkflowClient } from "@/lib/manual-workflow";
import { ActionError } from "@/lib/service";
import { staffOperation } from "@/lib/staff-operation";
import { findWorksite } from "@/lib/worksite-change-schema";
import { EmploymentConfirmationInput, type EmploymentConfirmation, type EmploymentConfirmationCommand } from "@/lib/employment-registry-schema";
import { CURRENT_EMPLOYMENT_CONFIRMATION_SQL } from "@/lib/employment-registry-read";
export { CURRENT_EMPLOYMENT_CONFIRMATION_SQL } from "@/lib/employment-registry-read";

function confirmationDTO(row: Record<string, unknown>): EmploymentConfirmation {
  return { ...row,
    actual_start_date: row.actual_start_date instanceof Date ? row.actual_start_date.toISOString().slice(0, 10) : String(row.actual_start_date),
    confirmed_at: row.confirmed_at instanceof Date ? row.confirmed_at.toISOString() : new Date(String(row.confirmed_at)).toISOString(),
    worksite_recorded_at: row.worksite_recorded_at == null ? null : row.worksite_recorded_at instanceof Date ? row.worksite_recorded_at.toISOString() : new Date(String(row.worksite_recorded_at)).toISOString(),
  } as EmploymentConfirmation;
}

/** Current confirmation history follows the original client through every move. */
export async function employmentConfirmationHistory(session: StaffSession, clientId: string): Promise<EmploymentConfirmation[]> {
  return withStaff(session, async tx => {
    const rows = await tx`select * from employment_confirmations where client_id=${clientId} order by confirmed_at desc,id desc limit 100`;
    return rows.map(confirmationDTO);
  });
}

export async function latestEmploymentConfirmation(tx: Tx, clientId: string): Promise<EmploymentConfirmation | null> {
  const [row] = await tx`select * from employment_confirmations where client_id=${clientId} order by confirmed_at desc,id desc limit 1`;
  return row ? confirmationDTO(row) : null;
}

export async function currentEmploymentConfirmation(tx: Tx, clientId: string): Promise<EmploymentConfirmation | null> {
  const [row] = await tx`select employment.* from clients c
    join lateral (${tx.unsafe(CURRENT_EMPLOYMENT_CONFIRMATION_SQL)}) employment on true where c.id=${clientId}`;
  return row ? confirmationDTO(row) : null;
}

/** An explicit staff attestation, the original's final move and its audit commit together. */
export async function confirmEmployment(session: StaffSession, raw: EmploymentConfirmationCommand, traceId: string) {
  const input = EmploymentConfirmationInput.parse(raw);
  if (input.actual_start_date > todayInOffice()) throw new ActionError("actual_start_in_future", "An actual start date cannot be in the future", 400);
  return withStaff(session, tx => staffOperation(tx, session, input.operation_id, "confirm_employment", input, async () => {
    const [client] = await tx`select id,current_status,pipeline_stage,next_step,manager_review_id,operational_location,updated_at::text client_version
      from clients where id=${input.client_id} and deleted_at is null for update`;
    if (!client) throw new ActionError("not_found", "Client unavailable or not assigned to you", 404);
    if (client.manager_review_id) throw new ActionError("manager_review_pending", "This file is awaiting a manager decision", 409);
    if (String(client.client_version) !== input.expected_updated_at) throw new ActionError("client_changed", "This file changed. Refresh before confirming.", 409);
    if (client.current_status === "cancelled") throw new ActionError("closed_case", "Reopen the cancelled file before confirming employment", 409);
    const existing = await currentEmploymentConfirmation(tx, input.client_id);
    if (client.current_status === "completed" && existing) {
      if (existing.actual_start_date === input.actual_start_date && existing.site_code === input.site_code) return { changed: false, confirmation: existing, client_version: String(client.client_version) };
      throw new ActionError("employment_already_confirmed", "This employment confirmation is final. Route the file for a new worksite or employment decision before confirming again.", 409);
    }
    const [worksite] = await tx`select id,status,recorded_at,current_site_code,current_site_name,current_site_address,final_site_code,final_site_name,final_site_address
      from worksite_changes where client_id=${input.client_id} order by created_at desc,id desc limit 1`;
    const [primary] = await tx`select site_code,site_name,site_address,job_id,job_title,shift_code,shift_name,days,hours from client_preferences
      where client_id=${input.client_id} and rank='primary' order by preference_order,id limit 1`;
    if (worksite?.status === "pending") {
      if (client.operational_location === "worksite_change") throw new ActionError("worksite_confirmation_required", "Confirm the final worksite or route the file out of the relocation desk before attesting actual employment", 409);
      const currentSite = primary?.site_code ?? worksite.current_site_code;
      if (!currentSite) throw new ActionError("current_site_required", "Record the current worksite before confirming actual employment outside the pending relocation", 409);
      if (input.site_code !== currentSite) throw new ActionError("worksite_mismatch", "A pending relocation does not confirm employment at its requested new site. Choose the recorded current worksite.", 409);
    } else if (worksite && worksite.final_site_code !== input.site_code) throw new ActionError("worksite_mismatch", "Choose the final location recorded in the latest worksite change", 409);
    const directorySite = findWorksite(input.site_code)!;
    const site = worksite?.status === "confirmed"
      ? { code: String(worksite.final_site_code), name: String(worksite.final_site_name), address: worksite.final_site_address == null ? null : String(worksite.final_site_address) }
      : worksite?.status === "pending" && primary?.site_code === input.site_code
        ? { code: input.site_code, name: primary.site_name ? String(primary.site_name) : directorySite.name, address: primary.site_address == null ? directorySite.address : String(primary.site_address) }
        : worksite?.status === "pending" && worksite.current_site_code === input.site_code
          ? { code: input.site_code, name: worksite.current_site_name ? String(worksite.current_site_name) : directorySite.name, address: worksite.current_site_address == null ? directorySite.address : String(worksite.current_site_address) }
          : directorySite;
    // Only matching, recorded placement facts travel into the immutable record.
    const matching = primary?.site_code === site.code ? primary : null;
    const worksiteId = worksite ? String(worksite.id) : null;
    await tx`select set_config('cg.employment_confirmation','write',true)`;
    const [row] = await tx`insert into employment_confirmations(client_id,actual_start_date,site_code,site_name,site_address,
      job_id,job_title,shift_code,shift_name,shift_days,shift_hours,worksite_change_id,confirmed_by,confirmed_by_name,operation_id)
      values(${input.client_id},${input.actual_start_date},${site.code},${site.name},${site.address},
        ${matching?.job_id ?? null},${matching?.job_title ?? null},${matching?.shift_code ?? null},${matching?.shift_name ?? null},
        ${matching?.days ?? null},${matching?.hours ?? null},${worksiteId},${session.staff.id},${session.staff.display_name},${input.operation_id}) returning *`;
    await moveWorkflowClient(tx, session, client as {id: string; current_status: string; pipeline_stage: string; next_step: string}, "completed", "Actual employment start confirmed", traceId,
      {employment_confirmation_id: row.id,actual_start_date: input.actual_start_date});
    // Legacy files can already be completed; their newly recorded attestation
    // must still advance the version and update live counters/search surfaces.
    await tx`update clients set updated_at=now() where id=${input.client_id}`;
    await tx`insert into activity_log(client_id,action,staff_id,entity_type,entity_id,new_value,trace_id)
      values(${input.client_id},'client_started',${session.staff.id},'employment_confirmation',${row.id},
        ${tx.json({operation:'actual_employment_confirmed',confirmation_id:row.id,actual_start_date:input.actual_start_date,site_code:site.code})},${traceId})`;
    const [version] = await tx`select updated_at::text client_version from clients where id=${input.client_id}`;
    return { changed: true, confirmation: confirmationDTO(row), client_version: String(version.client_version) };
  }));
}
