# In-place updates

REDBEAM installs over itself. Settings → This copy checks a manifest, downloads
the signed installer, and restarts into it. Nobody is emailed a new link.

The mechanism has been in the app since the updater plugin was added
(`windows.installMode: passive` in `apps/desktop/src-tauri/tauri.conf.json`).
What was missing was a place for that check to look. This is that place: a
Cloudflare Worker in `workers/updater` that reads a manifest and the installers
from R2.

## What is in the repo

| Path | Role |
| --- | --- |
| `workers/updater/src/index.ts` | The worker. Manifest check, and a proxy for installer files. |
| `workers/updater/src/manifest.ts` | Version compare and manifest parsing. Tested. No Cloudflare types. |
| `workers/updater/wrangler.toml` | Worker name `redbeam-updates`, R2 binding `UPDATES`. No account id, no token. |
| `workers/updater/manifest.example.json` | The shape to upload as `manifest.json`. Not uploaded by itself. |
| `workers/updater/publish.ps1` | On Windows: upload the signed installers and `.sig` files, then `manifest.json` last. |
| `apps/desktop/src-tauri/tauri.conf.json` | `plugins.updater.endpoints` and the public key. |

The endpoint configured today is:

```text
https://redbeam-updates.trackchairking.workers.dev/{{target}}/{{arch}}/{{current_version}}
```

`redbeam-updates.trackchairking.workers.dev` is the live Worker host (deployed 2026-09-23).
Change this only if you redeploy under a different workers.dev or custom domain. Tauri substitutes
`{{target}}`, `{{arch}}`, and `{{current_version}}` (for this app,
`windows`, `x86_64` or `aarch64`, and the version in `tauri.conf.json`).

## R2 layout

One bucket, bound as `UPDATES`. Object keys:

```text
manifest.json
REDBEAM_<version>_x64-setup.exe
REDBEAM_<version>_x64-setup.exe.sig
REDBEAM_<version>_arm64-setup.exe
REDBEAM_<version>_arm64-setup.exe.sig
```

Upload each installer and its `.sig`. The signature string inside the manifest
is the contents of that `.sig` file. The app downloads the `.exe` URL from the
manifest; `/files/<name>` is what serves it. The `.sig` object is there so a
later check can see the signature that was published, not because the app
fetches it on its own.

`manifest.json`:

```json
{
  "version": "0.3.1",
  "notes": "What changed.",
  "pub_date": "2026-09-23T00:00:00Z",
  "platforms": {
    "windows-x86_64": {
      "signature": "<entire contents of the x64 .sig file>",
      "url": "https://<worker-host>/files/REDBEAM_0.3.1_x64-setup.exe"
    },
    "windows-aarch64": {
      "signature": "<entire contents of the arm64 .sig file>",
      "url": "https://<worker-host>/files/REDBEAM_0.3.1_arm64-setup.exe"
    }
  }
}
```

Both platforms belong in every manifest. A machine asks for its own key
(`windows-x86_64` or `windows-aarch64`). A manifest that only has the other
architecture is not an update for the one that is asking.

Routes:

| Request | Response |
| --- | --- |
| `GET /health` | `200` `{"ok":true,"channel":"empty"}` when the bucket has no manifest, `"invalid"` when the object is there but unusable, `"published"` when a check can proceed. `503` `{"ok":false,"channel":"unreachable"}` only when R2 itself cannot be read. An empty bucket is a live worker. |
| `GET /windows/x86_64/0.3.0` | `200` and the manifest when `0.3.0` is older. `204` when it is current or newer. `503` when `manifest.json` is missing (`no manifest published`), invalid (`manifest is not valid`), or the bucket cannot be read — never `204`, which the app would read as up to date. |
| `GET /manifest` | The manifest, even for a current client. For the person publishing. The same `503` errors as a version check when there is nothing valid to show. |
| `GET /files/REDBEAM_…` | The object from R2. Names that are not `REDBEAM_` plus a safe filename are `404`. |

## Free tier

One R2 bucket, Standard storage only, on the Workers free plan. The numbers
below are the included amounts from Cloudflare's R2 pricing (Standard only;
Infrequent Access is not included):

| | Included each month |
| --- | --- |
| Storage | 10 GB-month |
| Class A (uploads, lists) | 1 million |
| Class B (downloads of the manifest and installers) | 10 million |
| Egress | Free |

Stop well before the storage cap. If the bucket dashboard is around **8 GB**,
delete old `REDBEAM_*` objects before another publish. `DeleteObject` is a free
operation. `publish.ps1` refuses a single publish larger than 512 MB, which a
real NSIS installer is not, and it asks you to confirm the bucket is under 8 GB
before it uploads anything.

Do not add a second bucket, do not set an R2 storage class, and do not set
`[limits]` in `wrangler.toml` (that raises Worker CPU on the paid plan). A
publish is a handful of Class A puts. The app's update check is one Class B
read of `manifest.json`, then one read of the installer if the person installs it.

## Deploy

The bucket `redbeam-updates` and the Worker are already deployed. Wrangler on
the XPS must be logged into the account that owns them
(`trackchairking@gmail.com`). The token stays in wrangler's own login, not in
the repo. `wrangler.toml` has no account id.

Create the bucket only if `whoami` is that account and the bucket is actually
missing:

```bash
cd workers/updater
npx wrangler whoami
npx wrangler r2 bucket create redbeam-updates
npx wrangler deploy
```

After a worker change (the `/health` route is one), deploy again from that
same directory. This cloud VM does not have the Cloudflare login.

```powershell
cd workers\updater
npx wrangler whoami
npx wrangler deploy
curl.exe https://redbeam-updates.trackchairking.workers.dev/health
```

Until `manifest.json` is uploaded, that body is
`{"ok":true,"channel":"empty"}`. A version check stays `503` with
`no manifest published`. Copy the hostname wrangler prints into
`plugins.updater.endpoints` in `tauri.conf.json` only if the host changes.
Rebuild the app so that URL is the one installed copies call.

## Publish a release

The signing key already lives outside the repo, at
`%USERPROFILE%\.redbeam\updater.key`. Do not commit it. The public half is
already in `tauri.conf.json`. `publish.ps1` never reads that file.

### Seed, then a newer build (Windows XPS)

The copy you install has to be older than the manifest, or the check returns
`204` and there is nothing to exercise. Build the seed at the version in
`tauri.conf.json` (today `0.3.0`), install it, then bump and publish the next
version. From `apps/desktop`, always name the target
([PACKAGING.md](PACKAGING.md)). The XPS smoke can be the one architecture that
machine is; a manifest you hand to anyone else should contain both.

```powershell
$env:TAURI_SIGNING_PRIVATE_KEY_PATH = "$env:USERPROFILE\.redbeam\updater.key"
npm run tauri:build:arm64
```

Install the seed (the arch you just built; use `tauri:build:x64` instead when
the machine is x64):

```text
apps\desktop\src-tauri\target\aarch64-pc-windows-msvc\release\bundle\nsis\REDBEAM_0.3.0_arm64-setup.exe
```

SmartScreen is expected on an unsigned installer: More info → Run anyway.
Leave that copy installed. Do not upload `0.3.0` as the manifest you want this
copy to notice.

Bump `version` in `apps/desktop/src-tauri/tauri.conf.json` and
`apps/desktop/src-tauri/Cargo.toml` (the installer name and the in-app version
come from `tauri.conf.json`). Rebuild the same way so the new tree produces
`REDBEAM_0.3.1_<arch>-setup.exe` and a `.sig` beside it. Build the other
architecture too when you have it.

From the repo root, upload installers and signatures, then the manifest last:

```powershell
.\workers\updater\publish.ps1 -Version 0.3.1 -Notes "What changed."
```

One architecture, for this XPS only:

```powershell
.\workers\updater\publish.ps1 -Version 0.3.1 -Notes "What changed." -AllowSingleArch
```

The script looks in `apps/desktop/src-tauri/target/<triple>/release/bundle/nsis/`
for `REDBEAM_<version>_x64-setup.exe` and `REDBEAM_<version>_arm64-setup.exe`,
each with a `.sig`. It writes `workers/updater/.publish/manifest.json` (gitignored)
with the signature string from each `.sig` and these URLs, then runs, in order:

```text
npx wrangler r2 object put redbeam-updates/REDBEAM_0.3.1_x64-setup.exe --file <exe> --content-type application/octet-stream
npx wrangler r2 object put redbeam-updates/REDBEAM_0.3.1_x64-setup.exe.sig --file <sig> --content-type "text/plain; charset=utf-8"
npx wrangler r2 object put redbeam-updates/REDBEAM_0.3.1_arm64-setup.exe --file <exe> --content-type application/octet-stream
npx wrangler r2 object put redbeam-updates/REDBEAM_0.3.1_arm64-setup.exe.sig --file <sig> --content-type "text/plain; charset=utf-8"
npx wrangler r2 object put redbeam-updates/manifest.json --file workers\updater\.publish\manifest.json --content-type application/json
```

`-DryRun` writes the manifest and prints that order without calling wrangler
and without the 8 GB prompt. A failed put stops the script before
`manifest.json`, so a check never advertises a version whose installer is not
there yet.

Open the installed `0.3.0` copy → Settings → This copy → Check for updates.
It should offer `0.3.1`. Download and install, restart, and the row should
then say that version is the latest (`204` on the next check).

```powershell
curl.exe https://redbeam-updates.trackchairking.workers.dev/health
curl.exe -D - https://redbeam-updates.trackchairking.workers.dev/windows/aarch64/0.3.0
```

The path the app calls is `windows/x86_64` or `windows/aarch64`. The installer
filename still says `x64` or `arm64`. An older version gets `200` and the
manifest. The published version gets `204`.

## What Settings does

The row is `UpdateRow` under This copy. It reads `UPDATES_CONFIGURED` from the
same `tauri.conf.json` the updater plugin reads.

| State | What the row says | Button |
| --- | --- | --- |
| No endpoints at all | No update channel is set up. This copy cannot check. | none |
| Endpoint configured, not yet checked | You are on 0.3.0. | Check for updates |
| Check in flight | Checking… | none |
| `204` | You are on 0.3.0, which is the latest. | Check for updates |
| Manifest for a newer version | Version x.y.z is available. | Download and install |
| Download | Downloading… and a percent when the length is known | none |
| Install finished | Installed, and starts when you restart REDBEAM. | Restart now |
| Network error, `503`, or the placeholder host | Could not check for updates: … | Check for updates |

Download and install uses the updater plugin's in-place install. It does not
open a browser and it does not hand the estimator a link. Restart is
`plugin-process` `relaunch`.

A check that fails is not "you are up to date". That sentence is reserved for
a manifest that says this version is current.
