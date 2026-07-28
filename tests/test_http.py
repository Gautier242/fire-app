import pytest
from build.http import get_json, FetchError


class FakeResponse:
    def __init__(self, payload, status=200):
        self._payload = payload
        self.status_code = status

    def json(self):
        return self._payload

    def raise_for_status(self):
        if self.status_code >= 400:
            raise RuntimeError(f"HTTP {self.status_code}")


class FakeSession:
    def __init__(self, responses):
        self._responses = list(responses)
        self.calls = []

    def get(self, url, params=None, timeout=None):
        self.calls.append({"url": url, "params": params, "timeout": timeout})
        result = self._responses.pop(0)
        if isinstance(result, Exception):
            raise result
        return result


def test_get_json_returns_payload():
    session = FakeSession([FakeResponse({"ok": True})])
    assert get_json(session, "https://example.test/a") == {"ok": True}


def test_get_json_always_passes_a_timeout():
    session = FakeSession([FakeResponse({})])
    get_json(session, "https://example.test/a")
    assert session.calls[0]["timeout"] is not None


class FakeSleep:
    """Records backoff delays instead of waiting through them."""

    def __init__(self):
        self.delays = []

    def __call__(self, seconds):
        self.delays.append(seconds)


def test_get_json_raises_fetch_error_after_bounded_attempts():
    session = FakeSession([RuntimeError("boom")] * 5)
    slept = FakeSleep()
    with pytest.raises(FetchError):
        get_json(session, "https://example.test/a", attempts=3, sleep=slept)
    assert len(session.calls) == 3


def test_get_json_recovers_if_a_later_attempt_succeeds():
    session = FakeSession([RuntimeError("boom"), FakeResponse({"ok": True})])
    slept = FakeSleep()
    assert get_json(session, "https://example.test/a", attempts=3, sleep=slept) == {"ok": True}


def test_get_json_backs_off_progressively_and_not_after_the_last_attempt():
    session = FakeSession([RuntimeError("boom")] * 3)
    slept = FakeSleep()
    with pytest.raises(FetchError):
        get_json(session, "https://example.test/a", attempts=3, sleep=slept)
    # Two waits for three attempts: never sleep after the final failure.
    assert slept.delays == [2, 4]


def test_get_json_does_not_sleep_when_the_first_attempt_succeeds():
    session = FakeSession([FakeResponse({"ok": True})])
    slept = FakeSleep()
    get_json(session, "https://example.test/a", sleep=slept)
    assert slept.delays == []
