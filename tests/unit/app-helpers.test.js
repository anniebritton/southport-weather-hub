// Text helpers from app.js (exported for Node the same way pests.js is).
const test = require("node:test");
const assert = require("node:assert/strict");
const {
  hazardLevel, localMeaning, isStormAlert, seasHeadline, extractZoneSection, parseMarinePeriods,
  parseMarineDetail, compressSeas, compressWind, compressWaves, windArrow,
} = require("../../app.js");

test("hazardLevel grades forecast text by wind, seas, and wording", () => {
  const cases = {
    "Sunny, with a high near 62.": "",
    "Showers likely after 2pm.": "cond-watch",
    "Slight chance of showers.": "",
    "Heavy rain, mainly after midnight.": "cond-caution",
    "Breezy, with gusts up to 22 mph.": "cond-watch",
    "Windy, with gusts as high as 35 mph. Gusts to 35 mph.": "cond-caution",
    "NE winds 25 to 30 kt.": "cond-caution",
    "S winds 10 kt. Seas 5 ft.": "cond-watch",
    "Seas 8 to 10 ft.": "cond-caution",
    "Gale warning in effect.": "cond-severe",
    "Hurricane conditions possible.": "cond-severe",
  };
  for (const [text, level] of Object.entries(cases)) assert.equal(hazardLevel(text), level, text);
});

test("seasHeadline summarizes a period's seas for the hero tile", () => {
  assert.equal(seasHeadline("NW winds 10 kt. Seas 4 to 5 ft. Wave Detail: NW 4 ft at 4 seconds."), "4–5 ft seas");
  assert.equal(seasHeadline("S winds 5 kt. Seas around 2 ft."), "2 ft seas");
  assert.equal(seasHeadline("N winds 5 to 10 kt. Seas 1 foot or less."), "≤1 ft seas");
  assert.equal(seasHeadline("Seas around 2 ft in the evening, then 1 foot or less."), "2 ft seas");
  assert.equal(seasHeadline("Variable winds less than 5 kt."), null);
  assert.equal(seasHeadline(undefined), null);
});

test("marine compressors shorten NWS phrasing", () => {
  assert.equal(compressSeas("3 to 5 ft"), "3–5 ft");
  assert.equal(compressSeas("around 2 ft"), "~2 ft");
  assert.equal(compressSeas(""), "—");
  assert.match(compressWind("NE winds 10 to 15 kt with gusts up to 25 kt"), /^NE\s+10–15 kt with gusts 25 kt$/);
  assert.equal(compressWaves("SE 4 ft at 8 seconds and S 2 ft at 12 seconds"), "4 ft from the SE, every 8 s<br>2 ft from the S, every 12 s");
});

test("windArrow points downwind and skips variable winds", () => {
  assert.match(windArrow("NE winds 10 kt"), /rotate\(225deg\)/);
  assert.match(windArrow("N winds 5 kt"), /rotate\(180deg\)/);
  assert.equal(windArrow("Variable winds less than 5 kt"), "");
});

test("zone extraction and period parsing handle a coastal waters forecast", () => {
  const product = [
    "ANZ152-142300-",
    "Coastal waters from Port Clyde ME to Cape Elizabeth ME out 25 NM-",
    ".TONIGHT...SW winds 10 to 15 kt. Seas 3 to 5 ft. Wave Detail: S 4 ft at 8 seconds.",
    ".THU...W winds 5 to 10 kt. Seas 2 to 3 ft. Patchy fog in the morning.",
    "$$",
    "ANZ153-142300-",
    ".TONIGHT...Other zone.",
  ].join("\n");
  assert.equal(extractZoneSection(product, "ANZ999"), null);
  const section = extractZoneSection(product, "ANZ152");
  assert.ok(!section.includes("Other zone"));
  const periods = parseMarinePeriods(section);
  assert.deepEqual(periods.map((p) => p.name), ["TONIGHT", "THU"]);
  assert.deepEqual(parseMarineDetail(periods[0].body), { wind: "SW winds 10 to 15 kt", seas: "3 to 5 ft", waves: "S 4 ft at 8 seconds", note: "" });
});

test("advisory headlines are not treated as forecast periods", () => {
  const section = [
    "ANZ152-151345-",
    "Coastal Waters from Port Clyde, ME to Cape Elizabeth, ME out 25 NM-",
    "743 PM EDT Wed Oct 14 2026",
    "",
    "...SMALL CRAFT ADVISORY IN EFFECT THROUGH THURSDAY MORNING...",
    "",
    ".TONIGHT...NW winds 10 to 15 kt. Seas 4 to 5 ft.",
    ".THU...NW winds 15 to 20 kt. Seas 3 to 5 ft.",
  ].join("\n");
  const periods = parseMarinePeriods(section);
  assert.deepEqual(periods.map((p) => p.name), ["TONIGHT", "THU"]);
  assert.equal(seasHeadline(periods[0].body), "4–5 ft seas");
});

test("the live GYX coastal waters forecast has a parseable ANZ152 section with seas", async () => {
  // Live NWS request: catches upstream format changes the fixtures above can't
  const headers = { "User-Agent": "southport-weather-hub tests (github.com/anniebritton/southport-weather-hub)" };
  const list = await (await fetch("https://api.weather.gov/products/types/CWF/locations/GYX", { headers })).json();
  const product = await (await fetch(list["@graph"][0]["@id"], { headers })).json();
  const periods = parseMarinePeriods(extractZoneSection(product.productText, "ANZ152") || "");
  assert.ok(periods.length > 0, "no periods parsed");
  for (const p of periods) {
    assert.match(p.name, /^[A-Z][A-Z .]*$/);
    assert.ok(p.body.length > 0, `${p.name} has an empty body`);
  }
  assert.ok(seasHeadline(periods[0].body), `no seas in first period: ${periods[0].body}`);
});

test("storm mode triggers on severe alerts and storm event names only", () => {
  assert.equal(isStormAlert({ severity: "Severe", event: "Flood Warning" }), true);
  assert.equal(isStormAlert({ severity: "Moderate", event: "Gale Warning" }), true);
  assert.equal(isStormAlert({ severity: "Moderate", event: "Storm Warning" }), true);
  assert.equal(isStormAlert({ severity: "Moderate", event: "Ice Storm Warning" }), true);
  assert.equal(isStormAlert({ severity: "Moderate", event: "Severe Thunderstorm Watch" }), false);
  assert.equal(isStormAlert({ severity: "Minor", event: "Small Craft Advisory" }), false);
  assert.equal(isStormAlert(undefined), false);
});

test("each alert type gets its own 'What this means for Southport' guidance", () => {
  const expected = {
    "Hurricane Warning": "Expect damaging wind",
    "Tropical Storm Warning": "Expect damaging wind",
    "Hurricane Force Wind Warning": "Dangerous winds on the water",
    "Coastal Flood Warning": "Water may cover low sections of shore roads",
    "Storm Surge Warning": "Water may cover low sections of shore roads",
    "Gale Warning": "Dangerous winds on the water",
    "Storm Warning": "Dangerous winds on the water",
    "High Wind Warning": "Gusts can drop limbs onto power lines",
    "Severe Thunderstorm Warning": "Brief but violent wind and lightning",
    "Winter Storm Warning": "Plows reach the island's side roads slowly",
    "Ice Storm Warning": "Ice is the most common cause of multi-day outages",
    "Flash Flood Warning": "Never drive through water on a road",
    "Small Craft Advisory": "Conditions are rough for skiffs",
    "Dense Fog Advisory": "Near-zero visibility on the water",
  };
  for (const [event, start] of Object.entries(expected)) {
    assert.ok(localMeaning(event)?.startsWith(start), `${event} → ${localMeaning(event)?.slice(0, 50)}`);
  }
  assert.equal(localMeaning("Frost Advisory"), null);
});
