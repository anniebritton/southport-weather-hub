#!/usr/bin/env bash
# Fetches current CMP outage data and writes data/outages.json.
# Run by .github/workflows/outages.yml every 15 minutes, or manually for local dev.
#
# The subscription key below is CMP's own public frontend key — it is shipped
# to every browser that opens portal.cmpco.com/outages/map. If CMP rotates it,
# grab the new one from the ocp-apim-subscription-key request header on that
# page and update it here.
set -euo pipefail

KEY="0e379c90775d4d0eb1d9013c5542d7d5"
API="https://apim.avangrid.com/cmp/v1/public/outagedata"
OUT="$(dirname "$0")/../data/outages.json"

county=$(curl -sf --max-time 30 -H "ocp-apim-subscription-key: $KEY" "$API?filter=county")
town=$(curl -sf --max-time 30 -H "ocp-apim-subscription-key: $KEY" "$API?filter=town")

python3 - "$OUT" <<PYEOF
import json, sys

county = json.loads('''$county''')
town = json.loads('''$town''')

def props(features):
    return [f["properties"] for f in features]

towns = props(town.get("features", []))
counties = props(county.get("features", []))

southport = next((t for t in towns if t.get("town", "").upper() == "SOUTHPORT"), None)
lincoln = next((c for c in counties if c.get("county", "").upper() == "LINCOLN"), None)

result = {
    "lastUpdated": county.get("lastUpdated"),
    "totals": {
        "customers": county.get("customers"),
        "outages": county.get("outages"),
        "incidents": county.get("incidents"),
    },
    "southport": southport,   # null = no outages reported in Southport
    "lincolnCounty": lincoln, # null = no outages reported in Lincoln County
    "towns": towns,
}

with open(sys.argv[1], "w") as f:
    json.dump(result, f, indent=1)
print("wrote", sys.argv[1], "-", county.get("outages"), "customers out statewide")
PYEOF
