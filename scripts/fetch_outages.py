#!/usr/bin/env python3
"""Fetch current CMP outage data and write data/outages.json.

Run by .github/workflows/outages.yml every 15 minutes, or manually for local dev.

The CMP subscription key is read from the OUTAGE_API_KEY environment variable (a GitHub
secret in CI); it is not stored in this repo. It is CMP's own public frontend key, shipped
to every browser that opens portal.cmpco.com/outages/map. If CMP rotates it, grab the new
one from the ocp-apim-subscription-key request header on that page and update the secret.

The script refuses to overwrite the data file when the API answers with something that
isn't the expected shape (for example `{}` with HTTP 200), so a bad upstream response
can never turn into a confident "no outages" on the site.
"""
import json
import math
import os
import sys
import time
import urllib.request

API = "https://apim.avangrid.com/cmp/v1/public/outagedata"
OUT = os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "data", "outages.json")


def fetch(filter_name, key, attempts=2):
    url = f"{API}?filter={filter_name}"
    last = None
    for i in range(attempts):
        try:
            req = urllib.request.Request(url, headers={"ocp-apim-subscription-key": key})
            with urllib.request.urlopen(req, timeout=30) as resp:
                return json.loads(resp.read().decode("utf-8"))
        except Exception as e:  # never print headers or the key
            last = f"{type(e).__name__}: {getattr(e, 'code', '')}"
            if i < attempts - 1:
                time.sleep(2)
    raise RuntimeError(f"fetching filter={filter_name} failed ({last})")


def _is_number(v):
    return isinstance(v, (int, float)) and not isinstance(v, bool) and math.isfinite(v)


def validate(county, town):
    """Raise ValueError unless both responses have the shape the site depends on."""
    if not isinstance(county, dict) or not isinstance(town, dict):
        raise ValueError("response is not a JSON object")
    if not isinstance(county.get("lastUpdated"), str) or not county["lastUpdated"].strip():
        raise ValueError("county response has no lastUpdated")
    for field in ("customers", "outages"):
        if not _is_number(county.get(field)):
            raise ValueError(f"county response has no numeric {field}")
    if not isinstance(county.get("features"), list) or not isinstance(town.get("features"), list):
        raise ValueError("response has no features list")


def build_result(county, town):
    validate(county, town)

    def props(features):
        return [f["properties"] for f in features if isinstance(f, dict) and isinstance(f.get("properties"), dict)]

    towns = props(town["features"])
    counties = props(county["features"])

    # towns mixes level "town" and "street" rows; only the town row has Southport's total
    southport = next((t for t in towns if t.get("level") == "town" and str(t.get("town", "")).upper() == "SOUTHPORT"), None)
    lincoln = next((c for c in counties if str(c.get("county", "")).upper() == "LINCOLN"), None)

    return {
        "lastUpdated": county["lastUpdated"],
        "totals": {
            "customers": county.get("customers"),
            "outages": county.get("outages"),
            "incidents": county.get("incidents"),
        },
        "southport": southport,    # null = no outages reported in Southport
        "lincolnCounty": lincoln,  # null = no outages reported in Lincoln County
        "towns": towns,
    }


def main():
    key = os.environ.get("OUTAGE_API_KEY", "").strip()
    if not key:
        print(f"ERROR: OUTAGE_API_KEY is not set; leaving {os.path.normpath(OUT)} unchanged", file=sys.stderr)
        return 1
    try:
        county = fetch("county", key)
        town = fetch("town", key)
        result = build_result(county, town)
    except (RuntimeError, ValueError) as e:
        print(f"ERROR: {e}; leaving {os.path.normpath(OUT)} unchanged", file=sys.stderr)
        return 1

    tmp = f"{OUT}.tmp"
    with open(tmp, "w") as f:
        json.dump(result, f, indent=1)
    os.replace(tmp, OUT)
    print("wrote", os.path.normpath(OUT), "-", result["totals"]["outages"], "customers out statewide")
    return 0


if __name__ == "__main__":
    sys.exit(main())
