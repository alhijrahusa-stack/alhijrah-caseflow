import { randomUUID } from 'node:crypto';
import { expect,test } from '@playwright/test';
import { POST_HIRE_ITEMS } from '../lib/domain';
import { accessToken,db,intakeBody,RUN,signIn,STAFF,staffAction,submitIntake,uniqueIp } from './helpers';

test('paid, completed legacy intake leaves active queues and retains its original appointment and ledger',async({request,browser,baseURL})=>{
  const intake=await submitIntake(request,intakeBody(`TEST Royal Workflow ${RUN}`));
  expect(intake.res.status(),JSON.stringify(intake.json)).toBe(201);
  const [client]=await db()`select id from clients where ref=${intake.json.ref}`;
  const unsafe=await request.post('/api/staff/operations',{headers:{cookie:`cg_at=${await accessToken('admin')}`,'x-forwarded-for':uniqueIp()},data:{operation:'move_stage',client_id:client.id,stage:'interview_passed'}});
  expect(unsafe.status()).toBe(409);
  const [actor]=await db()`select id from staff where auth_user_id=${STAFF.admin}`;
  const [appointment]=await db()`insert into appointments(client_id,appointment_type,scheduled_at,ends_at,resource_key,created_by_staff,status)
    values(${client.id},'Pre-hire appointment',now()-interval '4 days',now()-interval '4 days'+interval '30 minutes','office',${actor.id},'scheduled') returning id`;
  const context=await browser.newContext({baseURL,viewport:{width:1440,height:900}});
  await signIn(context,baseURL!,'admin');
  const page=await context.newPage();
  await page.goto(`/staff/client/${client.id}`);
  await page.getByRole('button',{name:/المسار والنقل اليدوي/}).click();
  await expect(page.getByLabel('Workflow destination')).toBeVisible();
  const forbidden=await staffAction(request,'admin',{action:'override_status',client_id:client.id,status:'completed',reason:'E2E completion must reject missing evidence'});
  expect(forbidden.status).toBeGreaterThanOrEqual(400);
  for(const item of POST_HIRE_ITEMS){
    const result=await staffAction(request,'admin',{action:'update_post_hire',client_id:client.id,item,status:'completed',note:'Verified E2E paperwork',...(item==='start_date'?{start_date:'2026-11-09'}:{})});
    expect(result.status,JSON.stringify(result.json)).toBe(200);
  }
  expect((await db()`select current_status from clients where id=${client.id}`)[0].current_status).not.toBe('completed');
  const paid=await request.post('/api/staff/accounting',{headers:{cookie:`cg_at=${await accessToken('admin')}`,'x-forwarded-for':uniqueIp()},data:{operation:'record_transaction',client_id:client.id,transaction_type:'payment',amount:150,payment_method:'cash',occurred_on:'2026-10-31',idempotency_key:randomUUID()}});
  expect(paid.status(),await paid.text()).toBe(200);
  expect((await db()`select current_status,pipeline_stage from clients where id=${client.id}`)[0]).toMatchObject({current_status:'completed',pipeline_stage:'completed_files'});
  await page.goto(`/staff/clients?q=${encodeURIComponent(intake.json.ref)}`);
  await expect(page.getByTestId('client-total')).toContainText('0 clients');
  await page.goto(`/staff/appointments?view=all&q=${encodeURIComponent(intake.json.ref)}`);
  await expect(page.getByText('No appointments in this view')).toBeVisible();
  await page.goto(`/staff/appointments?view=past&q=${encodeURIComponent(intake.json.ref)}`);
  await expect(page.getByText(intake.json.ref,{exact:true})).toBeVisible();
  await page.goto(`/staff/clients?view=completed&q=${encodeURIComponent(intake.json.ref)}`);
  await expect(page.getByTestId('client-total')).toContainText('1 client');
  expect(await db()`select id from appointments where id=${appointment.id}`).toHaveLength(1);
  expect(await db()`select id from payment_transactions where client_id=${client.id}`).toHaveLength(1);
  expect(await db()`select appointment_id from appointment_outcomes where client_id=${client.id}`).toHaveLength(0);
  await page.goto('/staff');
  await expect(page.locator('.royal-station')).toHaveCount(6);
  await page.getByRole('button',{name:'فتح مساعد الأوامر'}).click();
  await expect(page.getByTestId('command-palette')).toBeVisible();
  await context.close();
});

test('summary API requires authentication and serves private aggregated data',async({request})=>{
  expect((await request.get('/api/staff/dashboard-summary')).status()).toBe(401);
  const response=await request.get('/api/staff/dashboard-summary',{headers:{cookie:`cg_at=${await accessToken('admin')}`}});
  expect(response.status()).toBe(200);
  expect(response.headers()['cache-control']).toContain('no-store');
  const body=await response.json();
  expect(body.summary.stages).toHaveLength(6);
  expect(body.summary.priorities.length).toBeLessThanOrEqual(5);
  expect(body.summary.team.every((member:Record<string,unknown>)=>!('email' in member))).toBe(true);
});


test("staff navigation respects the existing management-only finance and audit boundaries",async({browser,baseURL})=>{
  const context=await browser.newContext({baseURL});
  await signIn(context,baseURL!,'staff');
  const page=await context.newPage();
  for(const path of ['/staff','/career-gate-royal.html']){
    await page.goto(path);
    await expect(page.getByRole('heading',{name:'Operations Command Center',exact:true})).toBeVisible();
    const links=await page.getByRole('link').evaluateAll(elements=>elements.map(element=>element.getAttribute('href')??''));
    expect(links.filter(href=>/^\/staff\/(accounting|reports|audit-alerts|import)(?:[/?]|$)/.test(href))).toEqual([]);
  }
  await context.close();
});
