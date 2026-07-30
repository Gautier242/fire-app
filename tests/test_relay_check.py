"""Checking that a link still resolves, without reading the page behind it."""
from build.sources.fr import relay_check


def _entries():
    return [
        {"name": "Préfecture", "url": "https://ok.example/", "tier": "official",
         "area": "33", "note": "n", "reachable": None},
        {"name": "Groupe", "url": "https://gone.example/", "tier": "community",
         "area": "33", "note": "n", "reachable": None},
    ]


def test_a_live_link_is_marked_reachable_and_a_dead_one_is_marked_not():
    codes = {"https://ok.example/": 200, "https://gone.example/": 404}

    out = relay_check.check(_entries(), opener=lambda url: codes[url])

    assert [e["reachable"] for e in out] == [True, False]


def test_a_dead_link_is_kept_rather_than_dropped():
    """A page that is down during a fire is a fact worth showing.

    Dropping it would silently shorten the directory at the moment somebody most
    needs to know that the préfecture site is not answering.
    """
    out = relay_check.check(_entries(), opener=lambda url: 500)

    assert len(out) == 2
    assert all(e["reachable"] is False for e in out)


def test_a_check_that_raises_leaves_the_entry_unknown_not_dead():
    """A timeout on our side says nothing about the page."""
    def boom(url):
        raise OSError("network down")

    out = relay_check.check(_entries(), opener=boom)

    assert all(e["reachable"] is None for e in out)


def test_the_number_of_checks_is_capped():
    seen = []

    def counting(url):
        seen.append(url)
        return 200

    many = [dict(_entries()[0], url=f"https://x{i}.example/") for i in range(30)]
    out = relay_check.check(many, opener=counting, cap=5)

    assert len(seen) == 5
    assert len(out) == 30, "entries past the cap are kept, just unchecked"
    assert out[9]["reachable"] is None


def test_an_unchecked_entry_cannot_arrive_already_marked():
    """Past the cap nothing was checked, so nothing may claim it was.

    The three states only mean anything if True is only ever set by a check that
    actually happened. An entry handed in pre-marked -- a stale value carried over
    from a previous run -- must be reset to unknown rather than passed through.
    """
    stale = [dict(_entries()[0], url=f"https://x{i}.example/", reachable=True)
             for i in range(4)]

    out = relay_check.check(stale, opener=lambda url: 200, cap=2)

    assert [e["reachable"] for e in out] == [True, True, None, None]


def test_a_redirect_counts_as_reachable():
    """Government sites redirect constantly; a 301 is not a dead link."""
    out = relay_check.check(_entries()[:1], opener=lambda url: 301)

    assert out[0]["reachable"] is True


def test_the_worst_case_check_time_stays_inside_a_build():
    """Every check is a request that can hang until it times out.

    The cap bounds how many, the timeout bounds each, and only the product bounds
    the build. A directory of forty links that all hang must not add twenty
    minutes to a run that also has a fire map to publish. Unknown is a safe state,
    so waiting longer buys nothing a shorter timeout loses.
    """
    worst_case_seconds = relay_check.MAX_CHECKS * relay_check.TIMEOUT_SECONDS

    assert worst_case_seconds <= 480, (
        f"{relay_check.MAX_CHECKS} links x {relay_check.TIMEOUT_SECONDS}s "
        f"= {worst_case_seconds}s of build time in the worst case")


def test_a_host_that_answers_200_for_anything_is_never_marked_reachable():
    """Facebook returns 200 for a page that cannot exist.

    Measured 2026-07-30: a real prefecture page, an invented group and an
    impossible username all return HTTP 200 at ~308.5 KB with the title
    "Facebook", within 62 bytes of each other. A status code carries no
    information about whether the page is there, so marking such a link
    reachable would show a reader a check mark nobody earned.

    Unknown rather than unreachable: the page may well exist, we simply cannot
    tell, and claiming it is down would be its own false statement.
    """
    entries = [
        {"name": "Groupe", "url": "https://www.facebook.com/groups/x/",
         "tier": "community", "area": "33", "note": "n", "reachable": None},
        {"name": "Page", "url": "https://m.facebook.com/prefet33/",
         "tier": "community", "area": "33", "note": "n", "reachable": None},
        {"name": "Prefecture", "url": "https://www.gironde.gouv.fr/",
         "tier": "official", "area": "33", "note": "n", "reachable": None},
    ]

    out = relay_check.check(entries, opener=lambda url: 200)

    assert out[0]["reachable"] is None, "facebook.com cannot be checked"
    assert out[1]["reachable"] is None, "any facebook subdomain, not just www"
    assert out[2]["reachable"] is True, "and a checkable host still gets checked"


def test_an_uncheckable_host_costs_no_request():
    """Asking is pointless when the answer carries no information."""
    asked = []
    entries = [{"name": "G", "url": "https://www.facebook.com/groups/x/",
                "tier": "community", "area": "33", "note": "n", "reachable": None}]

    relay_check.check(entries, opener=lambda url: asked.append(url) or 200)

    assert asked == []
