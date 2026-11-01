import { describe, expect, it } from "vitest";
import { sameReviewDraft } from "@/lib/review-draft-snapshot";
import type { ReviewDraftPayload } from "@/lib/review-offline-drafts";
const snapshot: ReviewDraftPayload = {action:"save",id:"case",reviewer_id:"staff",draft:{profile:{full_name:"Test Client",city:"Detroit"},review_fields:{shift_days:["MON","TUE"]}},document_match_confirmed:false,information_match_confirmed:false,resolved_fields:["city","full_name"],expected_updated_at:"2026-11-01T12:00:00.123456Z",expected_revision:"41"};

describe("a synced draft must match the review still on screen",()=>{
  it("ignores object serialization order and actor stamping, but keeps the same reviewed contract",()=>{
    const reordered={...snapshot,expected_actor_id:"staff",draft:{review_fields:{shift_days:["MON","TUE"]},profile:{city:"Detroit",full_name:"Test Client"}},resolved_fields:["full_name","city"]};
    expect(sameReviewDraft(snapshot,reordered)).toBe(true);
  });
  it("rejects newer field edits, match confirmations, resolutions and microsecond versions",()=>{
    expect(sameReviewDraft(snapshot,{...snapshot,draft:{profile:{full_name:"Test Client",city:"Dearborn"},review_fields:{shift_days:["MON","TUE"]}}})).toBe(false);
    expect(sameReviewDraft(snapshot,{...snapshot,document_match_confirmed:true})).toBe(false);
    expect(sameReviewDraft(snapshot,{...snapshot,information_match_confirmed:true})).toBe(false);
    expect(sameReviewDraft(snapshot,{...snapshot,resolved_fields:["city"]})).toBe(false);
    expect(sameReviewDraft(snapshot,{...snapshot,expected_updated_at:"2026-11-01T12:00:00.123457Z"})).toBe(false);
    expect(sameReviewDraft(snapshot,{...snapshot,expected_revision:"42"})).toBe(false);
    expect(sameReviewDraft(snapshot,{...snapshot,expected_revision:undefined})).toBe(false);
    expect(sameReviewDraft(snapshot,undefined)).toBe(false);
  });
});
