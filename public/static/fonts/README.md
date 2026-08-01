# Self-hosted fonts

Two faces, one weight each, Latin subset only. 23.5 KB total.

| File | Family | Weight | Bytes | Used for |
|---|---|---|---|---|
| `spectral-400-latin.woff2` | Spectral | 400 | 14,028 | headlines |
| `plex-mono-400-latin.woff2` | IBM Plex Mono | 400 | 10,052 | data, labels, the brand |

Both are SIL Open Font License 1.1; the licences ship beside them as the licence
requires. Spectral is by Production Type, IBM Plex Mono by IBM.

## Why self-hosted rather than a Google Fonts link

Two reasons, in order of weight:

1. A Munich court held in 2022 that embedding Google Fonts from Google's CDN
   transmits the visitor's IP address to a third party without consent, contrary
   to the GDPR. This site is read by the public in France. Serving the files
   ourselves removes the question entirely.
2. A font on a third-party host is a render dependency on somebody else's uptime,
   for a page whose whole job is to work during an emergency.

## Why one weight per face

Two weights of Spectral cost 28.8 KB rather than 14.0. A single weight is half the
bytes and forces the design to build hierarchy from size, colour and spacing
instead of from weight, which is the better discipline anyway.

Nothing may ask for a weight these files do not contain: the browser would
synthesise it, and faked bold on a serif looks exactly as cheap as it is. If a
second weight is ever genuinely needed, add the file and let `test_budget.py`
state the cost.

## Why `font-display: optional`

`swap` would render the headline in a fallback and then reflow it; `block` would
leave it invisible for up to three seconds. The headline is the sentence telling
somebody a fire is 12 km away, on a network degraded by the fire itself.

`optional` uses the font only if it is already cached. The first visit is served
in system fonts with no delay and no reflow; every later visit gets Spectral. The
typography is the thing that degrades, which is the correct thing to sacrifice.
