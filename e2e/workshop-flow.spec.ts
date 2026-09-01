import { expect, test, type BrowserContext, type Page } from "@playwright/test";

test("facilitator and two players complete a fuel-limited game", async ({ browser, page }) => {
  const code = `E2E${String(Date.now()).slice(-7)}`;

  await page.goto("/host");
  await page.getByLabel("Facilitator PIN").fill("workshop");
  await page.getByRole("button", { name: "Continue" }).click();
  await page.getByRole("button", { name: "New game" }).first().click();

  await fillNumber(page, "Number of groups", "1");
  await fillNumber(page, "Fishers per group", "2");
  await page.getByLabel("Session name").fill(`Browser session ${code}`);
  await page.getByLabel("Group name").fill("Browser Group");
  await page.getByLabel("Game code").fill(code);
  await page.getByRole("button", { name: "Fuel", exact: true }).click();
  await fillNumber(page, "Fuel per fisher", "3");
  await fillNumber(page, "Maximum seasons", "2");
  await fillNumber(page, "Food needed per fisher", "0");
  await page.getByRole("button", { name: "Create and open" }).click();

  await expect(page).toHaveURL(new RegExp(`/host/${code}$`));
  await expect(page.getByText(code, { exact: true })).toBeVisible();

  const participantDevice = { viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true };
  const firstContext = await browser.newContext(participantDevice);
  const secondContext = await browser.newContext(participantDevice);
  const first = await joinPlayer(firstContext, code, "Ada");
  const second = await joinPlayer(secondContext, code, "Ben");

  await expect(first.getByText("2 / 2 fishers")).toBeVisible();
  await first.getByRole("button", { name: "I'm ready" }).click();
  await second.getByRole("button", { name: "I'm ready" }).click();

  const start = page.getByRole("button", { name: "Start game" });
  await expect(start).toBeEnabled();
  await start.click();

  await fishOnce(first);
  await fishOnce(second);
  await expect(first.getByRole("button", { name: "I'm ready" })).toBeVisible();

  await first.getByRole("button", { name: "I'm ready" }).click();
  await second.getByRole("button", { name: "I'm ready" }).click();

  await fishOnce(first);
  await fishOnce(second, false);

  await expect(first.locator(".final-results .extraction-total strong")).toHaveText("20");
  await expect(second.locator(".final-results .extraction-total strong")).toHaveText("20");
  await expect(page.getByText("Round result", { exact: true })).toBeVisible();

  if (process.env.UPDATE_README_SCREENSHOT === "1") {
    await page.screenshot({
      path: "docs/images/commons-fishery-facilitator.png",
      fullPage: true,
    });
  }

  await firstContext.close();
  await secondContext.close();
});

async function fillNumber(page: Page, label: string, value: string) {
  const input = page.getByLabel(label);
  await input.fill(value);
  await input.blur();
}

async function joinPlayer(context: BrowserContext, code: string, name: string): Promise<Page> {
  const page = await context.newPage();
  await page.goto(`/play/${code}`);
  await page.getByLabel("Display name").fill(name);
  await page.getByRole("button", { name: "Join game" }).click();
  await expect(page.locator(".player-header")).toContainText(name);
  return page;
}

async function fishOnce(page: Page, expectFuelIndicator = true) {
  const fish = page.locator(".fish-button").first();
  await expect(fish).toBeEnabled({ timeout: 15_000 });
  await fish.click();
  if (expectFuelIndicator) await expect(page.getByLabel("1 fuel units remaining")).toBeVisible();
}
