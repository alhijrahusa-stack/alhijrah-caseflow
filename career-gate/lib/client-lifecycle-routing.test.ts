import { describe, expect, it } from "vitest";
import { resolveLifecycleRoute, type RoutingEvidence } from "@/lib/client-lifecycle-routing";

const evidence: RoutingEvidence = {
  current_status: "new_intake",
  account_ready: false,
  documents_ready: false,
  interview_scheduled: false,
  interview_passed: false,
  payment_verified: false,
};

describe("safe six-stage assignment and routing", () => {
  it("routes reviewed intake into account setup without leaving the intake status unchanged", () => {
    expect(resolveLifecycleRoute("new_intake", evidence)).toMatchObject({ status: "new_intake", pipelineStage: "portal_intake" });
    expect(resolveLifecycleRoute("account_setup", evidence)).toMatchObject({ status: "ready_to_apply", pipelineStage: "no_amazon_account" });
    expect(resolveLifecycleRoute("account_setup", { ...evidence, current_status: "ready_to_apply" })).toMatchObject({
      status: "ready_to_apply", pipelineStage: "no_amazon_account"
    });
  });

  it("excludes applicants who already own a READY Amazon account from Account Setup", () => {
    expect(() => resolveLifecycleRoute("account_setup", { ...evidence, current_status: "ready_to_apply", account_ready: true }))
      .toThrow("already has a READY Amazon account");
  });

  it("rejects Job Ready until Amazon account and verified requirements are complete", () => {
    const candidate: RoutingEvidence = { ...evidence, current_status: "application_in_progress", account_ready: true };
    expect(() => resolveLifecycleRoute("job_ready", candidate)).toThrow("verified requirements");
    expect(resolveLifecycleRoute("job_ready", { ...candidate, documents_ready: true })).toMatchObject({
      status: "shift_selected", pipelineStage: "amazon_account_waiting_job"
    });
    expect(resolveLifecycleRoute("job_ready", { ...candidate, current_status: "new_intake", documents_ready: true }))
      .toMatchObject({status:"shift_selected",transitionPath:["ready_to_apply","application_in_progress","shift_selected"]});
  });

  it("cannot fake an interview appointment from a bulk command", () => {
    const candidate = { ...evidence, current_status: "appointment_required" };
    expect(() => resolveLifecycleRoute("appointments", candidate)).toThrow("Book an actual employment interview");
    expect(resolveLifecycleRoute("appointments", { ...candidate, interview_scheduled: true })).toMatchObject({
      status: "appointment_scheduled", pipelineStage: "interview_scheduled"
    });
  });

  it("requires a recorded Pass and unpaid account for Payment Required", () => {
    const candidate = { ...evidence, current_status: "appointment_scheduled" };
    expect(() => resolveLifecycleRoute("payment_required", candidate)).toThrow("recorded Pass");
    expect(resolveLifecycleRoute("payment_required", { ...candidate, interview_passed: true })).toMatchObject({
      status: "pre_hire_completed", pipelineStage: "payment_required"
    });
    expect(() => resolveLifecycleRoute("payment_required", { ...candidate, interview_passed: true, payment_verified: true }))
      .toThrow("recorded Pass");
  });

  it("allows passed clients to prepare paperwork alongside payment, then follows a legal transition", () => {
    const candidate = { ...evidence, current_status: "pre_hire_completed", interview_passed: true };
    expect(resolveLifecycleRoute("paperwork_pending", candidate)).toMatchObject({ status: "screening_pending", pipelineStage: "post_interview_completion" });
    expect(() => resolveLifecycleRoute("paperwork_pending", {...candidate, interview_passed:false})).toThrow("recorded Pass");
    expect(resolveLifecycleRoute("paperwork_pending", { ...candidate, payment_verified: true })).toMatchObject({
      status: "screening_pending", pipelineStage: "post_interview_completion"
    });
    expect(resolveLifecycleRoute("paperwork_pending", { ...candidate, current_status: "i9_available", payment_verified: true }).status)
      .toBe("i9_available");
  });

  it("prohibits bulk stage overrides for finalized or cancelled cases", () => {
    for (const status of ["completed", "cancelled"]) {
      expect(() => resolveLifecycleRoute("new_intake", { ...evidence, current_status: status }))
        .toThrow("cannot be bulk-routed");
    }
  });
});

 describe("completion evidence",()=>{
  it("requires both a verified ledger and completed paperwork for manual completion",()=>{
    const candidate={...evidence,current_status:"ready_for_first_day",paperwork_complete:true};
    expect(()=>resolveLifecycleRoute("completed",candidate)).toThrow("Verify payment");
    expect(()=>resolveLifecycleRoute("completed",{...candidate,payment_verified:true,paperwork_complete:false})).toThrow("Verify payment");
    expect(resolveLifecycleRoute("completed",{...candidate,payment_verified:true})).toMatchObject({status:"completed",pipelineStage:"completed_files"});
  });
 });
