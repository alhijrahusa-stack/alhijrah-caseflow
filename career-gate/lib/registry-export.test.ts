import { describe, expect, it } from "vitest";
import { parseXlsx } from "@/lib/intake-file";
import { buildRegistryPrint, buildRegistryWorkbook, escapeRegistryXml } from "@/lib/registry-export";
import type { OperationalClientRow } from "@/lib/operational-clients";

const row:OperationalClientRow={id:"a",ref:"CG-2026-100001",full_name:"أحمد <Client>",phone:"3135551001",email:"=formula@example.com",city:"Detroit",current_status:"new_intake",next_step:"Review",start_date:"2026-11-09",created_at:"2026-10-26T02:30:00Z",updated_at:"2026-10-26T02:30:00Z",assigned_staff:null,assigned_name:null,site_code:null,site_name:null,job_id:null,job_title:null,shift_code:null,shift_name:null,payment_status:"unpaid",fee_amount:150,amazon_account_ready:false};

describe("authorized registry export formatting",()=>{
  it("removes forbidden XML characters without corrupting Arabic, emoji or allowed whitespace",()=>{
    const name="أحمد\u0000\u0003\u000b\u001f\ufffe\ud800 ✨🙂\tA\nB";
    expect(escapeRegistryXml(name)).toBe("أحمد ✨🙂\tA\nB");
    expect(parseXlsx(buildRegistryWorkbook([{...row,full_name:name}]))[0].Client).toBe("أحمد ✨🙂\tA\nB");
  });
  it("generates a real XLSX archive with exact Unicode and safe literal values",()=>{
    const bytes=buildRegistryWorkbook([row]);
    expect(bytes.subarray(0,2).toString()).toBe("PK");
    const parsed=parseXlsx(bytes);
    expect(parsed).toHaveLength(1);
    expect(parsed[0]).toMatchObject({Reference:row.ref,Client:row.full_name,Email:row.email,"Start date":"Nov 9, 2026"});
  });
  it("retains exclusive operational location and the server review stamp in an exported original record",()=>{
    const reviewed = {...row,is_urgent:true,operational_location:"urgent",review_stamp:{reviewed_by_name:"Manager عبد الله",reviewed_at:"2026-11-01T12:00:00Z",review_id:"review-1",review_pending:false}};
    const parsed=parseXlsx(buildRegistryWorkbook([reviewed]));
    expect(parsed).toHaveLength(1);
    expect(parsed[0]).toMatchObject({Reference:row.ref,"Operational section":"urgent",Urgent:"Yes","Reviewed by manager":"Manager عبد الله","Review pending":"No"});
    const pending=parseXlsx(buildRegistryWorkbook([{...reviewed,manager_review_id:"review-2",operational_location:"manager"}]))[0];
    expect(pending).toMatchObject({"Operational section":"manager","Review pending":"Yes","Reviewed by manager":"Manager عبد الله"});
  });
  it("never exports a scheduled date as proof of actual work",()=>{
    const legacy=parseXlsx(buildRegistryWorkbook([row]))[0];
    expect(legacy).toMatchObject({"Start date":"Nov 9, 2026","Actual employment start":null,"Employment confirmation":"Actual start not confirmed"});
    const confirmed=parseXlsx(buildRegistryWorkbook([{...row,employment_confirmation_id:"confirmation",actual_start_date:"2026-11-02",employment_site_name:"Recorded worksite",employment_confirmed_by_name:"Recorded staff",employment_confirmed_at:"2026-11-08T12:00:00Z"}]))[0];
    expect(confirmed).toMatchObject({"Start date":"Nov 9, 2026","Actual employment start":"Nov 2, 2026","Employment confirmation":"Actual start confirmed","Confirmed worksite":"Recorded worksite","Confirmed by":"Recorded staff"});
  });
  it("escapes untrusted printable markup and preserves Arabic for the browser PDF renderer",()=>{
    const html=buildRegistryPrint([{...row,full_name:"أحمد <script>alert(1)</script>"}],"active","nonce123","2026-10-31T12:00:00Z");
    expect(html).toContain("أحمد &lt;script&gt;alert(1)&lt;/script&gt;");
    expect(html).not.toContain("<script>alert(1)</script>");
    expect(html).toContain('script nonce="nonce123"');
    expect(html).toContain("Print / Save PDF");
  });
});
