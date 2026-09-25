# In-place updates

REDBEAM installs over itself. An installed copy checks the update channel when
it launches, again every four hours while it stays open, and when the window
is focused after at least thirty minutes. If a newer signed build is
published, the same Settings row appears on its own: **Download and install**,
then **Restart now**. The installer runs passive (`windows.installMode` in
`tauri.conf.json`). Nothing installs itself, and nobody is emailed a new link.

Publishing that build does not use a particular PC. GitHub Actions on
`windows-latest` builds, signs, and uploads. The XPS is not part of the path.

## How to ship

1. Bump `version` to the same dotted number in:
   - `apps/desktop/src-tauri/tauri.conf.json`
   - `apps/desktop/src-tauri/Cargo.toml` (`[package]`)
   - `apps/desktop/package.json`
   - `package.json`
2. Commit and push that bump.
3. Tag the commit and push the tag. The tag is `v` plus the version, for example `v0.3.2`. Annotated or lightweight both work; an annotated tag's message becomes the release notes.

```powershell
git tag -a v0.3.2 -m "What changed."
git push origin v0.3.2
```

GitHub Actions then:

- builds a signed x64 NSIS installer and a signed arm64 NSIS installer
- uploads each installer and its `.sig`, then `manifest.json` last, with `wrangler r2 object put --remote`
- attaches those files to a GitHub Release for the tag

Installed copies see the update on the next check. The Worker reports
`{"ok":true,"channel":"published"}` from `/health` once the manifest is up.

`workflow_dispatch` (Actions → Release → Run workflow) is the same pipeline.
It asks for the version and the notes. **Dry run defaults to on**: it builds
and signs and writes the manifest, and it does not upload to R2 or open a
GitHub Release. Turn dry run off to publish the commit you dispatched without
pushing a tag. If the tag already points at a different commit, the workflow
stops before uploading.

`-AllowSingleArch` is not used here. A release publishes both architectures.
That switch is only for a one-architecture smoke of `publish.ps1`.

## Secrets

The workflow reads GitHub Actions secrets. Cloud agents are not the builders.
They already have the Cloudflare values below; those values are **not** copied
into GitHub for you. Confirm the Actions secrets exist on the repository
(Settings → Secrets and variables → Actions).

| Secret | Where it has to be | What it is |
| --- | --- | --- |
| `CLOUDFLARE_API_TOKEN` | GitHub Actions. Also already on cloud agents. | API token that can write the `redbeam-updates` R2 bucket and deploy the Worker. |
| `CLOUDFLARE_ACCOUNT_ID` | GitHub Actions. Also already on cloud agents. | The Cloudflare account that owns the bucket. Wrangler will not prompt for it. |
| `TAURI_SIGNING_PRIVATE_KEY` | GitHub Actions only. **Not** on cloud agents. | The entire updater private key file, including its comment lines. Not a path. |
| `TAURI_SIGNING_PRIVATE_KEY_PASSWORD` | GitHub Actions, only if that key was created with a password. | Leave it unset when the password is empty. The workflow passes the secret through, and an unset secret is an empty string, which is what Tauri wants for an unencrypted key. |

Nothing in the repo is that private key. Do not commit it. Do not put it in a
cloud-agent secret to make this workflow run; the runner reads GitHub Actions
secrets only.

### One-time copy of the signing key

The private key stays in `%USERPROFILE%\.redbeam\updater.key` on the XPS for
anyone signing a build by hand. The release workflow cannot see that file.
Once, paste the file's contents into the GitHub Actions secret
`TAURI_SIGNING_PRIVATE_KEY`. After that, tagging a release does not touch the
XPS.

The public half in `tauri.conf.json` is minisign key id **F0ECFC2EF7375954**.
That is the key that signed the published 0.3.1 installer. The older id
`E3C6A68C64ABA8A6` does not verify that file. Paste the private key that
matches **F0ECFC2EF7375954** — the one that was set as
`TAURI_SIGNING_PRIVATE_KEY_PATH` when 0.3.1 was signed. Losing it strands every
install that trusts it: they can then only be moved by handing someone a new
installer.

## What is in the repo

| Path | Role |
| --- | --- |
| `.github/workflows/release.yml` | Tag or dispatch → Windows NSIS build, sign, R2 publish, GitHub Release. |
| `workers/updater/src/index.ts` | The worker. Manifest check, and a proxy for installer files. |
| `workers/updater/src/manifest.ts` | Version compare and manifest parsing. Tested. No Cloudflare types. |
| `workers/updater/wrangler.toml` | Worker name `redbeam-updates`, R2 binding `UPDATES`. No account id, no token. |
| `workers/updater/manifest.example.json` | The shape to upload as `manifest.json`. Not uploaded by itself. |
| `workers/updater/publish.ps1` | Upload the signed installers and `.sig` files, then `manifest.json` last. Every put uses `--remote`. |
| `workers/updater/assert-version.mjs` | Refuses a tag that does not match the versions committed in the tree. |
| `apps/desktop/src-tauri/tauri.conf.json` | `plugins.updater.endpoints`, the public key, `installMode: passive`. |

The endpoint configured today is:

```text
https://redbeam-updates.trackchairking.workers.dev/{{target}}/{{arch}}/{{current_version}}
```

`redbeam-updates.trackchairking.workers.dev` is the live Worker host. Change
this only if you redeploy under a different workers.dev or custom domain. Tauri
substitutes `{{target}}`, `{{arch}}`, and `{{current_version}}` (for this app,
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
  "version": "0.3.2",
  "notes": "What changed.",
  "pub_date": "2026-09-25T00:00:00Z",
  "platforms": {
    "windows-x86_64": {
      "signature": "<entire contents of the x64 .sig file>",
      "url": "https://redbeam-updates.trackchairking.workers.dev/files/REDBEAM_0.3.2_x64-setup.exe"
    },
    "windows-aarch64": {
      "signature": "<entire contents of the arm64 .sig file>",
      "url": "https://redbeam-updates.trackchairking.workers.dev/files/REDBEAM_0.3.2_arm64-setup.exe"
    }
  }
}
```

Both platforms belong in every release manifest. A machine asks for its own
key (`windows-x86_64` or `windows-aarch64`). A manifest that only has the
other architecture is not an update for the one that is asking.
`-AllowSingleArch` exists so a one-machine smoke can publish anyway. The
release workflow does not pass it.

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
operation. `publish.ps1` refuses a single publish larger than 512 MB, warns at
200 MB, and never sets a storage class. `-Yes` and `CI=true` skip the
"type yes" prompt. They do not skip the 512 MB stop, and they do not look at
the dashboard for you.

Do not add a second bucket, do not set an R2 storage class, and do not set
`[limits]` in `wrangler.toml` (that raises Worker CPU on the paid plan). A
publish is a handful of Class A puts. Each app check is one Class B read of
`manifest.json`, then one read of the installer if the person installs it.
Do not publish extra installers to try the pipeline. Use dry run.

`wrangler r2 object put` without `--remote` writes to local Miniflare. The
live `/health` does not change. `publish.ps1` always passes `--remote`.

## Deploy the Worker

The bucket `redbeam-updates` and the Worker are already deployed. Wrangler
authenticates with `CLOUDFLARE_API_TOKEN` and `CLOUDFLARE_ACCOUNT_ID`. It does
not need a login on a particular machine. `wrangler.toml` has no account id.

Create the bucket only if it is actually missing:

```bash
cd workers/updater
npx wrangler whoami
npx wrangler r2 bucket create redbeam-updates
npx wrangler deploy
```

After a worker change, deploy again from that directory, with those two
variables set. Then:

```bash
curl -fsS https://redbeam-updates.trackchairking.workers.dev/health
```

A published channel returns `{"ok":true,"channel":"published"}`. An empty
bucket returns `"channel":"empty"`, and a version check stays `503` with
`no manifest published`. Copy the hostname wrangler prints into
`plugins.updater.endpoints` only if the host changes. Rebuild so installed
copies call the new URL.

## publish.ps1 by hand

The release workflow is the way a version ships. The script is what that
workflow runs, and it still runs on its own when you already have signed
installers on disk. It never reads the private key.

From the repo root:

```powershell
.\workers\updater\publish.ps1 -Version 0.3.2 -Notes "What changed." -Yes
```

One architecture, smoke only:

```powershell
.\workers\updater\publish.ps1 -Version 0.3.2 -Notes "What changed." -AllowSingleArch -Yes
```

`-DryRun` writes `workers/updater/.publish/manifest.json` (gitignored) and
prints the put order. It does not call wrangler and it does not prompt.
`-Yes` skips the prompt. So does `CI=true` or `GITHUB_ACTIONS=true`.

The script looks in `apps/desktop/src-tauri/target/<triple>/release/bundle/nsis/`
for `REDBEAM_<version>_x64-setup.exe` and `REDBEAM_<version>_arm64-setup.exe`,
each with a `.sig`. It then runs, in order:

```text
npx wrangler r2 object put redbeam-updates/REDBEAM_0.3.2_x64-setup.exe --file <exe> --content-type application/octet-stream --remote
npx wrangler r2 object put redbeam-updates/REDBEAM_0.3.2_x64-setup.exe.sig --file <sig> --content-type "text/plain; charset=utf-8" --remote
npx wrangler r2 object put redbeam-updates/REDBEAM_0.3.2_arm64-setup.exe --file <exe> --content-type application/octet-stream --remote
npx wrangler r2 object put redbeam-updates/REDBEAM_0.3.2_arm64-setup.exe.sig --file <sig> --content-type "text/plain; charset=utf-8" --remote
npx wrangler r2 object put redbeam-updates/manifest.json --file workers\updater\.publish\manifest.json --content-type application/json --remote
```

A failed put stops the script before `manifest.json`, so a check never
advertises a version whose installer is not there yet.

```powershell
curl.exe https://redbeam-updates.trackchairking.workers.dev/health
curl.exe -D - https://redbeam-updates.trackchairking.workers.dev/windows/x86_64/0.3.0
```

The path the app calls is `windows/x86_64` or `windows/aarch64`. The installer
filename still says `x64` or `arm64`. An older version gets `200` and the
manifest. The published version gets `204`.

## What the app does

The row is `UpdateRow` under This copy, and the same row is `UpdateOffer` at
the top of the window while an update is waiting. Both read one check. The
offer is not a dialog. Settings covers it, and Settings has the row too.

It reads `UPDATES_CONFIGURED` from the same `tauri.conf.json` the updater
plugin reads.

| State | What the row says | Button |
| --- | --- | --- |
| No endpoints at all | No update channel is set up. This copy cannot check. | none |
| Endpoint configured, not yet checked | You are on 0.3.0. | Check for updates |
| Check in flight | Checking… | none |
| `204` | You are on 0.3.0, which is the latest. | Check for updates |
| Manifest for a newer version | Version x.y.z is available. | Download and install |
| Download | Downloading… and a percent when the length is known | none |
| Install finished | Installed, and starts when you restart REDBEAM. | Restart now |
| Network error, `503`, or a bad response | Could not check for updates: … | Check for updates |

Launch, the four-hour timer, and a focus check all call the same check. They
do not download. Download and install uses the updater plugin's in-place
install. It does not open a browser. Restart is `plugin-process` `relaunch`.

A check that fails is not "you are up to date". That sentence is reserved for
a manifest that says this version is current. A failed automatic check does
not raise the offer; the row in Settings says it could not check, and a later
timer tries again.
