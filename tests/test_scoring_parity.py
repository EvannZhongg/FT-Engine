import json
import os
import unittest

import server


class ScoringParityTests(unittest.TestCase):
  def test_legacy_scoring_matches_shared_cases(self):
    fixture_path = os.path.join(os.path.dirname(__file__), "fixtures", "scoring-cases.json")
    with open(fixture_path, "r", encoding="utf-8") as source:
      cases = json.load(source)

    for scoring_case in cases:
      with self.subTest(scoring_case["name"]):
        referee = server.HeadlessReferee(1, "Judge A", scoring_case["mode"], None)
        referee._broadcast_update = lambda message_type: None
        for event in scoring_case["events"]:
          callback = referee._on_pri_data if event["role"] == "primary" else referee._on_sec_data
          callback(
            0,
            event["eventType"],
            event["totalPlus"],
            event["totalMinus"],
            event["deviceTimestampMs"],
          )
        self.assertEqual(referee.score, scoring_case["expected"])


if __name__ == "__main__":
  unittest.main()
