# aaron-design-system, vendored

REDBEAM consumes **aaron-design-system v0.11.0** (`testusercar/aaron-design-system`).
`tokens.css` and `primitives.css` in this directory are byte-for-byte copies of
that release, with one edit: `primitives.css` imports `./tokens.css` instead of
the hosted `/tokens.css?v=0.11.0`.

## Why vendored and not the hosted URL

AGENTS.md rule 1 says import the system version-pinned from
`https://aaronm.zo.space/…?v=X.Y.Z`, and gives the reason: the host's CDN
force-caches `*.css` for four hours, so a new version must be a new URL.

That rule solves a *web* problem — a browser holding a stale edge copy. REDBEAM
is a Tauri desktop binary, and it has the opposite problem: a remote stylesheet
in the boot path means the chrome renders unstyled whenever the machine is
offline or behind a proxy that blocks the host. Estimators run this on jobsite
laptops. An app that looks broken without a network is worse than one that
updates on a release cadence.

Vendoring keeps the rule's *intent* — the version is pinned, and it is pinned
harder than a query string, because the bytes are in the commit. What it gives
up is automatic propagation: a token change upstream does not reach REDBEAM
until someone re-copies these files.

## Re-syncing to a new upstream release

```bash
gh repo clone testusercar/aaron-design-system /tmp/ads -- --depth 1
cp /tmp/ads/tokens/tokens.css     apps/desktop/src/ads/tokens.css
cp /tmp/ads/primitives/primitives.css apps/desktop/src/ads/primitives.css
sed -i "s|@import url('/tokens.css?v=[0-9.]*');|@import url('./tokens.css'); /* vendored: see ads/README.md */|" \
  apps/desktop/src/ads/primitives.css
```

Then check the first line of each file reads the new version, and update the
version recorded above and in `MIGRATION.md` upstream.

## Deviations from the standards, and why

| Standard | REDBEAM does | Because |
|---|---|---|
| 03 · load fonts from the Google Fonts URL | ships Geist + Geist Mono woff2 in `fonts/`, declared in `fonts.css` | same offline argument as above. Latin + latin-ext only. Instrument Serif is not shipped at all — archetype D forbids serif. |
| 08 · PWA shell, WCO zone behind `@media (display-mode: window-controls-overlay)` | in-app header at normal flow height, no reserved controls zone | the Tauri window keeps its native OS decorations (`decorations` is unset in `tauri.conf.json`, so it defaults to true). That is exactly 08's "Installed desktop, no WCO" fallback row: OS titlebar, in-app header in normal flow. Same 40px `--ads-titlebar-h`, same contents, no drag regions needed. If the window ever goes frameless, the WCO rules come back and this row changes. |
| AGENTS.md · surfaces register in `estate/registry.json` | not registered | the estate registry indexes rooms on `aaronm.zo.space`. REDBEAM is not a room; it has no URL. |

Everything else — the surface stack, the ink ramp, functional colour, the type
scale, the base-4 spacing grid, the radius set, Lucide-only iconography,
archetype D composition — applies unmodified.

## Primitives owed upstream

New `.ads-*` primitives written for REDBEAM are logged in
[`upstream-queue.md`](./upstream-queue.md) and pushed to the design system per
the AGENTS.md feedback loop before this app ships them.
