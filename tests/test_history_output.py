"""History is written beside the summary, and never at its expense.

The summary answers "should I leave". The history is a replay for people who
want to understand. If the history fetch fails, the summary must still publish.
"""
import json

from build.main import write_history


def test_history_is_written_as_its_own_file(tmp_path):
    payload = {"generated_at": "2026-07-28T20:00:00Z", "hours": 72,
               "points": [[-120.1, 50.2, 71, 1]], "wind": [[71, 12, 69]]}

    written = write_history(tmp_path, lambda: payload)

    assert written == payload
    assert json.loads((tmp_path / "history.json").read_text()) == payload


def test_a_failing_history_fetch_does_not_raise(tmp_path):
    def explode():
        raise RuntimeError("CWFIS is down")

    assert write_history(tmp_path, explode) is None
    assert not (tmp_path / "history.json").exists()


def test_a_stale_history_file_survives_a_failed_fetch(tmp_path):
    good = {"generated_at": "2026-07-28T20:00:00Z", "hours": 72,
            "points": [[-120.1, 50.2, 71, 1]], "wind": []}
    write_history(tmp_path, lambda: good)

    def explode():
        raise RuntimeError("CWFIS is down")

    write_history(tmp_path, explode)

    # Yesterday's replay is honest about its own timestamp; deleting it would
    # leave the scrubber with nothing to show at all.
    assert json.loads((tmp_path / "history.json").read_text()) == good
