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
  it("escapes untrusted printable markup and preserves Arabic for the browser PDF renderer",()=>{
    const html=buildRegistryPrint([{...row,full_name:"أحمد <script>alert(1)</script>"}],"active","nonce123","2026-10-31T12:00:00Z");
    expect(html).toContain("أحمد &lt;script&gt;alert(1)&lt;/script&gt;");
    expect(html).not.toContain("<script>alert(1)</script>");
    expect(html).toContain('script nonce="nonce123"');
    expect(html).toContain("Print / Save PDF");
  });
});
