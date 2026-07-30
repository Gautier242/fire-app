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
