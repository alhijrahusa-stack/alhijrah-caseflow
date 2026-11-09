import { expect, test } from "@playwright/test";
import { parseXlsx } from "../lib/intake-file";
import { accessToken, db, intakeBody, RUN, signIn, submitIntake } from "./helpers";

// Keep the mixed alphanumeric marker: its digits must never broaden a name
// search into unrelated phone matches elsewhere in the full shared-fixture suite.
const tag=`RegistryUX-${RUN}`;
const fixtures:{id:string;ref:string;name:string}[]=[];

test.beforeAll(async({request})=>{
  for(let index=0;index<13;index++) {
    const name=`TEST ${tag} Candidate ${index}`;
    const intake=await submitIntake(request,intakeBody(name));
    expect(intake.res.status(),JSON.stringify(intake.json)).toBe(201);
    const [row]=await db()`select id from clients where ref=${intake.json.ref}`;
    fixtures.push({id:String(row.id),ref:String(intake.json.ref),name});
  }
});

test("registry has ten real rows per page and instant search finds a record outside the current page",async({page,baseURL})=>{
  await signIn(page.context(),baseURL!,"admin");
  await page.goto(`/staff/clients?q=${tag}`);
  const rows=page.getByTestId("client-registry-responsive-cards").locator("article");
  await expect(rows).toHaveCount(10);
  await expect(page.getByTestId("client-total")).toHaveText("13 clients · page 1 of 2");
  await page.getByRole("link",{name:"Next",exact:true}).click();
  await expect(rows).toHaveCount(3);
  await expect(page.getByTestId("client-total")).toContainText("page 2 of 2");
  const outside=fixtures[12];
  await page.getByRole("combobox",{name:"Search clients",exact:true}).fill(outside.ref);
  await expect(page).toHaveURL(new RegExp(`q=${outside.ref}`));
  await expect(page.getByTestId("client-total")).toHaveText("1 client · page 1 of 1");
  await expect(page.locator('.royal-nav-item[aria-label="New Intake"]')).toHaveAttribute("aria-current","page");
  await expect(page.getByRole("link",{name:outside.name,exact:true})).toBeVisible();
  await expect(rows.locator("mark")).toContainText([outside.ref]);
  await expect(page.getByRole("link",{name:"Open Client ↗",exact:true})).toHaveAttribute("href",`/staff/client/${outside.id}`);
});

test("saved filters persist only for their owner and exports use the full matching server view",async({page,baseURL,request})=>{
  await signIn(page.context(),baseURL!,"admin");
  await page.goto(`/staff/clients?q=${tag}`);
  await page.getByTestId("registry-actions").locator("summary").click();
  await page.getByRole("button",{name:"Save filter",exact:true}).click();
  const name=`Registry filter ${RUN}`;
  await page.getByRole("textbox",{name:"Filter name",exact:true}).fill(name);
  await page.getByRole("button",{name:"Save current filters",exact:true}).click();
  await expect(page.getByRole("link",{name:`☆ ${name}`,exact:true})).toBeVisible();
  await page.reload();
  await expect(page.getByRole("link",{name:`☆ ${name}`,exact:true})).toBeVisible();
  const saved=await page.request.get("/api/staff/saved-filters");
  const data=await saved.json();
  const filter=data.filters.find((item:{name:string})=>item.name===name);
  expect(filter).toBeTruthy();
  const other=await request.get("/api/staff/saved-filters",{headers:{cookie:`cg_at=${await accessToken("staff")}`}});
  expect((await other.json()).filters.some((item:{id:string})=>item.id===filter.id)).toBe(false);
  const forbidden=await request.delete("/api/staff/saved-filters",{headers:{cookie:`cg_at=${await accessToken("staff")}`},data:{id:filter.id}});
  expect(forbidden.status()).toBe(404);

  const workbook=await page.request.get(`/api/staff/clients/export?q=${tag}&format=xlsx`);
  expect(workbook.status()).toBe(200);
  expect(workbook.headers()["cache-control"]).toBe("private, no-store");
  const exported=parseXlsx(await workbook.body());
  expect(exported).toHaveLength(13);
  expect(new Set(exported.map(row=>row.Reference))).toEqual(new Set(fixtures.map(row=>row.ref)));
  const printable=await page.request.get(`/api/staff/clients/export?q=${tag}&format=print`);
  expect(printable.status()).toBe(200);
  expect(await printable.text()).toContain(fixtures[0].name);
  await page.getByRole("button",{name:`Remove filter ${name}`,exact:true}).click();
  await expect(page.getByRole("link",{name:`☆ ${name}`,exact:true})).toHaveCount(0);
});

test("explicit filter navigation and browser history replace an uncommitted header draft without reviving its debounce",async({page,baseURL})=>{
  await signIn(page.context(),baseURL!,"admin");
  const name=`Header navigation ${RUN}`;
  const target=fixtures[1];
  const saved=await page.request.post("/api/staff/saved-filters",{data:{name,filters:{view:"active",q:target.ref}}});
  expect(saved.status(),await saved.text()).toBe(200);
  const filterId=String((await saved.json()).filter.id);
  try {
    await page.goto(`/staff/clients?q=${tag}`);
    const input=page.getByRole("combobox",{name:"Search clients",exact:true});
    await expect(input).toHaveValue(tag);
    const restored=page.getByRole("link",{name:`☆ ${name}`,exact:true});
    await expect(restored).toBeVisible();
    await page.getByTestId("registry-filters").locator("summary").click();

    // Keep each draft strictly before the 220ms search debounce. Explicit
    // navigation must cancel it, even after its original timer would fire.
    await page.clock.install();
    await page.clock.pauseAt(new Date());
    await input.fill(`UncommittedClear-${RUN}`);
    await page.getByRole("link",{name:"Clear filters",exact:true}).click();
    await expect.poll(()=>new URL(page.url()).searchParams.get("q")).toBeNull();
    await expect(input).toHaveValue("");
    await page.clock.runFor(500);
    expect(new URL(page.url()).searchParams.get("q")).toBeNull();

    await input.fill(`UncommittedRestore-${RUN}`);
    await restored.click();
    await expect.poll(()=>new URL(page.url()).searchParams.get("q")).toBe(target.ref);
    await expect(input).toHaveValue(target.ref);
    await page.clock.runFor(500);
    await expect(page.getByRole("link",{name:target.name,exact:true})).toBeVisible();
    expect(new URL(page.url()).searchParams.get("q")).toBe(target.ref);

    await input.fill(`UncommittedBack-${RUN}`);
    await page.goBack();
    await expect.poll(()=>new URL(page.url()).searchParams.get("q")).toBeNull();
    await expect(input).toHaveValue("");
    await page.clock.runFor(500);
    expect(new URL(page.url()).searchParams.get("q")).toBeNull();
    await page.goForward();
    await expect.poll(()=>new URL(page.url()).searchParams.get("q")).toBe(target.ref);
    await expect(input).toHaveValue(target.ref);

    await page.getByTestId("registry-actions").locator("summary").click();
    const exportHref=await page.getByRole("link",{name:/Excel/}).getAttribute("href");
    expect(new URL(exportHref!,baseURL).searchParams.get("q")).toBe(target.ref);
    await page.clock.resume();
  } finally {
    const removed=await page.request.delete("/api/staff/saved-filters",{data:{id:filterId}});
    expect(removed.status()).toBe(200);
  }
});
