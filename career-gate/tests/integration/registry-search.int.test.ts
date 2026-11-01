import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import postgres from "postgres";
import { withStaff, type StaffSession } from "@/lib/auth";
import { operationalClientList } from "@/lib/operational-clients";
import { ProfileSchema } from "@/lib/schemas";
import { insertClient } from "@/lib/service";
import { parseRegistryFilters } from "@/lib/registry-filters";

const db=postgres(process.env.DATABASE_URL!,{prepare:false,max:1});
const tag=randomUUID().slice(0,8);
let sequence=6400;
let admin:StaffSession,owner:StaffSession,other:StaffSession;
const makeStaff=async(role:"admin"|"staff",name:string):Promise<StaffSession>=>{
  const authUserId=randomUUID();
  await db`insert into auth.users(id,email) values(${authUserId},${`registry-${name}-${tag}@test.invalid`})`;
  const [staff]=await db`insert into staff(display_name,email,role,auth_user_id) values(${`TEST Registry ${name}`},${`registry-${name}-${tag}@test.invalid`},${role},${authUserId}) returning id,display_name,email,role`;
  return {authUserId,staff:staff as StaffSession["staff"]};
};
async function client(name:string,assigned:string|null=owner.staff.id) {
  return db.begin(tx=>insertClient(tx,{source:"staff_manual",profile:ProfileSchema.parse({full_name:name,phone:`313555${++sequence}`,employment_history:[]}),primary:[],backup:[],status:"new_intake",nextStep:null,assignedStaff:assigned,createdBy:null,communicationConsent:true},{staffId:null,traceId:"registry-search-int"}));
}
beforeAll(async()=>{admin=await makeStaff("admin","admin");owner=await makeStaff("staff","owner");other=await makeStaff("staff","other");});
afterAll(async()=>{await db.end();});

describe("indexed multilingual canonical registry",()=>{
  it("does not return an unrelated phone when a mixed name/reference query contains those digits",async()=>{
    const item=await client(`TEST Registry Literal Name ${tag}`);
    const [record]=await db`select phone from clients where id=${item.id}`;
    const suffix=String(record.phone).slice(-4);
    expect((await operationalClientList(owner,"active",1,10,{q:`REGISTRY-NO-SUCH-NAME-${suffix}`,stage:"new_intake"})).total).toBe(0);
    const phone=String(record.phone);
    const formatted=`(${phone.slice(0,3)}) ${phone.slice(3,6)}-${phone.slice(6)}`;
    expect((await operationalClientList(owner,"active",1,10,{q:formatted,stage:"new_intake"})).rows.map(row=>row.id)).toContain(item.id);
  });
  it("matches Arabic alef/diacritics and a misspelled English name without widening staff scope",async()=>{
    const arabic=await client(`TEST ${tag} أَحْمَد المري`);
    const english=await client(`TEST ${tag} Zebramontgomery`);
    const ar=await operationalClientList(owner,"active",1,10,{q:"احمد",stage:"new_intake"});
    expect(ar.rows.map(row=>row.id)).toContain(arabic.id);
    const typo=await operationalClientList(owner,"active",1,10,{q:"Zebramontgomrey",stage:"new_intake"});
    expect(typo.rows.map(row=>row.id)).toContain(english.id);
    expect((await operationalClientList(other,"active",1,10,{q:"Zebramontgomrey",stage:"new_intake"})).total).toBe(0);
  });
  it("searches retained succeeded document fields, ignores failed extraction and keeps canonical stage",async()=>{
    const visible=await client(`TEST Registry OCR ${tag}`);
    const hidden=await client(`TEST Registry Hidden ${tag}`,other.staff.id);
    const token=`QXZ-retained-${tag}`;
    for(const item of [visible,hidden]) {
      const [doc]=await db`insert into documents(client_id,doc_type,storage_path,file_name,mime_type,size_bytes,status) values(${item.id},'photo_id',${`tests/registry/${randomUUID()}`},'synthetic.png','image/png',10,'needs_review') returning id`;
      await db`insert into document_extractions(document_id,client_id,provider,status,fields) values(${doc.id},${item.id},'synthetic','succeeded',${db.json([{field_name:"full_name",normalized_value:token}])})`;
      await db`insert into document_extractions(document_id,client_id,provider,status,fields) values(${doc.id},${item.id},'synthetic','failed',${db.json([{field_name:"full_name",normalized_value:`QXZ-failed-${tag}`}])})`;
    }
    expect((await operationalClientList(owner,"active",1,10,{q:token,stage:"new_intake"})).rows.map(row=>row.id)).toEqual([visible.id]);
    expect((await operationalClientList(admin,"active",1,10,{q:token,stage:"new_intake"})).total).toBe(2);
    expect((await operationalClientList(owner,"active",1,10,{q:`QXZ-failed-${tag}`,stage:"new_intake"})).total).toBe(0);
    await db`update clients set current_status='ready_to_apply' where id=${visible.id}`;
    expect((await operationalClientList(owner,"active",1,10,{q:token,stage:"new_intake"})).total).toBe(0);
    expect((await operationalClientList(owner,"active",1,10,{q:token,stage:"account_setup"})).total).toBe(1);
  });
  it("returns separate ten-row server pages and clamps a stale page",async()=>{
    const search=`RegistryPage-${tag}`;
    for(let index=0;index<13;index++)await client(`TEST ${search} ${index}`);
    const first=await operationalClientList(owner,"active",1,10,{q:search,stage:"new_intake"});
    const stalePage=parseRegistryFilters(new URLSearchParams("page=999999999999999999999"),true).page;
    const last=await operationalClientList(owner,"active",stalePage,10,{q:search,stage:"new_intake"});
    expect(first.total).toBe(13);expect(first.rows).toHaveLength(10);expect(last.rows).toHaveLength(3);expect(last.page).toBe(2);
    expect(new Set([...first.rows,...last.rows].map(row=>row.id)).size).toBe(13);
  });
  it("navigates forward and backward over equal timestamps without crossing staff scope",async()=>{
    const search=`RegistryCursor-${tag}`;
    const owned:string[] = [];
    for(let index=0;index<23;index++) owned.push(String((await client(`TEST ${search} ${index}`)).id));
    for(let index=0;index<3;index++) await client(`TEST ${search} hidden ${index}`,other.staff.id);
    await db`update clients set next_step='cursor fixture' where id=any(${owned}::uuid[])`;
    const expected=await db`select id from clients where full_name ilike ${`%${search}%`} and assigned_staff=${owner.staff.id} order by updated_at desc,id asc`;
    const filters={q:search,stage:"new_intake" as const};
    const first=await operationalClientList(owner,"active",1,10,filters);
    const second=await operationalClientList(owner,"active",2,10,filters,first.next_cursor);
    const third=await operationalClientList(owner,"active",3,10,filters,second.next_cursor);
    expect([first.rows.length,second.rows.length,third.rows.length]).toEqual([10,10,3]);
    expect([first.start,first.end,second.start,second.end,third.start,third.end]).toEqual([1,10,11,20,21,23]);
    expect([...first.rows,...second.rows,...third.rows].map(row=>row.id)).toEqual(expected.map(row=>row.id));
    expect(first.total).toBe(23);
    const back=await operationalClientList(owner,"active",2,10,filters,third.previous_cursor);
    const backFirst=await operationalClientList(owner,"active",1,10,filters,back.previous_cursor);
    expect(back.rows.map(row=>row.id)).toEqual(second.rows.map(row=>row.id));
    expect(backFirst.rows.map(row=>row.id)).toEqual(first.rows.map(row=>row.id));
    expect((await operationalClientList(other,"active",1,10,filters)).total).toBe(3);
    expect((await operationalClientList(other,"active",2,10,filters,first.next_cursor)).rows.every(row=>!owned.includes(row.id))).toBe(true);
    expect((await operationalClientList(owner,"active",2,10,filters)).rows.map(row=>row.id)).toEqual(second.rows.map(row=>row.id));
  });
  it("keeps registry counts and rows in one RLS-scoped snapshot across a concurrent deletion",async()=>{
    const search=`RegistrySnapshot-${randomUUID()}`;
    const mine=await client(`TEST ${search} own`);
    const hidden=await client(`TEST ${search} hidden`,other.staff.id);
    await withStaff(owner,async tx=>{
      const [mode]=await tx`select current_setting('transaction_isolation') as isolation,current_setting('transaction_read_only') as read_only`;
      expect(mode).toMatchObject({isolation:"repeatable read",read_only:"on"});
      const before=await tx`select id from clients where deleted_at is null and full_name ilike ${`%${search}%`} order by updated_at desc,id asc`;
      expect(before.map(row=>row.id)).toEqual([mine.id]);
      await db`update clients set deleted_at=now() where id=${mine.id}`;
      const [{count}]=await tx`select count(*)::int as count from clients where deleted_at is null and full_name ilike ${`%${search}%`}`;
      const after=await tx`select id from clients where deleted_at is null and full_name ilike ${`%${search}%`} order by updated_at desc,id asc`;
      expect(count).toBe(1);
      expect(after.map(row=>row.id)).toEqual(before.map(row=>row.id));
      expect(after.some(row=>row.id===hidden.id)).toBe(false);
    },{consistentRead:true});
    expect((await operationalClientList(owner,"active",1,10,{q:search,stage:"new_intake"})).total).toBe(0);
  });
});

describe("saved filter account isolation",()=>{
  it("persists own filters and prevents another staff or manager reading/writing them",async()=>{
    const [filter]=await withStaff(owner,tx=>tx`insert into staff_saved_filters(staff_id,name,filters) values(${owner.staff.id},${`My appointments ${tag}`},'{"stage":"appointments"}') returning id`);
    const read=await withStaff(owner,tx=>tx`select filters from staff_saved_filters where id=${filter.id}`);
    expect(read[0].filters).toEqual({stage:"appointments"});
    expect(await withStaff(other,tx=>tx`select id from staff_saved_filters where id=${filter.id}`)).toHaveLength(0);
    expect(await withStaff(admin,tx=>tx`select id from staff_saved_filters where id=${filter.id}`)).toHaveLength(0);
    expect(await withStaff(other,tx=>tx`delete from staff_saved_filters where id=${filter.id} returning id`)).toHaveLength(0);
    await expect(withStaff(other,tx=>tx`insert into staff_saved_filters(staff_id,name,filters) values(${owner.staff.id},'Forged owner','{}')`)).rejects.toMatchObject({code:"42501"});
    await expect(withStaff(owner,tx=>tx`update staff_saved_filters set staff_id=${other.staff.id} where id=${filter.id}`)).rejects.toMatchObject({code:"42501"});
  });
  it("keeps the new table and normalization helper inaccessible to anon",async()=>{
    await expect(db.begin(async tx=>{await tx.unsafe("set local role anon");return tx`select * from staff_saved_filters`;})).rejects.toMatchObject({code:"42501"});
    const [permissions]=await db`select has_function_privilege('anon','career_gate_private.normalize_search(text)','execute') as allowed`;
    expect(permissions.allowed).toBe(false);
  });
});
