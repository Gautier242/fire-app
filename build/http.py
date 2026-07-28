"""The only module that touches the network.

Timeouts, retries, and backoff live here so no source module can quietly
invent its own policy.
"""
import time

import requests

TIMEOUT_SECONDS = 30
ATTEMPTS = 3
BACKOFF_SECONDS = 2
USER_AGENT = "fire-near-me/1.0 (+https://github.com/Gautier242/fire-near-me)"


class FetchError(Exception):
    """Raised when a source could not be fetched within its attempt budget."""


def make_session():
    session = requests.Session()
    session.headers.update({"User-Agent": USER_AGENT})
    return session


def get_json(session, url, params=None, attempts=ATTEMPTS, timeout=TIMEOUT_SECONDS,
             sleep=time.sleep):
    last = None
    for attempt in range(attempts):
        try:
            response = session.get(url, params=params, timeout=timeout)
            response.raise_for_status()
            return response.json()
        except Exception as exc:  # noqa: BLE001 - any failure is retryable here
            last = exc
            if attempt < attempts - 1:
                sleep(BACKOFF_SECONDS * (attempt + 1))
    raise FetchError(f"{url} failed after {attempts} attempts: {last}") from last
