import { expect, test, type APIRequestContext } from "@playwright/test";
import { AMAZON_INTERVIEW_SITES, warehouseLocation } from "../lib/amazon-interview-sites";
import { db, intakeBody, signIn, staffAction, submitIntake } from "./helpers";

async function createClient(request: APIRequestContext, name: string) {
  const result=await submitIntake(request,intakeBody(name));
  expect(result.res.status(),JSON.stringify(result.json)).toBe(201);
  const [client]=await db()`select id,full_name from clients where ref=${result.json.ref}`;
  return {id:String(client.id),name:String(client.full_name)};
}

test("client-only conflicts are atomic over HTTP and rejected reschedules retain the original row", async ({request})=>{
  const a=await createClient(request,"TEST Appointment HTTP A");
  const b=await createClient(request,"TEST Appointment HTTP B");
  const site=AMAZON_INTERVIEW_SITES[0];
  const start=new Date(Date.now()+120*86_400_000).toISOString();
  const payload={action:"schedule_appointment",appointment_type:"HTTP concurrency",scheduled_at:start,duration_minutes:30,resource_key:"office",location:warehouseLocation(site),approve_booking:true};
  const race=await Promise.all([
    staffAction(request,"manager",{...payload,client_id:a.id}),
    staffAction(request,"manager",{...payload,client_id:a.id}),
  ]);
  expect(race.map(result=>result.status).sort()).toEqual([200,409]);
  expect(race.find(result=>result.status===409)?.json.error.code).toBe("client_appointment_overlap");
  expect((await db()`select count(*)::int n from appointments where client_id=${a.id}`)[0].n).toBe(1);
  expect((await staffAction(request,"manager",{...payload,client_id:b.id})).status).toBe(200);
  const secondTime=new Date(new Date(start).getTime()+3*3_600_000).toISOString();
  const second=await staffAction(request,"manager",{...payload,client_id:a.id,scheduled_at:secondTime});
  expect(second.status).toBe(200);
  const id=String(second.json.appointment_id);
  expect((await staffAction(request,"manager",{action:"update_appointment",appointment_id:id,scheduled_at:start})).status).toBe(409);
  const [unchanged]=await db()`select scheduled_at,status from appointments where id=${id}`;
  expect(new Date(unchanged.scheduled_at).toISOString()).toBe(secondTime);
  expect(unchanged.status).toBe("confirmed");
  expect((await db()`select count(*)::int n from appointments where client_id=${a.id}`)[0].n).toBe(2);
  const unauthenticated=await request.post("/api/staff/action",{data:{...payload,client_id:a.id}});
  expect(unauthenticated.status()).toBe(401);
  expect((await staffAction(request,"staff",{...payload,client_id:a.id})).status).toBe(403);
});

for (const width of [1366,390]) {
  test(`warehouse selection and Manage Appointment preserve client and appointment at ${width}px`,async ({browser,baseURL,request})=>{
    const client=await createClient(request,`TEST Appointment UI ${width}`);
    const context=await browser.newContext({baseURL,viewport:{width,height:width===390?844:900},permissions:["clipboard-read","clipboard-write"]});
    await signIn(context,baseURL!,"admin");
    const page=await context.newPage();
    await page.goto(`/staff/client/${client.id}`);
    await page.getByTestId("quick-actions").getByRole("button",{name:"Add Appointment"}).click();
    const form=page.getByTestId("form-appointment");
    await form.getByRole("button",{name:/اختيار موقع مستودع أمازون/}).click();
    const picker=page.getByRole("dialog",{name:"Amazon warehouse location picker"});
    await expect(picker).toBeVisible();
    await expect(picker.locator("button[aria-pressed]")).toHaveCount(11);
    await page.keyboard.press("Escape");
    await expect(picker).toHaveCount(0);
    await expect(form).toBeVisible();
    await form.getByRole("button",{name:/اختيار موقع مستودع أمازون/}).click();
    await expect(picker).toBeVisible();
    const search=picker.getByRole("searchbox");
    for(const query of ["DTW1","Romulus","Fulfillment Center","32801 Ecorse"]) {
      await search.fill(query);
      await expect(picker.getByRole("button",{name:/Romulus DTW1/})).toBeVisible();
    }
    await search.fill("DTW1");
    await picker.getByRole("button",{name:"Copy address for DTW1"}).click();
    await expect(picker.getByRole("status")).toHaveText("Address copied");
    expect(await page.evaluate(()=>navigator.clipboard.readText())).toBe(AMAZON_INTERVIEW_SITES[0].address);
    await picker.getByRole("button",{name:/Romulus DTW1/}).click();
    await expect(picker.getByRole("link",{name:"Maps",exact:true})).toHaveAttribute("href",/google\.com\/maps\/search/);
    await picker.getByRole("button",{name:"تأكيد واختيار الموقع"}).click();
    const localDate=new Date(Date.now()+100*86_400_000).toISOString().slice(0,10);
    await form.getByLabel("Or a specific date & time (Michigan time)").fill(`${localDate}T10:30`);
    await expect(form.getByRole("region",{name:"Review appointment before approval"})).toContainText(client.name);
    await form.getByRole("button",{name:"Approve & Save appointment"}).click();
    await expect(page.getByTestId("appointment-row")).toHaveCount(1);
    const [created]=await db()`select id,location_id from appointments where client_id=${client.id}`;
    expect(created.location_id).toBe("DTW1");
    await page.getByRole("button",{name:"Edit / Reschedule"}).click();
    const modal=page.getByTestId("reschedule-modal");
    await expect(modal).toBeVisible();
    await expect(modal.getByRole("region",{name:"Review appointment changes"})).toContainText(client.name);
    await modal.getByRole("button",{name:/Romulus · DTW1/}).click();
    await expect(picker).toBeVisible();
    await page.keyboard.press("Escape");
    await expect(picker).toHaveCount(0);
    await expect(modal).toBeVisible();
    await modal.getByRole("button",{name:/Romulus · DTW1/}).click();
    await picker.getByRole("searchbox").fill("DET1");
    await picker.getByRole("button",{name:/Livonia DET1/}).click();
    await picker.getByRole("button",{name:"تأكيد واختيار الموقع"}).click();
    await modal.getByTestId("input-new-date-time").fill(`${localDate}T11:30`);
    await expect(modal.getByRole("region",{name:"Review appointment changes"})).toContainText("DET1");
    expect(await modal.evaluate(element=>element.scrollWidth-element.clientWidth)).toBeLessThanOrEqual(1);
    await modal.getByTestId("button-confirm-reschedule").click();
    await expect(modal).toHaveCount(0);
    const rows=await db()`select id,location_id,status from appointments where client_id=${client.id}`;
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({id:created.id,location_id:"DET1",status:"rescheduled"});
    await context.close();
  });
}
