// MOCKED ON PURPOSE: feeds the page malformed and hostile upstream data (NWS, NOAA, CMP-derived
// file) that the live sources can't be made to produce. Guards against script injection and against
// "looks fine" results when data is junk, aging or expired (false reassurance).
const { test, expect } = require("@playwright/test");

const PAYLOAD = "<img src=x onerror=window.__pwned=1>";
const json = (body, status = 200) => ({ status, contentType: "application/json", body: JSON.stringify(body) });

function easternNow(offsetMs = 0) {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: "America/New_York", hourCycle: "h23",
    year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", second: "2-digit",
  }).formatToParts(new Date(Date.now() + offsetMs)).reduce((o, p) => ({ ...o, [p.type]: p.value }), {});
  return `${parts.year}-${parts.month}-${parts.day} ${parts.hour}:${parts.minute}:${parts.second}`;
}

function goodOutages(overrides = {}) {
  return {
    lastUpdated: easternNow(-5 * 60 * 1000),
    totals: { customers: 690000, outages: 12, incidents: 3 },
    southport: null,
    lincolnCounty: null,
    towns: [],
    ...overrides,
  };
}

async function mockSources(page, { alerts, forecast, outages } = {}) {
  await page.route("https://api.weather.gov/alerts/**", (r) => r.fulfill(alerts ?? json({ features: [] })));
  await page.route("https://api.weather.gov/gridpoints/**", (r) => r.fulfill(forecast ?? json({}, 503)));
  await page.route("https://api.weather.gov/products/**", (r) => r.fulfill(json({}, 503)));
  await page.route("https://api.tidesandcurrents.noaa.gov/**", (r) => r.fulfill(json({}, 503)));
  await page.route("**/data/outages.json", (r) => r.fulfill(outages ?? json(goodOutages())));
}

test.beforeEach(async ({ page }, testInfo) => {
  const errors = [];
  page.on("pageerror", (err) => errors.push(err.message));
  testInfo.pageErrors = errors;
});

test.afterEach(async ({ page }, testInfo) => {
  expect(testInfo.pageErrors, "uncaught page errors").toEqual([]);
  expect(await page.evaluate(() => window.__pwned), "injected script ran").toBeUndefined();
});

test("a hostile NWS temperature value cannot inject markup", async ({ page }) => {
  const period = { name: "Today", temperatureUnit: "F", detailedForecast: "Sunny.", temperature: PAYLOAD };
  await mockSources(page, { forecast: json({ properties: { periods: [period] } }) });
  await page.goto("/");
  await expect(page.locator("#forecast-summary .forecast-card")).toHaveCount(1);
  await expect(page.locator("#forecast-summary img")).toHaveCount(0);
  await expect(page.locator("#forecast-summary .temp")).toHaveText("—°F");
});

test("a hostile outage count cannot inject markup and is not shown as 'power on'", async ({ page }) => {
  await mockSources(page, { outages: json(goodOutages({ southport: { Outages: PAYLOAD } })) });
  await page.goto("/#outages");
  await expect(page.locator("#outage-stats img")).toHaveCount(0);
  await expect(page.locator("#tile-power .tile-value")).toHaveText("Unavailable");
  await expect(page.locator("#outage-stats")).toContainText("Live outage numbers unavailable");
});

test("one malformed alert cannot hide the other alerts", async ({ page }) => {
  const bad = { properties: { severity: "Severe", event: "Wind Advisory", instruction: 5, description: null, headline: PAYLOAD } };
  const good = { properties: { severity: "Moderate", event: "Small Craft Advisory", headline: "Small Craft Advisory in effect", description: "Seas 5 to 7 ft." } };
  await mockSources(page, { alerts: json({ features: [bad, null, good] }) });
  await page.goto("/");
  await expect(page.locator("#alerts-list .alert-card")).toHaveCount(2);
  await expect(page.locator("#alerts-list")).toContainText("Small Craft Advisory in effect");
  await expect(page.locator("#alerts-list img")).toHaveCount(0);
  await expect(page.locator("#tile-weather .tile-value")).not.toHaveText("Unavailable");
});

test("an alerts reply without a features list is 'unavailable', never 'all clear'", async ({ page }) => {
  await mockSources(page, { alerts: json({ title: "Server error", status: 200 }) });
  await page.goto("/");
  await expect(page.locator("#tile-weather .tile-value")).toHaveText("Unavailable");
  await expect(page.locator("#alerts-list")).not.toContainText("All clear");
});

test("an empty or junk outage file is 'unavailable', never 'power on'", async ({ page }) => {
  for (const body of [{}, { lastUpdated: null, totals: { outages: null } }, { lastUpdated: "garbage", totals: { outages: 1 } }]) {
    await mockSources(page, { outages: json(body) });
    await page.goto("/#outages");
    await expect(page.locator("#tile-power .tile-value")).toHaveText("Unavailable");
    await expect(page.locator("#outage-stats")).toContainText("Live outage numbers unavailable");
  }
});

test("aging outage data keeps its numbers but is marked last-known, not current", async ({ page }) => {
  // 3 hours old: typical when GitHub throttles the scheduled job
  const threeHoursAgo = easternNow(-3 * 3600 * 1000);
  await mockSources(page, { outages: json(goodOutages({ lastUpdated: threeHoursAgo, southport: null, lincolnCounty: null })) });
  await page.goto("/#outages");
  const tile = page.locator("#tile-power");
  await expect(tile.locator(".tile-value")).toHaveText("Last known: On");
  await expect(tile.locator(".tile-sub")).toContainText("3 hours ago");
  await expect(tile).not.toHaveClass(/is-ok|is-warn|is-bad/);
  const cards = page.locator("#outage-stats .stat-card");
  await expect(cards).toHaveCount(3);
  for (let i = 0; i < 3; i++) {
    await expect(cards.nth(i)).toHaveClass(/stat-aging/);
    await expect(cards.nth(i)).not.toHaveClass(/stat-ok|stat-bad/);
    await expect(cards.nth(i)).toContainText("last known");
  }
  await expect(page.locator("#outage-updated")).toContainText("Last updated 3 hours ago");
  await expect(page.locator("#outage-updated")).toContainText("GitHub can delay");
});

test("aging data with an outage in Southport is not styled as a live red alert", async ({ page }) => {
  await mockSources(page, { outages: json(goodOutages({ lastUpdated: easternNow(-4 * 3600 * 1000), southport: { Outages: 7 } })) });
  await page.goto("/#outages");
  await expect(page.locator("#tile-power .tile-value")).toHaveText("Last known: 7 out");
  await expect(page.locator("#tile-power")).not.toHaveClass(/is-bad/);
  await expect(page.locator("#outage-stats .stat-card").first()).not.toHaveClass(/stat-bad/);
});

test("outage data older than 12 hours is unavailable, with a pointer to CMP", async ({ page }) => {
  await mockSources(page, { outages: json(goodOutages({ lastUpdated: easternNow(-13 * 3600 * 1000) })) });
  await page.goto("/#outages");
  await expect(page.locator("#tile-power .tile-value")).toHaveText("Unavailable");
  await expect(page.locator("#tile-power .tile-sub")).toContainText("check CMP");
  await expect(page.locator("#outage-stats .stat-card")).toHaveCount(0);
  await expect(page.locator("#outage-stats")).toContainText("Live outage numbers unavailable");
  await expect(page.locator("#outage-updated")).toContainText("13 hours");
});

test("an outage timestamp from the future or an impossible date is unavailable", async ({ page }) => {
  for (const lastUpdated of [easternNow(2 * 3600 * 1000), "2999-01-01 00:00:00", "2026-02-30 12:00:00", "2026-13-01 12:00:00", "2026-01-15 25:00:00"]) {
    await mockSources(page, { outages: json(goodOutages({ lastUpdated })) });
    await page.goto("/#outages");
    await expect(page.locator("#tile-power .tile-value"), lastUpdated).toHaveText("Unavailable");
    await expect(page.locator("#outage-stats")).toContainText("Live outage numbers unavailable");
  }
});

test("fresh outage data (inside 90 minutes) still renders as current", async ({ page }) => {
  await mockSources(page, { outages: json(goodOutages({ lastUpdated: easternNow(-80 * 60 * 1000) })) });
  await page.goto("/#outages");
  await expect(page.locator("#tile-power .tile-value")).toHaveText("On");
  await expect(page.locator("#tile-power")).toHaveClass(/is-ok/);
  await expect(page.locator("#outage-stats .stat-card").first()).toHaveClass(/stat-ok/);
});

test("fresh outage data still renders normally", async ({ page }) => {
  await mockSources(page, { outages: json(goodOutages({ southport: { Outages: 7 }, lincolnCounty: { Outages: 9 } })) });
  await page.goto("/#outages");
  await expect(page.locator("#tile-power .tile-value")).toHaveText("7 out");
  await expect(page.locator("#outage-stats .stat-card").nth(0)).toContainText("7 customers out in Southport");
  await expect(page.locator("#outage-updated")).not.toContainText("out of date");
});
