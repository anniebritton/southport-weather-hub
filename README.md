# Southport Island Weather Hub

**Live site: [anniebritton.github.io/southport-weather-hub](https://anniebritton.github.io/southport-weather-hub/)**

One page where residents of Southport Island, Maine can check everything that matters before, during, and after severe weather — without needing to know which agency's website to visit:

- ⚠️ **Live weather alerts and forecast** from the National Weather Service, with plain-language "what this means for Southport" translations
- 🔌 **Power outage numbers** straight from Central Maine Power's data, refreshed every 15 minutes
- ⛵ **Marine conditions** — wind, seas, wave heights, and tides at Southport's own gauge
- 🔥 **Daily fire danger** from the Maine Forest Service
- 🦟 **Mosquito and tick activity estimates** computed from the day's forecast
- 🗺️ **Long-term climate risk** — sea level rise, drought, and well-water resources
- 🖨️ **A printable "fridge card"** with emergency numbers and checklists that work when the power doesn't
- ⛈️ **Storm Mode** — when the NWS issues a severe warning for the island, the whole site automatically switches to a red alert layout with a preparedness checklist, tide timing, and the utility's phone number front and center ([preview it here](https://anniebritton.github.io/southport-weather-hub/?storm=demo))

Built for an audience that skews older and non-technical: large type, high contrast, plain language, WCAG-minded markup, and no app to install.

## Why this design

Small rural communities rarely get purpose-built emergency tools. The information exists — but it's scattered across a utility portal, weather.gov, a state forestry map, and a county planning office, each with its own navigation. This site is the "one bookmark" answer: **zero backend, zero cost, near-zero maintenance**, hosted free on GitHub Pages as plain HTML/CSS/JS with no build step. Anyone who can edit a text file can maintain it.

## Adapting this for your community

Everything here is reusable. If your town faces hurricanes, wildfires, or outages — especially rural places where residents juggle a utility site, a state agency, and a county office — you can stand up a version in an afternoon. Fork the repo and work through these:

### 1. Point the weather at your town

All location constants live at the top of `app.js` and `pests.js`. Get yours from the (free, keyless) NWS API — visit `https://api.weather.gov/points/{lat},{lon}` for your coordinates and pull out:

| Constant | What it is | Southport's value |
|---|---|---|
| `ALERTS_ZONE` | NWS forecast zone for alerts | `MEZ026` |
| `FORECAST_URL` / `HOURLY_FORECAST_URL` | your gridpoint forecast URLs | `GYX/90,70` |
| `MARINE_ZONE_CODE` | coastal waters zone (delete the marine tab if you're inland) | `ANZ152` |
| radar image URL in `index.html` | your nearest NWS radar station | `KGYX` |
| `TIDE_STATION` | nearest NOAA tide station ([station list](https://tidesandcurrents.noaa.gov/)) | `8416908` |

The tests check some of these values too (the marine zone and forecast office in `tests/unit/app-helpers.test.js`, the tide station in `tests/e2e/fallbacks.spec.js`), so update them alongside `app.js`.

### 2. Point the outage data at your utility

This is the one piece that varies most. Southport's utility (CMP/Avangrid) blocks both embedding and cross-origin API calls, so `.github/workflows/outages.yml` runs every 15 minutes, fetches the utility's public data server-side, and commits `data/outages.json` for the page to read (the "git scraping" pattern — free on GitHub Actions). For your utility:

- **If they use Kubra Storm Center** (many US utilities): their API is openly CORS-enabled — you may be able to fetch it directly from the browser and skip the workflow entirely. Look for `kubra.io/stormcenter/api` requests in your browser's dev tools on the outage map page.
- **If they're Avangrid-family** (CMP, UI, RG&E, NYSEG…): adapt `scripts/fetch-outages.sh` — the pattern is identical, just swap the API host and the public subscription key from your utility's outage map request headers.
- **If nothing works**: fall back to a prominent link. A reliable button beats a broken widget.

### 3. Swap the state-level resources

The fire danger map, drought monitor image, climate flood map, and pest resources are all state or national tools with equivalents everywhere:

- **Fire danger**: most state forestry agencies publish a daily map (ours is [mainefireweather.org](https://mainefireweather.org/)). Check whether yours allows embedding — many do.
- **Drought**: the [U.S. Drought Monitor](https://droughtmonitor.unl.edu/) publishes a hotlinkable PNG for every state — change `_me_` in the image URL to your state code.
- **Coastal/flood risk**: [Climate Central's screening tool](https://coastal.climatecentral.org/) has an embeddable map for any US coast; inland communities might swap in FEMA flood maps.
- **Ticks & mosquitoes**: the scoring model in `pests.js` works anywhere — adjust the seasonal calendars for your latitude and check your state university extension for local surveillance data.

### 4. Localize the words

The highest-value content is also the cheapest to change: the "What this means for Southport" alert translations (`LOCAL_MEANING` in `app.js`), the Storm Mode checklist, and the fridge card (`fridge-card.html`). Rewrite these with what locals actually need to know — which road floods, who to call, where the shelter is. This local knowledge is the thing no national weather site will ever have.

`tests/unit/app-helpers.test.js` checks which guidance each alert type gets by its opening words. When you rewrite `LOCAL_MEANING`, update those expectations to match.

### 5. Deploy (free)

1. Push your fork to GitHub, make the repo public
2. Settings → Pages → deploy from `main` branch, root folder
3. Settings → Actions → General → allow workflows read/write permissions (needed if you use the outage bot)
4. Regenerate `assets/site-qr.svg` to point at your URL (`pip install segno`, one line — see git history)

The Tests workflow runs on its own with no setup. GitHub Pages ignores `package.json` and the `tests/` folder, so the deployed site is unchanged.

No servers, no domains required (though you can point one at it), no cost.

## Architecture notes

- **Plain HTML/CSS/JS, no framework, no build step** — deliberately, so future maintainers only need a text editor
- All live data is fetched client-side from free public APIs (NWS, NOAA tides) except utility outage data, which a GitHub Action snapshots into the repo every 15 minutes
- **Storm Mode** triggers automatically on Extreme/Severe NWS alerts (or hurricane/gale/surge/blizzard/ice-storm/tornado events); test it any time with `?storm=demo`
- The pest activity meters are **weather-based estimates, not surveillance** — the model was validated against ten seasonal scenarios and spot-checked against a commercial index (details in the site's methodology section); scoring functions in `pests.js` (and the text helpers in `app.js`) export CommonJS for headless re-testing
- Fetch failures degrade gracefully: every live section falls back to a labeled link to the official source

## Tests

The site still has no build step. Node and Playwright are only for testing.

```sh
npm install
npx playwright install chromium
npm test            # unit + browser tests
npm run test:unit   # Node only, no browser (one test reads the live NWS marine forecast)
npm run test:e2e    # Playwright against a local static server
```

- **`tests/unit/`**: the `pests.js` scoring model, the alert/forecast/marine text helpers in `app.js` (including a parse of the live coastal waters product), and the shape of `data/outages.json` that `scripts/fetch-outages.sh` writes and `app.js` reads.
- **`tests/e2e/live-data.spec.js`**: loads the page against the real NWS, NOAA tides, and committed CMP data, and checks each tile and section against those sources.
- **`tests/e2e/interactions.spec.js`**: tabs (click, keyboard, deep links), the `?storm=demo` layout, the climate slider, and the fridge card.
- **`tests/e2e/fallbacks.spec.js`**: the only mocked tests. They force upstream outages, which the real sources can't produce on demand, to check every section's fallback message.

`.github/workflows/tests.yml` runs the suite on pull requests, on pushes to `main`, and daily to catch upstream format changes. The outage bot's commits don't trigger it, because pushes made with `GITHUB_TOKEN` never start workflows.

## Maintenance

Almost none, but three things to know:

- **GitHub pauses cron workflows after ~60 days of repo inactivity.** The outage bot's own commits normally keep it alive, but if outage timestamps go stale, re-enable the workflow under the Actions tab (one click).
- **If the daily Tests run fails** with no code change, an upstream source (NWS, NOAA, or CMP) has most likely changed its format or is down. The failing test's name says which section; rerun it once to rule out a brief outage.
- **If the utility rotates its public API key**, the fetch fails gracefully (the page falls back to link-out buttons). Grab the new key from the `ocp-apim-subscription-key` request header on the utility's own outage map and update `scripts/fetch-outages.sh`.

## Data sources & credits

National Weather Service / NOAA (alerts, forecasts, marine, tides, radar) · Central Maine Power (outage data) · Maine Forest Service (fire danger) · U.S. Drought Monitor · Climate Central (coastal flood screening) · UMaine Extension Tick Lab, Maine CDC, URI TickEncounter, and the Companion Animal Parasite Council (pest surveillance and forecasts).

This site is a community resource, not an official emergency channel. Always follow guidance from local officials, and call 911 in an emergency.
