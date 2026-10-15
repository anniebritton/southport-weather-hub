// Real integration: the page as served, against live NWS, NOAA tides, and the committed CMP outage data.
const { test, expect } = require("@playwright/test");
const fs = require("node:fs");
const path = require("node:path");

test.beforeEach(async ({ page }, testInfo) => {
  const errors = [];
  page.on("pageerror", (err) => errors.push(err.message));
  testInfo.pageErrors = errors;
});

test.afterEach(async ({}, testInfo) => {
  expect(testInfo.pageErrors, "uncaught page errors").toEqual([]);
});

test("all three status tiles load live values", async ({ page }) => {
  await page.goto("/");
  for (const id of ["tile-weather", "tile-power", "tile-seas"]) {
    const value = page.locator(`#${id} .tile-value`);
    await expect(value).not.toHaveClass(/skeleton/);
    await expect(value, `${id} fell back to Unavailable`).not.toHaveText("Unavailable");
  }
});

test("weather tile and alert list agree with the NWS alerts the page received", async ({ page }) => {
  // Read the page's own live response so the comparison can't race a separately fetched snapshot
  const alertsResponse = page.waitForResponse((r) => r.url().startsWith("https://api.weather.gov/alerts/active"));
  await page.goto("/");
  const res = await alertsResponse;
  expect(res.ok()).toBeTruthy();
  const alerts = (await res.json()).features;

  const tile = page.locator("#tile-weather .tile-value");
  await expect(tile).not.toHaveClass(/skeleton/);
  if (alerts.length === 0) {
    await expect(tile).toHaveText("All clear");
    await expect(page.locator("#alerts-list")).toContainText("No active weather alerts for Southport");
  } else {
    await expect(tile).toHaveText(alerts[0].properties.event);
    await expect(page.locator("#alerts-list .alert-card")).toHaveCount(alerts.length);
    await expect(page.locator("#alerts-status")).toHaveText(`${alerts.length} active alert${alerts.length > 1 ? "s" : ""}:`);
  }
});

test("forecast shows the next four NWS periods with temperatures", async ({ page }) => {
  await page.goto("/");
  const cards = page.locator("#forecast-summary .forecast-card");
  await expect(cards).toHaveCount(4);
  for (const temp of await cards.locator(".temp").allTextContents()) {
    expect(temp).toMatch(/^-?\d+°F$/);
  }
});

test("power section matches data/outages.json", async ({ page }) => {
  const data = JSON.parse(fs.readFileSync(path.join(__dirname, "../../data/outages.json"), "utf8"));
  const sp = data.southport?.Outages ?? 0;
  const lc = data.lincolnCounty?.Outages ?? 0;

  await page.goto("/#outages");
  const stats = page.locator("#outage-stats .stat-card");
  await expect(stats).toHaveCount(3);
  await expect(stats.nth(0)).toContainText(sp ? `${sp.toLocaleString("en-US")} customers out in Southport` : "No outages in Southport");
  await expect(stats.nth(1)).toContainText(lc ? `${lc.toLocaleString("en-US")} customers out in Lincoln County` : "No outages in Lincoln County");
  await expect(stats.nth(2)).toContainText(`${data.totals.outages.toLocaleString("en-US")} customers out across all of CMP`);
  await expect(page.locator("#outage-updated")).toContainText(`CMP data as of ${data.lastUpdated}`);

  const expectedTile = sp ? `${sp.toLocaleString("en-US")} out` : lc ? "On in Southport" : "On";
  await expect(page.locator("#tile-power .tile-value")).toHaveText(expectedTile);
});

test("marine forecast parses the live ANZ152 coastal waters forecast", async ({ page }) => {
  await page.goto("/#marine");
  const periods = page.locator("#marine-forecast .marine-period");
  await expect(periods.first()).toBeVisible();
  await expect(page.locator("#marine-status")).toHaveText("");
  expect(await periods.count()).toBeLessThanOrEqual(4);
  for (const name of await periods.locator("h4").allTextContents()) {
    expect(name).toMatch(/^[A-Z][A-Z .]*$/);
  }
  // Every ANZ152 forecast period states seas (including "1 foot or less"), so the tile always shows a height
  await expect(page.locator("#tile-seas .tile-value")).toHaveText(/ ft seas$/);
});

test("tides show the next four NOAA highs and lows and a 24-hour chart", async ({ page }) => {
  await page.goto("/#marine");
  const chips = page.locator("#tides-strip .tide-chip");
  await expect(chips).toHaveCount(4);
  await expect(chips.first()).toContainText("(next)");
  const types = await chips.locator(".tide-type").allTextContents();
  for (let i = 1; i < types.length; i++) {
    expect(types[i].startsWith("High"), "highs and lows alternate").not.toBe(types[i - 1].startsWith("High"));
  }
  await expect(page.locator("#tide-chart svg.tide-chart-svg")).toBeVisible();
  await expect(page.locator("#tide-chart .tide-marker").first()).toBeAttached();
});

test("pest meters score today from the live hourly forecast", async ({ page }) => {
  await page.goto("/#pests");
  for (const id of ["meter-mosquito", "meter-tick"]) {
    const level = page.locator(`#${id} .meter-level`);
    await expect(level).toHaveText(/^(Low|Moderate|High|Very High)$/);
    const label = await level.textContent();
    await expect(page.locator(`#${id}`)).toHaveAttribute("data-level", label.toLowerCase().replace(" ", "-"));
    await expect(page.locator(`#${id} .meter-day`)).toHaveCount(3);
    await expect(page.locator(`#${id} .meter-why`)).not.toBeEmpty();
  }
});
