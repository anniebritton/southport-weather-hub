/*
 * Southport Island Resilience Hub
 * Live data: api.weather.gov (NWS) fetched client-side; CMP outage numbers
 * read from data/outages.json (refreshed every 15 min by a GitHub Action,
 * since CMP's API is CORS-restricted to their own portal).
 */

const ALERTS_ZONE = "MEZ026"; // NWS forecast zone covering Southport, ME
const FORECAST_URL = "https://api.weather.gov/gridpoints/GYX/90,70/forecast";
const MARINE_PRODUCTS_URL = "https://api.weather.gov/products/types/CWF/locations/GYX";
const MARINE_ZONE_CODE = "ANZ152"; // Coastal waters off Southport/Boothbay

/* ---------- helpers ---------- */

function el(id) {
  return document.getElementById(id);
}

function setStatus(id, message) {
  const node = el(id);
  if (node) node.textContent = message;
}

function setTile(id, state, value, sub) {
  const tile = el(id);
  if (!tile) return;
  tile.classList.remove("is-ok", "is-warn", "is-bad");
  if (state) tile.classList.add(`is-${state}`);
  const valueEl = tile.querySelector(".tile-value");
  valueEl.classList.remove("skeleton");
  valueEl.textContent = value;
  tile.querySelector(".tile-sub").textContent = sub || "";
}

function escapeHtml(s) {
  return String(s ?? "").replace(/[&<>"']/g, (c) => ({
    "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;",
  }[c]));
}

function formatTime(iso) {
  if (!iso) return "unknown";
  try {
    return new Date(iso).toLocaleString(undefined, {
      weekday: "short", month: "short", day: "numeric",
      hour: "numeric", minute: "2-digit",
    });
  } catch {
    return iso;
  }
}

function severityClass(severity) {
  const s = (severity || "").toLowerCase();
  return s === "extreme" || s === "severe" ? "severity-severe" : "severity-watch";
}

/*
 * Rough-weather tint for forecast/marine cards.
 * Returns "", "cond-watch", "cond-caution", or "cond-severe".
 */
function hazardLevel(text) {
  const t = (text || "").toLowerCase();
  if (/hurricane|tropical storm|gale|storm warning|severe thunderstorm|damaging|blizzard|ice storm|storm force/.test(t)) {
    return "cond-severe";
  }
  let level = 0; // 0 calm, 1 watch, 2 caution
  if (/thunderstorm|squall|heavy rain|heavy snow|freezing|dense fog|small craft|waterspout/.test(t)) level = 2;
  else if (/showers|rain|snow|drizzle|fog/.test(t)) level = 1;

  const gust = t.match(/gusts (?:up )?to (\d+)/);
  if (gust) {
    if (+gust[1] >= 30) level = 2;
    else if (+gust[1] >= 20) level = Math.max(level, 1);
  }
  for (const w of t.matchAll(/winds?[^.]*?(\d+)(?:\s+to\s+(\d+))?\s*(kt|mph)/g)) {
    const mph = +(w[2] || w[1]) * (w[3] === "kt" ? 1.15 : 1);
    if (mph >= 30) level = 2;
    else if (mph >= 20) level = Math.max(level, 1);
  }
  const seas = t.match(/seas[^.]*?(\d+)(?:\s+to\s+(\d+))?\s*ft/);
  if (seas) {
    const ft = +(seas[2] || seas[1]);
    if (ft >= 8) level = 2;
    else if (ft >= 5) level = Math.max(level, 1);
  }
  if (/slight chance/.test(t)) level = Math.max(level - 1, 0);
  return level === 2 ? "cond-caution" : level === 1 ? "cond-watch" : "";
}

/* ---------- "What this means for Southport" translations ---------- */

const LOCAL_MEANING = [
  [/hurricane|tropical storm/i,
    "Expect damaging wind, coastal flooding, and multi-day power outages. Haul boats or double all lines now. If officials suggest leaving low-lying areas, do it before the bridge gets dangerous in high wind. Fill water jugs — most Southport wells need electric pumps."],
  [/storm surge|coastal flood/i,
    "Water may cover low sections of shore roads and docks, especially near high tide. Move cars, gear, and anything floatable above the shoreline before the peak. Don't drive through water on the road — it may be deeper than it looks, and salt water ruins engines."],
  [/gale|storm warning/i,
    "Dangerous winds on the water. Boats should be back on their moorings or hauled — check your lines and fenders now. Expect scattered power outages from limbs on lines; charge your phone while you can."],
  [/high wind|wind advisory/i,
    "Gusts can drop limbs onto power lines — outages are possible. Secure trash cans, deck furniture, and anything that can blow into a line or a window. Give the bridge extra caution in a high-sided vehicle."],
  [/blizzard|winter storm|heavy snow/i,
    "Plows reach the island's side roads slowly — plan to stay put. Stock up before it starts, keep the fuel tank full, and locate your shovel and roof rake now. If you rely on medical equipment, arrange backup power today."],
  [/ice storm|freezing rain/i,
    "Ice is the most common cause of multi-day outages here. Charge everything, fill water jugs, and plan for warmth without power — never heat with a gas stove or grill indoors. Stay off the roads until sand trucks pass."],
  [/severe thunderstorm/i,
    "Brief but violent wind and lightning. Get off the water and out of the yard. Unplug sensitive electronics — island power flickers often trail these storms."],
  [/tornado/i,
    "Go to the lowest floor, an interior room, away from windows — now. A basement or crawl space beats any room with glass."],
  [/flood/i,
    "Never drive through water on a road — two feet of water floats a car. Culverts on the island can wash out; report road damage to the town office."],
  [/dense fog/i,
    "Near-zero visibility on the water and on Route 27. Delay boat trips; use low beams and slow way down near the bridge."],
  [/heat/i,
    "Check on older neighbors without air conditioning — mornings and evenings. Drink water steadily. The library and town hall are good places to cool off."],
  [/small craft/i,
    "Conditions are rough for skiffs, kayaks, and small boats. If you don't have to go out, don't. If you do: file a float plan with someone on shore and wear the life jacket."],
  [/rip current|surf/i,
    "Stay off wet rocks and ledges facing open water — waves arrive in sets, and the big one comes without warning. Keep a close eye on visiting grandchildren near the shore."],
];

function localMeaning(event) {
  for (const [re, text] of LOCAL_MEANING) {
    if (re.test(event || "")) return text;
  }
  return null;
}

/* ---------- storm mode ---------- */

const STORM_EVENT_RE = /hurricane|tropical|surge|blizzard|ice storm|gale|storm warning|high wind warning|winter storm warning|tornado/i;

function isStormAlert(p) {
  return ["Extreme", "Severe"].includes(p?.severity) || STORM_EVENT_RE.test(p?.event || "");
}

const DEMO_STORM = new URLSearchParams(location.search).get("storm") === "demo";

const DEMO_ALERT = {
  properties: {
    severity: "Severe",
    event: "Hurricane Warning",
    headline: "Hurricane Warning issued for coastal Lincoln County, ME (DEMO — this is a preview, not a real alert)",
    description: "This is a demonstration of Storm Mode. During a real warning, the National Weather Service alert text would appear here with details about expected wind, surge, and timing.",
    instruction: "This is a preview only. No storm is expected.",
    effective: new Date().toISOString(),
    expires: new Date(Date.now() + 12 * 3600 * 1000).toISOString(),
  },
};

function enterStormMode(alerts) {
  const active = alerts.filter((f) => isStormAlert(f.properties));
  if (!active.length) return;
  document.body.classList.add("storm-mode");
  const banner = el("storm-banner");
  banner.hidden = false;
  const p = active[0].properties;
  el("storm-headline").textContent = `${p.event} is in effect for our area`;
  fillStormTide();
}

/* ---------- weather alerts + forecast ---------- */

async function loadAlerts() {
  const listEl = el("alerts-list");
  try {
    const res = await fetch(`https://api.weather.gov/alerts/active?zone=${ALERTS_ZONE}`);
    if (!res.ok) throw new Error(`Alerts request failed: ${res.status}`);
    const data = await res.json();
    const alerts = data.features || [];
    if (DEMO_STORM) alerts.unshift(DEMO_ALERT);
    enterStormMode(alerts);

    if (alerts.length === 0) {
      setStatus("alerts-status", "");
      listEl.innerHTML = `
        <div class="alert-card severity-none">
          <span class="alert-label">All clear</span>
          <p>No active weather alerts for Southport right now.</p>
        </div>`;
      setTile("tile-weather", "ok", "All clear", "No active alerts");
    } else {
      setStatus("alerts-status", `${alerts.length} active alert${alerts.length > 1 ? "s" : ""}:`);
      listEl.innerHTML = alerts.map((f) => {
        const p = f.properties || {};
        const meaning = localMeaning(p.event);
        return `
          <div class="alert-card ${severityClass(p.severity)}">
            <span class="alert-label">${escapeHtml(p.severity || "Alert")} — ${escapeHtml(p.event || "Weather Alert")}</span>
            <h3>${escapeHtml(p.headline || p.event || "Weather Alert")}</h3>
            <p>${escapeHtml((p.description || "").split("\n").slice(0, 3).join(" "))}</p>
            <p class="alert-meta">Effective: ${formatTime(p.effective)} &middot; Expires: ${formatTime(p.expires)}</p>
            ${p.instruction ? `<p><strong>What to do:</strong> ${escapeHtml(p.instruction.split("\n")[0])}</p>` : ""}
            ${meaning ? `
            <details class="alert-local">
              <summary>What this means for Southport</summary>
              <p>${escapeHtml(meaning)}</p>
            </details>` : ""}
          </div>`;
      }).join("");
      const worst = alerts.some((f) => ["Extreme", "Severe"].includes(f.properties?.severity));
      const first = alerts[0].properties?.event || "Weather alert";
      setTile("tile-weather", worst ? "bad" : "warn", first,
        alerts.length > 1 ? `+ ${alerts.length - 1} more alert${alerts.length > 2 ? "s" : ""}` : "Tap Alerts below for details");
    }
  } catch (err) {
    console.error(err);
    setStatus("alerts-status", "Couldn't load live alerts right now — use the weather.gov link below.");
    listEl.innerHTML = "";
    setTile("tile-weather", null, "Unavailable", "Check weather.gov");
  }
}

async function loadForecast() {
  const grid = el("forecast-summary");
  try {
    const res = await fetch(FORECAST_URL);
    if (!res.ok) throw new Error(`Forecast request failed: ${res.status}`);
    const data = await res.json();
    const periods = (data.properties?.periods || []).slice(0, 4);
    if (!periods.length) throw new Error("Empty forecast");
    grid.innerHTML = periods.map((p) => `
      <div class="forecast-card ${hazardLevel(p.detailedForecast)}">
        <h4>${escapeHtml(p.name)}</h4>
        <span class="temp">${p.temperature}°${escapeHtml(p.temperatureUnit)}</span>
        <p>${escapeHtml(p.detailedForecast)}</p>
      </div>`).join("");
  } catch (err) {
    console.error(err);
    grid.innerHTML = `<p class="status-line">Forecast unavailable — use the weather.gov link below.</p>`;
  }
}

/* ---------- marine ---------- */

async function loadMarineForecast() {
  const grid = el("marine-forecast");
  try {
    const typesRes = await fetch(MARINE_PRODUCTS_URL);
    if (!typesRes.ok) throw new Error(`Marine product list failed: ${typesRes.status}`);
    const typesData = await typesRes.json();
    const latest = typesData["@graph"]?.[0]?.["@id"];
    if (!latest) throw new Error("No marine forecast product found");

    const productRes = await fetch(latest);
    if (!productRes.ok) throw new Error(`Marine product fetch failed: ${productRes.status}`);
    const productData = await productRes.json();

    const section = extractZoneSection(productData.productText || "", MARINE_ZONE_CODE);
    if (!section) throw new Error("Zone section not found");

    setStatus("marine-status", "");
    const periods = parseMarinePeriods(section).slice(0, 4);
    grid.innerHTML = periods.map((p) => {
      const d = parseMarineDetail(p.body);
      const arrow = windArrow(d.wind);
      return `
      <div class="marine-period ${hazardLevel(p.body)}">
        <h4>${escapeHtml(p.name)}</h4>
        <div class="m-seas">${escapeHtml(compressSeas(d.seas))}<span class="m-seas-label">seas</span></div>
        ${d.wind ? `
        <div class="m-row">
          <span class="m-label">Wind</span>
          <div class="m-wind">${arrow}<span>${escapeHtml(compressWind(d.wind))}</span></div>
        </div>` : ""}
        ${d.waves ? `
        <div class="m-row">
          <span class="m-label">Waves</span>
          <div class="m-waves">${compressWaves(d.waves)}</div>
        </div>` : ""}
        ${d.note ? `
        <div class="m-row">
          <span class="m-label">Note</span>
          <p class="m-note">${escapeHtml(d.note)}</p>
        </div>` : ""}
      </div>`;
    }).join("");

    // Pull "Seas X to Y ft" / "Seas around X ft" out of the current period for the hero tile
    const seas = periods[0]?.body.match(/Seas?[^.]*?(\d+(?:\s+to\s+\d+)?)\s*ft/i);
    const wind = periods[0]?.body.match(/^([A-Z]{1,3} winds [^.]+?kt)/i);
    setTile("tile-seas", null,
      seas ? `${seas[1].replace(/\s+to\s+/, "–")} ft seas` : "See forecast",
      wind ? wind[1] : "Coastal waters off Southport");
  } catch (err) {
    console.error(err);
    setStatus("marine-status", "Couldn't load live marine conditions — use the links below.");
    grid.innerHTML = "";
    setTile("tile-seas", null, "Unavailable", "Check weather.gov");
  }
}

function extractZoneSection(fullText, zoneCode) {
  const startIdx = fullText.indexOf(`${zoneCode}-`);
  if (startIdx === -1) return null;
  const rest = fullText.slice(startIdx);
  // Zone sections in NWS text products end at "$$" or the next zone header
  const endMarkers = ["\n$$", "\nANZ1", "\nANZ2"];
  let endIdx = rest.length;
  for (const marker of endMarkers) {
    const idx = rest.indexOf(marker, 10);
    if (idx !== -1 && idx < endIdx) endIdx = idx;
  }
  return rest.slice(0, endIdx).trim();
}

/* Marine text compressors — trim NWS phrasing down to scannable fragments */

function compressSeas(seas) {
  if (!seas) return "—";
  return seas
    .replace(/^around\s+/i, "~")
    .replace(/(\d+)\s+to\s+(\d+)\s*ft/i, "$1–$2 ft")
    .replace(/\s*ft\b/i, " ft");
}

function compressWind(wind) {
  return wind
    .replace(/\bwinds?\s+/i, " ")
    .replace(/(\d+)\s+to\s+(\d+)\s*kt/gi, "$1–$2 kt")
    .replace(/gusts up to (\d+) kt/i, "gusts $1 kt")
    .trim();
}

function compressWaves(waves) {
  // "SE 4 ft at 8 seconds" → "4 ft from the SE, every 8 s"
  return waves
    .split(/\s+and\s+/i)
    .map((w) => {
      const m = w.trim().match(/^([NSEW]{1,3})\s+(\d+)\s*ft at (\d+) seconds?/i);
      if (m) return escapeHtml(`${m[2]} ft from the ${m[1].toUpperCase()}, every ${m[3]} s`);
      return escapeHtml(w.trim());
    })
    .join("<br>");
}

const COMPASS = {
  N: 0, NNE: 22, NE: 45, ENE: 67, E: 90, ESE: 112, SE: 135, SSE: 157,
  S: 180, SSW: 202, SW: 225, WSW: 247, W: 270, WNW: 292, NW: 315, NNW: 337,
};

/* Arrow showing where the wind blows toward (from-direction + 180°) */
function windArrow(wind) {
  const m = (wind || "").match(/^([NSEW]{1,3})\b/i);
  const from = m ? COMPASS[m[1].toUpperCase()] : undefined;
  if (from === undefined) return "";
  const deg = (from + 180) % 360;
  return `<svg class="m-arrow" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" style="transform: rotate(${deg}deg)" aria-hidden="true"><path d="M12 19V5"/><path d="m5 12 7-7 7 7"/></svg>`;
}

/* Break a period's text blob into labeled parts: wind, seas, wave detail, notes */
function parseMarineDetail(body) {
  const out = { wind: "", seas: "", waves: "", note: "" };
  const sentences = body.split(/(?<=\.)\s+/);
  const notes = [];
  for (const s of sentences) {
    const sent = s.trim().replace(/\.$/, "");
    if (!sent) continue;
    if (/^wave detail:/i.test(sent)) out.waves = sent.replace(/^wave detail:\s*/i, "");
    else if (!out.wind && /\bwinds?\b/i.test(sent)) out.wind = sent;
    else if (!out.seas && /^seas\b/i.test(sent)) out.seas = sent.replace(/^seas\s*/i, "");
    else notes.push(sent);
  }
  out.note = notes.join(". ");
  return out;
}

function parseMarinePeriods(section) {
  // Each period starts with ".NAME..." e.g. ".TODAY...NE winds 5 to 10 kt."
  const parts = section.split(/\n?\.([A-Z][A-Z .]*?)\.\.\./g);
  const periods = [];
  for (let i = 1; i < parts.length; i += 2) {
    periods.push({
      name: parts[i].trim(),
      body: (parts[i + 1] || "").replace(/\s+/g, " ").trim(),
    });
  }
  return periods;
}

/* ---------- tides (NOAA CO-OPS, Southport / Townsend Gut station) ---------- */

const TIDE_STATION = "8416908";
let nextHighTide = null; // shared with the storm banner

function tideDate(t) {
  // API returns "YYYY-MM-DD HH:MM" in local station time
  return new Date(t.replace(" ", "T"));
}

function formatTideTime(d) {
  const today = new Date();
  const opts = { hour: "numeric", minute: "2-digit" };
  if (d.toDateString() !== today.toDateString()) opts.weekday = "short";
  return d.toLocaleString(undefined, opts);
}

async function loadTides() {
  const strip = el("tides-strip");
  try {
    const today = new Date();
    const ymd = `${today.getFullYear()}${String(today.getMonth() + 1).padStart(2, "0")}${String(today.getDate()).padStart(2, "0")}`;
    const url = `https://api.tidesandcurrents.noaa.gov/api/prod/datagetter?product=predictions&application=southport_resilience_hub&station=${TIDE_STATION}&begin_date=${ymd}&range=48&datum=MLLW&time_zone=lst_ldt&units=english&interval=hilo&format=json`;
    const res = await fetch(url);
    if (!res.ok) throw new Error(`Tide request failed: ${res.status}`);
    const data = await res.json();
    const now = new Date();
    const upcoming = (data.predictions || [])
      .map((p) => ({ time: tideDate(p.t), height: parseFloat(p.v), high: p.type === "H" }))
      .filter((p) => p.time > now)
      .slice(0, 4);
    if (!upcoming.length) throw new Error("No tide predictions returned");

    nextHighTide = upcoming.find((p) => p.high) || null;
    fillStormTide();

    strip.innerHTML = upcoming.map((p, i) => `
      <div class="tide-chip ${p.high ? "tide-high" : ""} ${i === 0 ? "tide-next" : ""}">
        <span class="tide-type">${p.high ? "High" : "Low"}${i === 0 ? " (next)" : ""}</span>
        <span class="tide-time">${formatTideTime(p.time)}</span>
        <span class="tide-height">${p.height.toFixed(1)} ft</span>
      </div>`).join("");
  } catch (err) {
    console.error(err);
    strip.innerHTML = `<p class="status-line">Tide times unavailable right now —
      <a href="https://tidesandcurrents.noaa.gov/noaatidepredictions.html?id=${TIDE_STATION}" target="_blank" rel="noopener">see NOAA's tide table ↗</a></p>`;
  }
}

function fillStormTide() {
  const line = el("storm-tide");
  if (!line || !document.body.classList.contains("storm-mode") || !nextHighTide) return;
  line.textContent = `Next high tide: ${formatTideTime(nextHighTide.time)} (${nextHighTide.height.toFixed(1)} ft) — flooding risk is greatest around this time.`;
}

/* ---------- power outages ---------- */

async function loadOutages() {
  const grid = el("outage-stats");
  try {
    const res = await fetch("data/outages.json", { cache: "no-cache" });
    if (!res.ok) throw new Error(`Outage data fetch failed: ${res.status}`);
    const data = await res.json();

    const sp = data.southport;
    const lc = data.lincolnCounty;
    const spOut = sp ? sp.Outages ?? 0 : 0;
    const lcOut = lc ? lc.Outages ?? 0 : 0;
    const totalOut = data.totals?.outages ?? 0;

    grid.innerHTML = `
      <div class="stat-card ${spOut ? "stat-bad" : "stat-ok"}">
        <span class="stat-value">${spOut ? spOut.toLocaleString() : "None"}</span>
        <span class="stat-label">${spOut ? "customers out in Southport" : "No outages in Southport"}</span>
      </div>
      <div class="stat-card ${lcOut ? "stat-bad" : "stat-ok"}">
        <span class="stat-value">${lcOut ? lcOut.toLocaleString() : "None"}</span>
        <span class="stat-label">${lcOut ? "customers out in Lincoln County" : "No outages in Lincoln County"}</span>
      </div>
      <div class="stat-card">
        <span class="stat-value">${Number(totalOut).toLocaleString()}</span>
        <span class="stat-label">customers out across all of CMP</span>
      </div>`;

    if (data.lastUpdated) {
      el("outage-updated").textContent = `CMP data as of ${data.lastUpdated} (Eastern). Refreshes every 15 minutes.`;
    }

    if (spOut) {
      setTile("tile-power", "bad", `${spOut.toLocaleString()} out`, "in Southport — see Power section");
    } else if (lcOut) {
      setTile("tile-power", "warn", "On in Southport", `${lcOut.toLocaleString()} out elsewhere in Lincoln County`);
    } else {
      setTile("tile-power", "ok", "On", "No outages reported in Lincoln County");
    }
  } catch (err) {
    console.error(err);
    grid.innerHTML = `<p class="status-line">Live outage numbers unavailable — use CMP's outage map below.</p>`;
    setTile("tile-power", null, "Unavailable", "Check CMP's map");
  }
}

/* ---------- tabs ---------- */

function setupTabs() {
  const tabs = Array.from(document.querySelectorAll('[role="tab"]'));
  const panels = tabs.map((t) => el(t.getAttribute("aria-controls")));

  function activate(tab, { focus = true, updateHash = true } = {}) {
    tabs.forEach((t, i) => {
      const selected = t === tab;
      t.setAttribute("aria-selected", String(selected));
      t.tabIndex = selected ? 0 : -1;
      panels[i].hidden = !selected;
    });
    if (focus) tab.focus({ preventScroll: true });
    if (updateHash) history.replaceState(null, "", `#${tab.getAttribute("aria-controls")}`);
    // On narrow screens the tab bar scrolls — keep the selected pill centered
    const reduceMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    tab.scrollIntoView({ behavior: reduceMotion ? "auto" : "smooth", block: "nearest", inline: "center" });
  }

  tabs.forEach((tab) => {
    tab.addEventListener("click", (e) => {
      e.preventDefault();
      activate(tab);
    });
    tab.addEventListener("keydown", (e) => {
      const idx = tabs.indexOf(tab);
      let next = null;
      if (e.key === "ArrowRight") next = tabs[(idx + 1) % tabs.length];
      else if (e.key === "ArrowLeft") next = tabs[(idx - 1 + tabs.length) % tabs.length];
      else if (e.key === "Home") next = tabs[0];
      else if (e.key === "End") next = tabs[tabs.length - 1];
      if (next) {
        e.preventDefault();
        activate(next);
      }
    });
  });

  // Deep link: #outages opens the Power tab, etc. — on load and on back/forward
  function syncFromHash() {
    const fromHash = tabs.find((t) => `#${t.getAttribute("aria-controls")}` === location.hash);
    if (fromHash) activate(fromHash, { focus: false, updateHash: false });
  }
  window.addEventListener("hashchange", syncFromHash);
  syncFromHash();
}

/* ---------- climate water-level slider ---------- */

function setupWaterSlider() {
  const slider = el("water-level");
  const valueEl = el("water-level-value");
  const iframe = el("climate-map");
  if (!slider || !iframe) return;

  slider.addEventListener("input", () => {
    valueEl.textContent = `${slider.value} ${slider.value === "1" ? "foot" : "feet"}`;
  });
  // Only reload the map when the user lets go of the slider
  slider.addEventListener("change", () => {
    const url = new URL(iframe.src);
    url.searchParams.set("water_level", `${slider.value}.0`);
    iframe.src = url.toString();
  });
}

/* ---------- boot ---------- */

setupTabs();
setupWaterSlider();
loadAlerts();
loadForecast();
loadMarineForecast();
loadOutages();
loadTides();

const lastUpdated = el("last-updated");
if (lastUpdated) lastUpdated.textContent = `Page loaded: ${new Date().toLocaleString()}`;
