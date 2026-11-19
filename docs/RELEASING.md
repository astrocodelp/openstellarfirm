# Releasing OpenStellarFirm

OpenStellarFirm is the open-source sibling of StellarFirm, by Astro Code.
The GitHub repository name stays `worker-bot-open-source`.

GitHub Actions is blocked for this organization, so releases are built on a
short-lived Fly Machine (Linux and Windows) and on a maintainer's Mac (macOS).
A release is only ever built from a tag in the public repository. What is built
is what anyone can read.

The installers are named `OpenStellarFirm-<version>-<os>-<arch>.<ext>`.
OpenStellarFirm is licensed under the Apache License 2.0 with the Commons
Clause (see [LICENSE](../LICENSE) and [NOTICE](../NOTICE)): free to use,
change and share, not to sell.

## The steps, in order

1. Bump `version` in `package.json`. Commit it on `main`.
2. Create the tag, for example `v0.1.0`. It must match `package.json` exactly.
3. Push the tag: `git push origin v0.1.0`.
4. Run the Linux and Windows build on Fly:
   `FLY_API_TOKEN=... scripts/release/fly-run.sh v0.1.0`
   It starts one Machine, waits for it to stop and tells you where the logs are.
   The Machine runs the checks, builds, writes `SHA256SUMS.txt` and uploads
   everything to a draft release.
5. On a Mac, check out the tag and run the macOS build:
   `GITHUB_TOKEN=... scripts/release/mac.sh v0.1.0`
   It writes `SHA256SUMS-mac.txt` and uploads to the same draft.
6. Open the draft release on GitHub. Check that all files are there, that the
   sizes make sense, and that the sums match: `sha256sum -c SHA256SUMS.txt`.
7. Publish the release by hand. The scripts never publish.

Scripts refuse to overwrite an asset that already exists on the draft. To redo a
build, delete the bad asset on GitHub first.

Use one path for a tag. These steps are the path while GitHub Actions cannot
start. The workflow below publishes on its own, so do not also run the scripts
for a tag the workflow is publishing. If the release is already published, the
scripts refuse to touch it.

## Environment variables

| Variable                                                | Where it is set                                                                    | What it is for                                                                                                |
| ------------------------------------------------------- | ---------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------- |
| `FLY_API_TOKEN`                                         | Maintainer's shell                                                                 | Lets `fly-run.sh` start and watch a Machine. Sent only in a header.                                           |
| `FLY_APP`                                               | Maintainer's shell (optional)                                                      | Fly app to run in. Default `stellarfirm-actions`.                                                             |
| `FLY_REGION`                                            | Maintainer's shell (optional)                                                      | Region. Default `ams`.                                                                                        |
| `GITHUB_TOKEN`                                          | Fly app secret (Linux/Windows) and maintainer's shell (Mac)                        | Creates the draft release and uploads assets. Needs write access to releases. Without it nothing is uploaded. |
| `GITHUB_REPO`                                           | Optional                                                                           | Repository for `upload.sh`. Default `astrocodelp/worker-bot-open-source`.                                     |
| `RELEASE_REF`                                           | Set by `fly-run.sh` on the Machine; maintainer's shell for `mac.sh` if no argument | The tag to build.                                                                                             |
| `WIN_CSC_LINK`, `WIN_CSC_KEY_PASSWORD`                  | Fly app secrets (optional)                                                         | Windows code signing certificate and its password. Both or neither. Not set today.                            |
| `CSC_LINK`, `CSC_KEY_PASSWORD`                          | Maintainer's shell (optional)                                                      | macOS Developer ID certificate (file or base64) and password.                                                 |
| `CSC_NAME`                                              | Maintainer's shell (optional)                                                      | Alternative to `CSC_LINK`: a Developer ID identity already in the keychain.                                   |
| `APPLE_API_KEY`, `APPLE_API_KEY_ID`, `APPLE_API_ISSUER` | Maintainer's shell (optional)                                                      | App Store Connect API key (path to the `.p8`), its id and issuer, for notarization. All or none.              |

Set Fly app secrets with Fly's dashboard or CLI. Every Machine of the app
receives them as environment variables. They are never put in the Machine's
command, in a file in this repository, or in a log line.

## Running the checks without GitHub Actions

Locally or in any container: `scripts/ci.sh` (or `pnpm ci`). It runs install with
the frozen lockfile, lint, typecheck, test and build.

On Fly, at a branch, tag or full commit hash:

`FLY_API_TOKEN=... scripts/release/fly-run.sh --checks main`

This starts a small Machine on the plain `node:22-bookworm` image that fetches
that ref and runs `scripts/ci.sh`. Read the result in the Machine's logs.
A short commit hash will not work, because Git cannot fetch one by name.

The ref can be someone else's pull request (`refs/pull/<number>/head`), so the
checked code is treated as untrusted: it runs as the unprivileged `node` user
with an empty environment, in a Machine started without the app's secrets.
Release builds are
different: they run with the secrets, so they are only ever started for a tag a
maintainer pushed.

Every Machine of a Fly app receives all of that app's secrets. Keep the release
secrets in a Fly app of their own (set `FLY_APP`), not in an app that holds
other projects' secrets, so a release build can only ever see its own.

## GitHub Actions

[`.github/workflows/release.yml`](../.github/workflows/release.yml) runs when
someone pushes a tag, and from the Actions tab. It does not run on a pull
request. The parse and publish jobs use the org's self-hosted Fly runners
(`self-hosted`, `fly`, `linux`, `x64`), and those must not build code from a
fork.

| Tag                                       | What the workflow publishes                             |
| ----------------------------------------- | ------------------------------------------------------- |
| `vX.Y.Z` (for example `v0.1.0`)           | A stable release, marked as the latest                  |
| `vX.Y.Z-rc.N` (for example `v0.1.0-rc.1`) | A release candidate, as a prerelease, not marked latest |

The workflow writes the tag's version into `package.json` before it builds,
so a release candidate does not need a version bump first. The Fly and Mac
scripts still require the tag to match `package.json` exactly.

A manual run (**Release**, **Run workflow**) builds installers versioned
`0.0.0-dev.<run number>` and keeps them as workflow artifacts. It publishes
nothing. Tick **sign** to try the signing secrets. That run fails, and names
the missing secrets, when the set is not complete.

| File                                                 | Runner           |
| ---------------------------------------------------- | ---------------- |
| `OpenStellarFirm-<version>-mac-x64.dmg` and `.zip`   | `macos-15-intel` |
| `OpenStellarFirm-<version>-mac-arm64.dmg` and `.zip` | `macos-15`       |
| `OpenStellarFirm-<version>-win-x64.exe`              | `windows-latest` |

Linux (AppImage and tar.gz) stays on the Fly script. A macOS disk image
cannot be made on Linux, and Windows signing in this workflow runs on
Windows. Parse and publish stay on the Fly runners.

`macos-15-intel` is a larger runner. It starts only after the org's GitHub
Actions billing is fixed. The Fly jobs do not use Actions minutes. They
start only when the Fly runner group is allowed to serve this public
repository (org **Settings → Actions → Runner groups**). The pinned actions
run on Node 24, so the Fly runners need Actions Runner 2.327.1 or newer.

Signing in the workflow is optional, and a tag publishes either way. When a
platform's values are all absent, that installer is unsigned, the release
title ends with `(unsigned)`, and the notes say so. A half-filled set fails
the job and names what is missing. Mac and Windows are decided separately.

The workflow reads GitHub Actions secrets, not Fly app secrets. macOS uses
`CSC_LINK` and `CSC_KEY_PASSWORD`, plus either `APPLE_API_KEY` (the text of
the `.p8`), `APPLE_API_KEY_ID` and `APPLE_API_ISSUER`, or `APPLE_ID`,
`APPLE_APP_SPECIFIC_PASSWORD` and `APPLE_TEAM_ID`. Windows uses Azure Trusted
Signing (`AZURE_TENANT_ID`, `AZURE_CLIENT_ID`, `AZURE_CLIENT_SECRET`, and the
variables `AZURE_TRUSTED_SIGNING_ENDPOINT`, `AZURE_TRUSTED_SIGNING_ACCOUNT`,
`AZURE_TRUSTED_SIGNING_PROFILE`, `AZURE_TRUSTED_SIGNING_PUBLISHER`) or, when
every Azure value is empty, `WIN_CSC_LINK` and `WIN_CSC_KEY_PASSWORD`. On the
Mac script, `APPLE_API_KEY` is a path to the `.p8`. In the workflow it is the
key text, and the workflow writes that text to a temporary file.

The Release is created on this repository with the workflow's own
`GITHUB_TOKEN`. No other token is required. Signed builds are still
[issue 4](https://github.com/astrocodelp/worker-bot-open-source/issues/4).

The workflow builds the commit the tag points at. Re-running a run builds
that same commit again. If the fix landed after the tag, push the next
release candidate from the fixed commit.

From a machine for that system, after `pnpm install`:

```bash
pnpm package:mac-x64
pnpm package:mac-arm64
pnpm package:win
pnpm package:linux
```

The files land in `release/` (gitignored). The scripts pass `--publish never`,
so a local build cannot open a GitHub Release.

## What is not done yet

- **Signing.** Builds are unsigned until certificates exist. macOS needs an Apple
  Developer ID and an App Store Connect API key. Windows needs a code signing
  certificate. The scripts sign automatically when the variables above are set
  and say "unsigned" in one line when they are not. The GitHub Actions release
  says `(unsigned)` in its title when any installer is unsigned. Unsigned apps
  show warnings on first run. Signed releases are
  [issue 4](https://github.com/astrocodelp/worker-bot-open-source/issues/4).
- **deb and rpm.** They need a maintainer email address the project has not
  chosen. Only AppImage and tar.gz are built for Linux.
- **Auto-update.** Not built. People download new versions by hand.
- **Linux arm64 and Windows arm64.** Only x64 is built.
