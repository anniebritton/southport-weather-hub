// MOCKED ON PURPOSE: these tests force upstream failures (HTTP 503 / missing file), which the
// live NWS, NOAA, and CMP sources can't be made to produce on demand. Everything a working
// source can show is covered against the real backends in live-data.spec.js.
const { test, expect } = require("@playwright/test");

const DOWN = { status: 503, body: "Service Unavailable" };

test("every section falls back to a plain message when its source is down", async ({ page }) => {
  await page.route("https://api.weather.gov/**", (route) => route.fulfill(DOWN));
  await page.route("https://api.tidesandcurrents.noaa.gov/**", (route) => route.fulfill(DOWN));
  await page.route("**/data/outages.json", (route) => route.fulfill({ status: 404, body: "" }));
  await page.goto("/");

  for (const id of ["tile-weather", "tile-power", "tile-seas"]) {
    await expect(page.locator(`#${id} .tile-value`)).toHaveText("Unavailable");
  }
  await expect(page.locator("#alerts-status")).toHaveText("Couldn't load live alerts right now — use the weather.gov link below.");
  await expect(page.locator("#forecast-summary")).toContainText("Forecast unavailable");
  await expect(page.locator("#outage-stats")).toContainText("Live outage numbers unavailable");
  await expect(page.locator("#marine-status")).toHaveText("Couldn't load live marine conditions — use the links below.");
  await expect(page.locator("#tides-strip a")).toHaveAttribute("href", /noaatidepredictions\.html\?id=8416908/);
  for (const id of ["meter-mosquito", "meter-tick"]) {
    await expect(page.locator(`#${id} .meter-level`)).toHaveText("Unavailable");
  }
});

