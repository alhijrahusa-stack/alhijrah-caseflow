import { expect, test, type Page } from "@playwright/test";
import { CLIENT_STAGES } from "../lib/client-lifecycle-filters";
import { db, intakeBody, RUN, selectChoice, signIn, submitIntake } from "./helpers";

async function expectPhoneBounds(page: Page, width: number) {
  await page.setViewportSize({ width, height: 844 });
  await expect.poll(() => page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1)).toBe(true);
  const controls = page.locator('.registry-page input:visible,.registry-page button:visible,.registry-page [role="combobox"]:visible,.registry-page a:visible');
  for (const control of await controls.all()) {
    const box = await control.boundingBox();
    expect(box).not.toBeNull();
    expect(box!.x).toBeGreaterThanOrEqual(-1);
    expect(box!.x + box!.width).toBeLessThanOrEqual(width + 1);
  }
  for (const button of await page.locator(".registry-page .cg-workflow-control>button:visible").all()) {
    expect(await button.evaluate(element => element.scrollWidth <= element.clientWidth + 1)).toBe(true);
    expect(await button.evaluate(element => {
      const card = element.closest("article")!.getBoundingClientRect();
      const walker = document.createTreeWalker(element, NodeFilter.SHOW_TEXT);
      let node: Node | null;
      while ((node = walker.nextNode())) {
        if (!node.textContent?.trim()) continue;
        const range = document.createRange();
        range.selectNodeContents(node);
        for (const bounds of range.getClientRects()) if (bounds.left < card.left - 1 || bounds.right > card.right + 1) return false;
      }
      return true;
    })).toBe(true);
  }
  const bulkControls = page.locator('.registry-bulk-controls [role="combobox"]:visible');
  await expect(bulkControls).toHaveCount(2);
  for (const control of await bulkControls.all()) expect((await control.boundingBox())!.width).toBeGreaterThanOrEqual(150);
}

test("compact registry keeps eight real stage counts, pointer spotlight, filters and mobile controls usable", async ({ browser, request, baseURL }, testInfo) => {
  const name = `TEST Compact Registry ${RUN}`;
  const intake = await submitIntake(request, intakeBody(name));
  expect(intake.res.status(), JSON.stringify(intake.json)).toBe(201);
  const context = await browser.newContext({ baseURL, viewport: { width: 1920, height: 1080 } });
  try {
    await signIn(context, baseURL!, "admin");
    const page = await context.newPage();
    const errors: string[] = [];
    page.on("pageerror", error => errors.push(error.message));
    await page.goto(`/staff/clients?q=${intake.json.ref}`);
    const dock = page.getByTestId("client-stage-dock");
    const links = dock.locator("a[data-stage]");
    await expect(links).toHaveCount(8);
    const occupancy = await db()`select operational_location,count(*)::int total from clients group by operational_location`;
    const counts = new Map(occupancy.map(row => [String(row.operational_location), Number(row.total)]));
    for (const station of CLIENT_STAGES.filter(station => station.id !== "worksite_change")) {
      const link = dock.locator(`a[data-stage="${station.id}"]`);
      await expect(link).toHaveAttribute("href", station.href);
      await expect(link.locator(".registry-stage-count")).toHaveText((counts.get(station.id) ?? 0).toLocaleString("en-US"));
    }
    for (const width of [1440, 1920]) {
      await page.setViewportSize({ width, height: 1080 });
      const boxes = await links.evaluateAll(elements => elements.map(element => { const box = element.getBoundingClientRect(); return { y: box.y, height: box.height }; }));
      expect(Math.max(...boxes.map(box => box.y)) - Math.min(...boxes.map(box => box.y))).toBeLessThanOrEqual(1);
      expect((await dock.boundingBox())!.height).toBeLessThanOrEqual(110);
    }
    const stage = links.first();
    const before = await stage.boundingBox();
    expect(before).not.toBeNull();
    await page.mouse.move(before!.x + 15, before!.y + 20);
    const firstSpot = await stage.evaluate(element => element.style.getPropertyValue("--registry-spot-x"));
    await page.mouse.move(before!.x + before!.width - 15, before!.y + 25);
    await expect.poll(() => stage.evaluate(element => element.style.getPropertyValue("--registry-spot-x"))).not.toBe(firstSpot);
    const after = await stage.boundingBox();
    expect(after!.width).toBeCloseTo(before!.width, 1);
    expect(after!.height).toBeCloseTo(before!.height, 1);
    const border = await stage.evaluate(element => getComputedStyle(element).borderTopColor);
    const channels = border.match(/[\d.]+/g)!.map(Number);
    expect(channels[0]).toBeGreaterThan(channels[1]);
    expect(channels[1]).toBeGreaterThan(channels[2]);

    const cards = page.getByTestId("client-registry-responsive-cards");
    const card = cards.locator("article").filter({ hasText: name });
    await expect(card).toBeVisible();
    const emerald = await card.evaluate(element => getComputedStyle(element).borderTopColor);
    const emeraldChannels = emerald.match(/[\d.]+/g)!.map(Number);
    expect(emeraldChannels[1]).toBeGreaterThan(emeraldChannels[0]);
    expect(emeraldChannels[1]).toBeGreaterThan(emeraldChannels[2]);
    const deck = page.locator(".registry-command-deck");
    await expect(deck).toBeVisible();
    expect((await deck.boundingBox())!.height).toBeLessThanOrEqual(185);
    await expect(page.getByRole("tablist", { name: "Client lifecycle views" })).toBeVisible();
    await expect(page.getByRole("link", { name: /Excel/ })).toHaveAttribute("href", new RegExp(`q=${intake.json.ref}.*format=xlsx`));
    await expect(page.getByRole("link", { name: /Print \/ Save PDF/ })).toHaveAttribute("href", new RegExp(`q=${intake.json.ref}.*format=print`));
    await page.screenshot({ path: testInfo.outputPath("clients-compact-desktop.png"), fullPage: true, animations: "disabled" });
    await selectChoice(page.getByLabel("Status", { exact: true }), "new_intake");
    await expect(page).toHaveURL(/status=new_intake/);
    await selectChoice(page.getByLabel("Filter by specialist", { exact: true }), "none");
    await expect(page).toHaveURL(/assigned=none/);
    await expect(card).toBeVisible();
    await expect(page.getByTestId("client-total")).toHaveText("1 client · page 1 of 1");

    for (const width of [390, 320]) {
      await expectPhoneBounds(page, width);
      await page.screenshot({ path: testInfo.outputPath(`clients-compact-phone-${width}.png`), fullPage: true, animations: "disabled" });
    }
    await page.getByTestId("staff-language-toggle").click();
    await expect(page.getByRole("heading", { name: "سجل العملاء", exact: true })).toBeVisible();
    for (const width of [320, 390]) {
      await expectPhoneBounds(page, width);
      await page.screenshot({ path: testInfo.outputPath(`clients-compact-phone-${width}-ar.png`), fullPage: true, animations: "disabled" });
    }
    await page.setViewportSize({ width: 1920, height: 1080 });
    await page.evaluate(() => scrollTo(0, 0));
    await page.screenshot({ path: testInfo.outputPath("clients-compact-desktop-ar.png"), fullPage: true, animations: "disabled" });
    expect(errors).toEqual([]);
  } finally { await context.close(); }
});
