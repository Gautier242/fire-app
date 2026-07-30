"""Does this link still resolve?

The only networked half of the relay, kept in its own module so build/relay.py
stays pure and testable without a network.

This asks for a status code and nothing else. It does not read the page, follow
its content, or store anything from it: `stream=True` means the body is never
consumed into the program, so `.content` stays unpopulated and nothing here can
quote, count or cache what a linked page says. (The remote server may still push
bytes into a socket buffer; we discard them unread and close.) A HEAD request
would be lighter still, but several French government sites answer HEAD with 405
while serving GET fine, so this issues GET and throws the body away.

It goes through the project session rather than urllib for two reasons that both
decide a reader's experience. urllib raises HTTPError on every 4xx and 5xx, which
would collapse "the page answered with an error" into "our check failed" and leave
the False state unreachable in production. And urllib announces itself as
Python-urllib, which French government sites answer with 403 often enough that
working prefecture pages would be labelled as not responding during a fire.
"""
from build.http import make_session

# Enough for a curated directory and a hard stop if the file ever grows. Every
# check is a request to somebody else's server, so this is bounded by policy.
MAX_CHECKS = 40

# Deliberately shorter than the project-wide 30s. Only the product of the cap and
# the timeout bounds the build, and forty hanging links at 30s would add twenty
# minutes to a run that also has a fire map to publish. Unknown is a safe state, so
# waiting longer buys nothing that giving up sooner loses.
TIMEOUT_SECONDS = 10

# Anything that answers at all is reachable. Redirects especially: government sites
# move constantly, and a 301 is a working link.
REACHABLE_BELOW = 400


def _status(url):
    """The status code, and not one byte of the page behind it."""
    with make_session().get(url, timeout=TIMEOUT_SECONDS, stream=True) as response:
        return response.status_code


def check(entries, opener=_status, cap=MAX_CHECKS):
    """Mark each entry reachable, unreachable, or leave it unknown.

    Three states, deliberately. Unknown means our own check failed and says nothing
    about the page; False means the page answered with an error and is worth showing
    as such. A dead link during a fire is a fact, not a reason to shorten the list.

    Past the cap nothing was asked, so nothing may claim it was: True is only ever
    set by a check that actually happened.
    """
    out = []
    for index, entry in enumerate(entries or []):
        marked = dict(entry)
        marked["reachable"] = None
        if index < cap:
            try:
                marked["reachable"] = opener(entry["url"]) < REACHABLE_BELOW
            except Exception:  # noqa: BLE001 - our failure is not their outage
                marked["reachable"] = None
        out.append(marked)
    return out
