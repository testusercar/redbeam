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
| `apps/desktop/src-tauri/tauri.conf.json` | `plugins.updater.endpoints` and the public key. |

The endpoint configured today is:

```text
https://updates.redbeam.invalid/{{target}}/{{arch}}/{{current_version}}
```

`updates.redbeam.invalid` is not a real host. DNS for `.invalid` fails, so
Check for updates says it could not check. After the worker is deployed,
replace that hostname with the one `wrangler deploy` prints. Tauri substitutes
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

The `.sig` files are what you paste into the manifest. The worker can also
serve them at `/files/<name>`, but the app only needs the `.exe` URL and the
signature string inside the manifest.

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
| `GET /windows/x86_64/0.3.0` | `200` and the manifest when `0.3.0` is older. `204` when it is current or newer. `503` when `manifest.json` is missing or invalid — never `204`, which the app would read as up to date. |
| `GET /manifest` | The manifest, even for a current client. For the person publishing. |
| `GET /files/REDBEAM_…` | The object from R2. Names that are not `REDBEAM_` plus a safe filename are `404`. |

## Deploy

From a machine logged into the Cloudflare account that should host this
(the token stays in wrangler's own login, not in the repo):

```bash
cd workers/updater
npx wrangler r2 bucket create redbeam-updates
npx wrangler deploy
```

Copy the hostname wrangler prints into `plugins.updater.endpoints` in
`tauri.conf.json`, replacing `updates.redbeam.invalid`. Rebuild the app so
that URL is the one installed copies call.

## Publish a release

The signing key already lives outside the repo, at
`%USERPROFILE%\.redbeam\updater.key`. Do not commit it. The public half is
already in `tauri.conf.json`.

On Windows, for each architecture (see [PACKAGING.md](PACKAGING.md) — always
name the target):

```powershell
$env:TAURI_SIGNING_PRIVATE_KEY_PATH = "$env:USERPROFILE\.redbeam\updater.key"
npm run tauri:build:x64
npm run tauri:build:arm64
```

Each build writes the installer and a `.sig` next to it. Upload both
executables into the bucket under the names above:

```bash
npx wrangler r2 object put redbeam-updates/REDBEAM_0.3.1_x64-setup.exe --file path\to\REDBEAM_0.3.1_x64-setup.exe
npx wrangler r2 object put redbeam-updates/REDBEAM_0.3.1_arm64-setup.exe --file path\to\REDBEAM_0.3.1_arm64-setup.exe
```

The `.sig` contents go in the manifest, not necessarily as their own objects.
Write `manifest.json` from `manifest.example.json` with the new version, notes,
date, both signatures, and URLs on the worker host. Upload it last, so a check
never advertises a version whose installer is not there yet:

```bash
npx wrangler r2 object put redbeam-updates/manifest.json --file manifest.json --content-type application/json
```

Installed copies on an older version then see the update. Copies already on
that version get `204` and Settings says they are on the latest.

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
