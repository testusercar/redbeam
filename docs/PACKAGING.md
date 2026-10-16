# Packaging REDBEAM

How the app becomes something an estimator can install, and what is still
missing from that story.

## Building

From `apps/desktop`, **always name the target**. A bare `tauri build` is never
the right command here: the bundler labels artifacts after the HOST machine
rather than the compile target, so on Aaron's ARM64 PC it produced
`REDBEAM_0.1.0_arm64_en-US.msi` containing an x86-64 executable. An installer
that declares the wrong architecture may refuse to install on the very machines
it is meant for, or install and then confuse whoever debugs it.

**Native ARM64** — what Aaron's machine actually is:

```bash
npm run tauri:build:arm64
```

One-time setup: `rustup toolchain install stable-aarch64-pc-windows-msvc`. The
script sets `RUSTUP_TOOLCHAIN` for itself rather than changing the global
default, so the x64 build below keeps working. It also runs `vcvarsarm64`,
because `embed-resource` (the icon resource) drives cc-rs and needs `cl.exe`
with `INCLUDE`/`LIB` set — without it cc-rs looks for clang and stops.

This was impossible until the TLS backend changed. `rustls` pulls `ring`, whose
build script assembles its aarch64 crypto with **clang specifically** — `cl.exe`
will not substitute, and setting up the MSVC environment does not help. Rather
than require a 2.5GB LLVM install on every machine that builds for ARM64, the
updater uses `native-tls`, which on Windows is schannel. See the note on the
dependency in `src-tauri/Cargo.toml`.

**x86-64** — for machines that are not ARM:

```bash
npm run tauri:build:x64
```

Either runs `npm run build` (Vite) first, then compiles Rust in release and
wraps it. Output lands under
`apps/desktop/src-tauri/target/<target-triple>/release/bundle/`:

- `nsis/REDBEAM_<version>_<arch>-setup.exe` — the installer to hand people
- `msi/REDBEAM_<version>_<arch>_en-US.msi` — for deployment via group policy

Verify the label is honest before shipping one — the whole point is that it
once was not. The PE machine type is `0xAA64` for ARM64 and `0x8664` for x64:

```bash
powershell -c "$b=[IO.File]::ReadAllBytes('<path to redbeam.exe>'); '0x{0:X4}' -f [BitConverter]::ToUInt16($b,[BitConverter]::ToInt32($b,0x3C)+4)"
```

## The two Windows choices, and why

**Per-user install** (`nsis.installMode: "currentUser"`). An estimator on a
managed Maxxit laptop may not have administrator rights, and an installer that
demands them is one they cannot run. Per-user installs to `%LOCALAPPDATA%` and
needs no elevation. The cost is that the app is installed for one account
rather than the machine; the MSI is there for the case where IT wants to push
it machine-wide.

**WebView2 via the download bootstrapper**
(`webviewInstallMode: "downloadBootstrapper"`). REDBEAM renders its entire UI
in WebView2, so a machine without the runtime gets a window that never paints.
Current Windows 10 and 11 ship it, but "current" is an assumption about someone
else's laptop. The bootstrapper is roughly 2 MB and fetches the runtime only if
it is absent; the offline alternative adds about 130 MB to every download for a
case that will almost never fire.

## Signing — NOT DONE, and what it needs

**The installer is unsigned.** This is the honest state, not an oversight to be
discovered later.

What that means in practice: Windows SmartScreen shows "Windows protected your
PC" and hides the Run button behind *More info*. Some managed environments will
refuse the file outright, and a browser may warn on download. Nothing about the
app is wrong — the binary simply has no verifiable publisher, so Windows says
so, and it says so in language that reads like a virus warning to the person
being asked to install it.

Signing needs a certificate, which is a purchase and an identity check, not a
configuration change:

- An **OV** (organisation validated) code-signing certificate is cheaper and
  builds SmartScreen reputation gradually — early installs still warn.
- An **EV** (extended validation) certificate carries immediate SmartScreen
  reputation, costs more, and the private key must live on hardware or in an
  attested cloud key store.
- **Azure Trusted Signing** is the current middle path: pay per use, no
  hardware token, and it satisfies the EV reputation rules. It requires an
  Azure tenant and a verified organisation identity.

Once a certificate exists, Tauri signs during `tauri build` via
`bundle.windows.certificateThumbprint` (for a cert in the Windows store) or
`bundle.windows.signCommand` (for anything else, including Trusted Signing).
Nothing else in this repo has to change.

Until then, hand people the installer with a sentence telling them the warning
is expected and what to click. An unexplained SmartScreen dialog is how a tool
gets a reputation for being broken before it is opened.

## Updates

The updater looks at the Worker in `workers/updater`. The endpoint in
`tauri.conf.json` is the live host:

```text
https://redbeam-updates.trackchairking.workers.dev/{{target}}/{{arch}}/{{current_version}}
```

A missing manifest answers `503` on that URL, so the app says it could not
check. It does not say the copy is up to date. `GET /health` answers `200`
with `"channel": "published"` once a manifest is in R2, and `"channel": "empty"`
when the bucket has none. Shipping a release is a version bump, a `v*` tag,
and GitHub Actions. That path does not use the XPS. The free-tier ceiling,
the Actions secrets, and the Settings row are in [UPDATES.md](UPDATES.md).

The updater signing key is not the Authenticode certificate above. It lives
OUTSIDE the repo, at `%USERPROFILE%\.redbeam\updater.key`, and its public half
is in `tauri.conf.json` (minisign key id `F0ECFC2EF7375954`). **Back that file
up,** and paste it once into the GitHub Actions secret
`TAURI_SIGNING_PRIVATE_KEY`. It is not recoverable: an installed copy only
accepts an update signed by the private half of the key it shipped with, so
losing it strands every existing install permanently — they can then only be
moved by hand.

A local signed build, when you are not cutting a release, still names the
target and points at that file:

```powershell
$env:TAURI_SIGNING_PRIVATE_KEY_PATH = "$env:USERPROFILE\.redbeam\updater.key"
npm run tauri:build:x64
npm run tauri:build:arm64
```

Each build emits a `.sig` beside the NSIS installer. The release workflow
calls `workers/updater/publish.ps1`, which uploads those installers and
`.sig` files with `wrangler --remote`, then `manifest.json` last, in the
same run as the GitHub Release. The script does not read the private key,
and it refuses that upload from a PC (use `-DryRun` there).
`scripts/build-arm64.cmd` is
the native ARM64 machine script. GitHub Actions cross-compiles arm64 on
`windows-latest` instead, and passes `--bundles nsis` because WiX has no
arm64 bundle.

The manifest the worker serves:

```json
{
  "version": "0.3.0",
  "notes": "What changed",
  "pub_date": "2026-09-23T00:00:00Z",
  "platforms": {
    "windows-x86_64": {
      "signature": "<contents of the .sig file>",
      "url": "https://redbeam-updates.trackchairking.workers.dev/files/REDBEAM_0.3.0_x64-setup.exe"
    },
    "windows-aarch64": {
      "signature": "<contents of the .sig file>",
      "url": "https://redbeam-updates.trackchairking.workers.dev/files/REDBEAM_0.3.0_arm64-setup.exe"
    }
  }
}
```

It must be HTTPS: the updater will not fetch over plain HTTP or a UNC path.
Install stays in place (`windows.installMode: passive`). The private key stays
outside the repo.

**An empty endpoint list still has to say so.** If `endpoints` is emptied
again, Settings reports "No update channel is set up… it will stay on this
version" rather than "you're up to date", and offers no button that cannot
succeed. A failed check says "could not check". That distinction is
load-bearing and tested.

## Problem reports

Built (plan TH.8), and deliberately **files on disk rather than telemetry**.
REDBEAM has two users; what is needed is that when it dies on somebody's
machine, something remains that they can send — not an aggregation service and
a dashboard nobody opens. Nothing is uploaded, so there is no consent question
and no network call at the moment the app is already failing.

Three failures are caught, and they are genuinely different:

- A **Rust panic** kills the process. The React error boundary never runs and
  the window vanishes, so a panic hook writes the report instead.
- A **render error** is caught by the boundary, which shows the stack. That is
  enough only while the window is open — reload it, which is the first thing
  anybody does, and the evidence is gone. So it is written too, and the crash
  screen names the file.
- An **unhandled promise rejection** reaches neither. Ingest, SQLite writes and
  PDF export are all async, and a rejection in one leaves a window that looks
  healthy and has quietly stopped working.

Reports land in the app log directory and are listed under **Problem reports**
in Settings, newest first. Twenty are kept: a crash loop must not fill an
estimator's disk, and the twentieth copy of one stack teaches nothing the first
did not.

Each file states its own contents in a header, because one of them is the open
project's PATH — which names a client folder. Somebody about to email a report
is entitled to know what they are sending without reading a stack trace to find
out. Nothing else about the project is included: no drawings, no markups, no
quantities.
