# Cut a release

Pushing a version tag builds the macOS and Windows installers and attaches
them to a GitHub Release on this repository. The workflow is
[`.github/workflows/release.yml`](../.github/workflows/release.yml). Do not
push a tag unless you mean to publish that cut.

The installer version comes from the tag. You do not need to bump
`package.json` first.

## Tag

| Tag                                       | What it publishes                                       |
| ----------------------------------------- | ------------------------------------------------------- |
| `vX.Y.Z` (for example `v0.1.0`)           | A stable release, marked as the latest                  |
| `vX.Y.Z-rc.N` (for example `v0.1.0-rc.1`) | A release candidate, as a prerelease, not marked latest |

```bash
git tag v0.1.0
git push origin v0.1.0
```

A manual run from the Actions tab (**Release**, **Run workflow**) builds
installers versioned `0.0.0-dev.<run number>` and keeps them as workflow
artifacts. It publishes nothing. Tick **sign** to try the signing secrets
first. That run fails, and names the missing secrets, when the set is not
complete.

The workflow does not run on a pull request. The parse and publish jobs use
the org's self-hosted runners, and those must not build code from a fork.

## What gets built

| File                                                  | Runner           |
| ----------------------------------------------------- | ---------------- |
| `StellarFirm-Open-<version>-mac-x64.dmg` and `.zip`   | `macos-15-intel` |
| `StellarFirm-Open-<version>-mac-arm64.dmg` and `.zip` | `macos-15`       |
| `StellarFirm-Open-<version>-win-x64.exe`              | `windows-latest` |

Linux is not part of the release. Parse and publish run on the org's Fly
runners (`self-hosted`, `fly`, `linux`, `x64`). The installers are built on
GitHub-hosted macOS and Windows, because a macOS disk image cannot be made
on Linux and Windows signing runs on Windows.

`macos-15-intel` is a larger runner. A run that never starts because recent
account payments have failed, or the spending limit needs to be raised, needs
the org's GitHub Actions billing fixed first. The Fly jobs do not use GitHub
Actions minutes. They start only when the Fly runner group is allowed to
serve this public repository (org **Settings → Actions → Runner groups**).

The actions are pinned to releases that run on Node 24, the same line as
[`.github/workflows/ci.yml`](../.github/workflows/ci.yml). The Fly runners
need Actions Runner 2.327.1 or newer.

## Signing

Signing is optional. A tag publishes either way.

- When a platform's signing values are all absent, that installer is
  unsigned. If any installer is unsigned, the release title ends with
  `(unsigned)` and the notes say so. Gatekeeper and SmartScreen will warn.
- When a set is only partly filled, the build fails and names the missing
  values. A typo cannot publish an unsigned build that was meant to be signed.
- A manual run stays unsigned unless **sign** is ticked.

Signed releases are the plan in
[issue 4](https://github.com/astrocodelp/worker-bot-open-source/issues/4).
Add the values below in **Settings → Secrets and variables → Actions**.
Names only. Never commit a value.

### macOS

| Name               | What it is                                                                                 |
| ------------------ | ------------------------------------------------------------------------------------------ |
| `CSC_LINK`         | Developer ID Application certificate and its private key, as a base64 `.p12`               |
| `CSC_KEY_PASSWORD` | Password set when exporting the `.p12`                                                     |
| `APPLE_API_KEY`    | Text of the App Store Connect API key `AuthKey_<id>.p8`, including the BEGIN and END lines |
| `APPLE_API_KEY_ID` | The key's id                                                                               |
| `APPLE_API_ISSUER` | The issuer id                                                                              |

Instead of the API key, notarisation can use `APPLE_ID`,
`APPLE_APP_SPECIFIC_PASSWORD`, and `APPLE_TEAM_ID`. Fill one set or the
other. A half-filled set fails the build.

### Windows

Azure Trusted Signing (primary). The three credentials are secrets. The
account names are variables.

| Name                              | Kind     |
| --------------------------------- | -------- |
| `AZURE_TENANT_ID`                 | secret   |
| `AZURE_CLIENT_ID`                 | secret   |
| `AZURE_CLIENT_SECRET`             | secret   |
| `AZURE_TRUSTED_SIGNING_ENDPOINT`  | variable |
| `AZURE_TRUSTED_SIGNING_ACCOUNT`   | variable |
| `AZURE_TRUSTED_SIGNING_PROFILE`   | variable |
| `AZURE_TRUSTED_SIGNING_PUBLISHER` | variable |

Or a `.pfx`, used only when every `AZURE_*` value is empty: `WIN_CSC_LINK`
(base64 `.pfx`) and `WIN_CSC_KEY_PASSWORD`.

Mac and Windows are decided separately. One can be signed while the other is
still unsigned, and the release notes say which.

## One-time setup

1. Allow the Fly runner group to serve this public repository.
2. Unlock GitHub Actions billing for the org, so the macOS and Windows jobs
   can start. `macos-15-intel` needs the larger macOS runner.
3. Update the Fly runners to 2.327.1 or newer, so the pinned Node 24 actions
   can run.
4. Leave the signing secrets unset until the certificates exist. The first
   tag can ship unsigned, and the release will say so.

No token besides the workflow's own `GITHUB_TOKEN` is required. The Release
is created on this repository.

## If a run fails

The workflow builds the commit the tag points at. Re-running a run builds
that same commit again. If the fix landed after the tag, push the next
release candidate (for example `v0.1.0-rc.2`) from the fixed commit. If the
release was created and the file upload failed, delete those assets on the
release page and re-run.

## Local packaging

From a machine for that system, after `pnpm install`:

```bash
pnpm package:mac-x64
pnpm package:mac-arm64
pnpm package:win
```

The files land in `release/` (gitignored). The scripts pass `--publish never`,
so a local build cannot open a GitHub Release. A local macOS build signs only
when a certificate is already available. `CSC_IDENTITY_AUTO_DISCOVERY=false`
forces it to stay unsigned.
