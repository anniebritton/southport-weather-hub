// Contract between scripts/fetch-outages.sh (writer) and loadOutages() in app.js (reader),
// checked against the data file the outage bot actually committed.
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const data = JSON.parse(fs.readFileSync(path.join(__dirname, "../../data/outages.json"), "utf8"));

test("outages.json has a parseable lastUpdated timestamp", () => {
  assert.match(data.lastUpdated, /^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/);
});

test("outages.json has numeric statewide totals", () => {
  for (const key of ["customers", "outages", "incidents"]) {
    assert.equal(typeof data.totals[key], "number", `totals.${key}`);
  }
});

test("southport and lincolnCounty are null or carry an Outages count", () => {
  for (const key of ["southport", "lincolnCounty"]) {
    assert.ok(key in data, `${key} key missing`);
    if (data[key] !== null) assert.equal(typeof data[key].Outages, "number", `${key}.Outages`);
  }
});

test("towns lists CMP towns with outage counts", () => {
  assert.ok(Array.isArray(data.towns));
  for (const t of data.towns) {
    assert.equal(typeof t.town, "string");
    assert.equal(typeof t.Outages, "number");
  }
});

test("southport is the town-level SOUTHPORT row, not a street row", () => {
  if (data.southport !== null) {
    assert.equal(data.southport.level, "town");
    assert.equal(data.southport.town.toUpperCase(), "SOUTHPORT");
  }
  const townRow = data.towns.find((t) => t.level === "town" && t.town.toUpperCase() === "SOUTHPORT") ?? null;
  assert.deepEqual(data.southport, townRow);
});
