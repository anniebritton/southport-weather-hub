import json
import os
import sys
import unittest

sys.path.insert(0, os.path.join(os.path.dirname(__file__), "..", "..", "scripts"))
import fetch_outages as fo  # noqa: E402


def county(**kw):
    base = {"lastUpdated": "2026-01-01 12:00:00", "customers": 1000, "outages": 3, "incidents": 1,
            "features": [{"properties": {"county": "LINCOLN", "Outages": 2}}]}
    base.update(kw)
    return base


def town(rows=None):
    return {"features": [{"properties": r} for r in (rows if rows is not None else [
        {"level": "street", "town": "SOUTHPORT", "Outages": 1},
        {"level": "town", "town": "SOUTHPORT", "Outages": 4},
    ])]}


class BuildResult(unittest.TestCase):
    def test_picks_the_town_row_not_a_street_row(self):
        r = fo.build_result(county(), town())
        self.assertEqual(r["southport"]["Outages"], 4)
        self.assertEqual(r["lincolnCounty"]["Outages"], 2)
        self.assertEqual(r["lastUpdated"], "2026-01-01 12:00:00")

    def test_no_matching_rows_means_null_not_error(self):
        r = fo.build_result(county(features=[]), town([]))
        self.assertIsNone(r["southport"])
        self.assertIsNone(r["lincolnCounty"])

    def test_junk_responses_are_rejected(self):
        for bad_county, bad_town in [
            ({}, {}),
            ({}, town()),
            (county(), {}),
            (county(lastUpdated=None), town()),
            (county(outages="5"), town()),
            (county(customers=None), town()),
            (county(features=None), town()),
            ([], town()),
            (county(outages=float("nan")), town()),
            (county(customers=float("inf")), town()),
        ]:
            with self.assertRaises(ValueError, msg=repr((bad_county, bad_town))):
                fo.build_result(bad_county, bad_town)

    def test_nan_and_infinity_from_raw_json_are_rejected(self):
        raw = json.loads('{"lastUpdated": "2026-01-01 12:00:00", "customers": NaN, "outages": Infinity, "features": []}')
        with self.assertRaises(ValueError):
            fo.build_result(raw, town())

    def test_result_round_trips_as_json(self):
        json.dumps(fo.build_result(county(), town()))


if __name__ == "__main__":
    unittest.main()
