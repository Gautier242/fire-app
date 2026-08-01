"""What the self-hosted fonts are allowed to cost, and that they are wired at all.

The stylesheet is shared by both sites and sits on the critical path of a page
somebody reads to decide whether to leave their house. Fonts are the easiest
thing on that path to grow without noticing: one more weight is one more file,
nothing breaks, and the page is 15 KB heavier on a network already degraded by
the fire.

So the rules are asserted rather than remembered:

- every font the stylesheet asks for is a file we actually ship,
- every file we ship is one the stylesheet asks for,
- the total stays inside a budget,
- nothing asks for a weight we do not have, because the browser would synthesise
  it and faked bold on a serif looks exactly as cheap as it is,
- the OFL licences ship beside the fonts, which the licence requires.
"""
import re
from pathlib import Path

CSS = Path("public/css/app.css")
FONT_DIR = Path("public/static/fonts")

# 30 KB against the 23.5 KB shipped today. Deliberately close: the point is that
# a third face or a second weight has to be a decision somebody takes on purpose,
# not something that arrives with a copy-pasted @font-face block.
BUDGET_KB = 30


def font_faces():
    """Every @font-face in the stylesheet, as (family, weight, url)."""
    css = CSS.read_text(encoding="utf-8")
    faces = []
    for block in re.findall(r"@font-face\s*\{(.*?)\}", css, re.S):
        family = re.search(r"font-family:\s*'([^']+)'", block)
        weight = re.search(r"font-weight:\s*(\d+)", block)
        url = re.search(r"url\('([^']+)'\)", block)
        assert family and weight and url, f"incomplete @font-face:\n{block}"
        faces.append((family.group(1), int(weight.group(1)), url.group(1)))
    return faces


def test_the_stylesheet_declares_the_fonts():
    assert font_faces(), "no @font-face in app.css: the fonts are not wired"


def test_every_declared_font_is_a_file_we_ship():
    for family, weight, url in font_faces():
        path = (CSS.parent / url).resolve()
        assert path.exists(), f"{family} {weight} points at a missing file: {url}"
        assert path.suffix == ".woff2", f"{family} {weight} is not woff2: {url}"


def test_every_shipped_font_is_one_the_stylesheet_asks_for():
    declared = {(CSS.parent / url).resolve() for _, _, url in font_faces()}
    shipped = {p.resolve() for p in FONT_DIR.glob("*.woff2")}
    orphans = sorted(p.name for p in shipped - declared)
    assert not orphans, f"shipped but never used, so pure weight: {orphans}"


def test_the_fonts_stay_inside_their_budget():
    total = sum(p.stat().st_size for p in FONT_DIR.glob("*.woff2"))
    assert total <= BUDGET_KB * 1024, (
        f"fonts are {total / 1024:.1f} KB against a {BUDGET_KB} KB budget. "
        "Drop a weight or raise the budget deliberately."
    )


def test_nothing_asks_for_a_weight_we_do_not_ship():
    """A rule naming a self-hosted family must not want a weight we lack.

    Browsers do not fail here, they synthesise: the text renders in a smeared
    fake bold. It looks like nobody checked, which on this page is the wrong
    thing to look like.

    Limit worth knowing: this reads declarations, it does not follow inheritance.
    A rule setting only font-weight on an element that inherits --mono from an
    ancestor rule is the same defect and passes here -- that is how
    `.seg button[aria-pressed="true"]` carried a synthesised bold. Catching those
    needs computed styles from a real browser, which is a screenshot pass, not
    this file.
    """
    css = CSS.read_text(encoding="utf-8")
    have = {(f, w) for f, w, _ in font_faces()}
    families = {f for f, _, _ in font_faces()}

    # Almost nothing names a family directly -- rules say font-family: var(--serif).
    # Resolve the custom properties to the families they contain, or this test
    # only ever inspects the :root block that defines them and never a rule that
    # could actually be wrong.
    # A quoted family name never contains a semicolon, and saying so is what keeps
    # this confined to one declaration: with a plain '[^']*' the greedy quote ran
    # from the first font name to the last one in the file, swallowing --sans and
    # --mono into --serif and leaving the whole check inspecting nothing.
    aliases = {}
    for name, value in re.findall(r"(--[\w-]+):\s*((?:[^;'\"]|'[^';]*'|\"[^\";]*\")*);", css):
        hit = {f for f in families if f"'{f}'" in value}
        if hit:
            aliases[name] = hit
    assert aliases, "no custom property resolves to a self-hosted family"

    # Rules outside @font-face that reach one of our families, however they say it.
    body = re.sub(r"@font-face\s*\{.*?\}", "", css, flags=re.S)
    for rule in re.findall(r"\{([^{}]*)\}", body):
        named = {f for f in families if f"'{f}'" in rule}
        for alias, fams in aliases.items():
            if re.search(rf"font(-family)?:[^;]*var\(\s*{alias}\s*\)", rule):
                named |= fams
        if not named:
            continue
        weight = re.search(r"font-weight:\s*(\d+)", rule)
        wanted = int(weight.group(1)) if weight else 400
        for family in named:
            assert (family, wanted) in have, (
                f"a rule sets {family} at weight {wanted}, which we do not ship. "
                f"Shipped: {sorted(w for f, w in have if f == family)}"
            )


def test_the_licences_ship_with_the_fonts():
    licences = list(FONT_DIR.glob("OFL*.txt"))
    assert len(licences) >= 2, "SIL OFL requires the licence to ship with the font"
    for licence in licences:
        assert "SIL Open Font License" in licence.read_text(encoding="utf-8")
