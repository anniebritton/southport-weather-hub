# Southport Island Resilience Hub

A single, plain-language page for Southport Island, Maine residents to check severe weather alerts, power outages, marine conditions, wildfire risk, and long-term coastal climate risk — without needing to know which agency's website to visit.

## How each section gets its data

| Section | Source | How it's embedded |
|---|---|---|
| Status tiles (hero) | Derived from the alerts, outage, and marine data below | Native |
| Weather Alerts & Forecast | [api.weather.gov](https://www.weather.gov/documentation/services-web-api) — forecast zone `MEZ026`, gridpoint `GYX/90,70` | Fetched client-side, rendered as cards |
| Live radar | [radar.weather.gov](https://radar.weather.gov/) KGYX (Gray, ME) loop | Plain `<img>` of the loop GIF |
| Power Outages | CMP's public outage API (`apim.avangrid.com/cmp/v1/public/outagedata`) | GitHub Action snapshots it to `data/outages.json` every 15 min; page reads it same-origin (see below) |
| Seas & Wind | api.weather.gov Coastal Waters Forecast (CWF) text product, zone `ANZ152` | Fetched client-side, parsed and rendered as cards |
| Wind & wave map | [Windy.com](https://www.windy.com/) embed | iframe (embed-friendly by design) |
| Wildfire Risk | [mainefireweather.org](https://mainefireweather.org/) (Maine Forest Service) | iframe (they send no X-Frame-Options) |
| Climate Risk map | [Climate Central Coastal Risk Screening](https://coastal.climatecentral.org/) | iframe of their official embed URL, centered on Southport |

## Why the outage data goes through a GitHub Action

CMP's outage map (`portal.cmpco.com/outages/map`) sends `X-Frame-Options: sameorigin`, so it can't be iframed, and their data API only allows CORS from their own portal, so the browser can't fetch it directly from this site. The workaround:

- `.github/workflows/outages.yml` runs every 15 minutes, calls `scripts/fetch-outages.sh`, and commits `data/outages.json` when it changes ("git scraping").
- The script authenticates with CMP's own public frontend API key — the same key CMP ships to every browser that opens their outage map. If they rotate it, the fetch fails gracefully (the page falls back to link-out buttons) and the key in `scripts/fetch-outages.sh` needs updating: open CMP's outage map with browser dev tools and copy the `ocp-apim-subscription-key` request header.
- The JSON includes statewide totals plus Southport and Lincoln County specifically. A town/county absent from the feed means it has no outages.

To refresh outage data during local development: `./scripts/fetch-outages.sh`

## Pest activity meters (Mosquitoes & Ticks tab)

The "Mosquitoes & Ticks" tab shows estimated mosquito and tick activity computed client-side (`pests.js`) from the NWS hourly forecast plus seasonal calendars for Midcoast Maine. They are **weather-based estimates, not surveillance** — the tab says so prominently and links to real data (UMaine Tick Lab, CAPC forecasts, Maine CDC).

Validation performed at build time (2026-07-08):

- **10 synthetic seasonal scenarios** (January cold snap → July heat wave → breezy dry summer day → mild October afternoon) run through the pure scoring functions; all land in expected ranges per standard vector-ecology guidance. An earlier additive formula failed ("hot but dry and windy July day" scored High for mosquitoes); the published multiplicative model corrects this — temperature sets the ceiling, dry air and wind scale it down.
- **Live comparison vs AccuWeather's Boothbay Harbor mosquito index** on build day: theirs High, ours Very High — one notch hotter, same direction. Expect the meter to run slightly hot on humid summer days.
- Known limitations (documented on the page): no population data (standing water, deer, leaf litter, antecedent rainfall), thresholds from published rules of thumb rather than fitted to Maine trap data.

The scoring functions in `pests.js` export via CommonJS when run under Node, so scenario tests can be re-run headlessly: create hour arrays and call `mosquitoScore(hours, month)` / `tickScore(hours, month)`.

## Running locally

No build step — plain HTML/CSS/JS.

```bash
python3 -m http.server 8000
```

Then open `http://localhost:8000`.

## Deploying to GitHub Pages

1. Push this repo to GitHub.
2. Settings → Pages → source: `main` branch, root folder.
3. Settings → Actions → General → allow workflows read/write permissions (needed for the outage bot to commit).
4. The site publishes at `https://<username>.github.io/<repo-name>/`.

## Updating content

- **Coordinates / zones**: hardcoded to Southport, ME (43.8384, -69.6631) — NWS forecast zone `MEZ026`, gridpoint `GYX/90,70`, marine zone `ANZ152`, radar `KGYX`. Re-derive from `https://api.weather.gov/points/{lat},{lon}` if ever needed.
- **Climate/reference links**: in the `#climate` section of `index.html`. LCRPC's old study URLs died in a site rebuild (2026) — their content now lives at their [ArcGIS resource hub](https://resources-lcrpc.hub.arcgis.com/).
- **Styling**: all in `styles.css` (custom properties at the top). Fonts: Fraunces (display) + Manrope (body) from Google Fonts.
- **Layout**: sections are tabs (`role="tablist"` nav + `role="tabpanel"` sections, wired up in `app.js`) with hash deep-links, e.g. `/#outages` opens the Power tab.
