# Releasing OpenStellarFirm

OpenStellarFirm is the source-available sibling of StellarFirm, by Astro Code:
its code is open to read, change and share, not to sell. The GitHub repository
is `astrocodelp/openstellarfirm`. Its address lives in one place,
`repository` in `package.json`; the release scripts read it from there, and a
test holds the app's links (`src/shared/links.ts`) to it.

There are two ways to build a release, and each tag uses **one** of them:

- **The scripts** (`scripts/release/`): a short-lived Fly Machine builds Linux
  and Windows and a maintainer's Mac builds macOS. Everything goes to one
  **draft** release that a person publishes by hand. This is the way the
  steps below describe, and the way for the first public release.
- **The workflow** ([GitHub Actions](#github-actions)): a tag push builds macOS
  and Windows on GitHub's runners and **publishes** the release. It is for when
  GitHub Actions is allowed for this organization. It does not build Linux.

Do not run both for the same tag: the scripts make a draft and the workflow
publishes one, and they upload files with the same names. A release is only
ever built from a tag in the public repository. What is built is what anyone
can read.

## Before the first public release

- [ ] **Signing.** Signed and notarized builds are the goal (see
      [What is not done yet](#what-is-not-done-yet)). **An unsigned build must
      not be the public launch build.** Publish an unsigned build only as a
      clearly labelled pre-release for testers, with the README's
      [Install a release](../README.md#install-a-release) steps and the sums
      in the notes. For the launch, set the signing variables listed in
      [Environment variables](#environment-variables): `WIN_CSC_LINK` and
      `WIN_CSC_KEY_PASSWORD` for Windows, `CSC_LINK` and `CSC_KEY_PASSWORD` (or
      `CSC_NAME`) plus `APPLE_API_KEY`, `APPLE_API_KEY_ID` and
      `APPLE_API_ISSUER` for macOS.
- [x] **A screenshot.** Add `docs/screenshot.png` (the app with an assistant
      and a short chat, light or dark, no personal data in it) and replace the
      `<!-- screenshot: docs/screenshot.png -->` line near the top of the README
      with the image.
- [ ] **The smoke test** below passes on every system.

## The steps, in order (the scripts)

1. **Version.** `version` in `package.json` must be the version you release.
   If it already matches (0.1.0 does), skip this step. Otherwise change it and
   commit it on `main`.
2. **Changelog.** In `CHANGELOG.md`, rename `## [Unreleased]` to
   `## [0.1.0] - YYYY-MM-DD` (today's date), take out the line "There is no
   tagged release yet", start a new empty `## [Unreleased]` above it, and add
   the compare links at the end of the file:

   ```markdown
   [Unreleased]: https://github.com/astrocodelp/openstellarfirm/compare/v0.1.0...HEAD
   [0.1.0]: https://github.com/astrocodelp/openstellarfirm/releases/tag/v0.1.0
   ```

   For a later release, the new version's link compares with the one before
   (`compare/v0.1.0...v0.2.0`). Commit it on `main`.
3. Create the tag, for example `v0.1.0`. It must match `package.json` exactly.
4. Push the tag: `git push origin v0.1.0`.
5. Run the Linux and Windows build on Fly:
   `FLY_API_TOKEN=... FLY_APP=... scripts/release/fly-run.sh v0.1.0`
   It starts one Machine, waits for it to stop and tells you where the logs are.
   The Machine runs the checks, builds, writes `SHA256SUMS.txt` and uploads
   everything to a draft release. A new draft starts with the notes in
   [release-notes-template.md](release-notes-template.md), with the version
   filled in.
6. On a Mac, check out the tag and run the macOS build:
   `GITHUB_TOKEN=... scripts/release/mac.sh v0.1.0`
   It writes `SHA256SUMS-mac.txt` and uploads to the same draft.
7. Open the draft release on GitHub. Check that all files are there and that
   the sizes make sense. Download them and check the sums: on Linux
   `sha256sum -c SHA256SUMS.txt`, on a Mac `shasum -a 256 -c SHA256SUMS-mac.txt`
   (and `shasum -a 256 -c SHA256SUMS.txt` for the Linux and Windows files).
8. **Smoke test.** Install each file on a clean machine or virtual machine,
   one that has never run the app: macOS on Apple silicon (and Intel if you
   can), Windows 10 or 11, and a Linux desktop such as Ubuntu LTS. On each:
   open it the way the README says (Open Anyway, More info then Run anyway,
   `chmod +x` for the AppImage), get past the first run with a model (Ollama,
   or a key), make an assistant, send a message and see the answer stream, and
   open Settings, Updates and About, and its licences. On Linux, save a key, to check the
   keyring. Anything wrong: delete the draft's files, fix it, and tag again.
9. Write the highlights in the draft's notes, from the changelog.
10. Publish the release by hand. No script ever publishes.

Scripts refuse to overwrite an asset that already exists on the draft. To redo a
build, delete the bad asset on GitHub first.

## Environment variables

| Variable                                                | Where it is set                                                                    | What it is for                                                                                                |
| ------------------------------------------------------- | ---------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------- |
| `FLY_API_TOKEN`                                         | Maintainer's shell                                                                 | Lets `fly-run.sh` start and watch a Machine. Sent only in a header.                                           |
| `FLY_APP`                                               | Maintainer's shell (required)                                                      | Fly app to run in: one that holds this project's release secrets and nothing else. There is no default.       |
| `FLY_REGION`                                            | Maintainer's shell (optional)                                                      | Region. Default `ams`.                                                                                        |
| `GITHUB_TOKEN`                                          | Fly app secret (Linux/Windows) and maintainer's shell (Mac)                        | Creates the draft release and uploads assets. Needs write access to releases. Without it nothing is uploaded. |
| `GITHUB_REPO`                                           | Optional                                                                           | Repository for `upload.sh`, as owner/name. Default: `repository` in `package.json`.                           |
| `RELEASE_REF`                                           | Set by `fly-run.sh` on the Machine; maintainer's shell for `mac.sh` if no argument | The tag to build.                                                                                             |
| `RELEASE_REPO`                                          | Set by `fly-run.sh` on the Machine, from `package.json`                            | The repository the Machine clones.                                                                            |
| `WIN_CSC_LINK`, `WIN_CSC_KEY_PASSWORD`                  | Fly app secrets (optional)                                                         | Windows code signing certificate and its password. Both or neither. Not set today.                            |
| `CSC_LINK`, `CSC_KEY_PASSWORD`                          | Maintainer's shell (optional)                                                      | macOS Developer ID certificate (file or base64) and password.                                                 |
| `CSC_NAME`                                              | Maintainer's shell (optional)                                                      | Alternative to `CSC_LINK`: a Developer ID identity already in the keychain.                                   |
| `APPLE_API_KEY`, `APPLE_API_KEY_ID`, `APPLE_API_ISSUER` | Maintainer's shell (optional)                                                      | App Store Connect API key (path to the `.p8`), its id and issuer, for notarization. All or none.              |

The scripts keep these secrets away from install, lint, test and build code:
`ci.sh` runs with none of them, `electron-builder` gets only the signing
variables (never `GITHUB_TOKEN`), and the token goes to `upload.sh` alone. The
upload also writes the checksums into the draft's notes, so a download can be
checked against the notes as well as against the `SHA256SUMS` assets.

Set Fly app secrets with Fly's dashboard or CLI. Every Machine of the app
receives them as environment variables. They are never put in the Machine's
command, in a file in this repository, or in a log line.

## Running the checks without GitHub Actions

Locally or in any container: `scripts/ci.sh` (or `pnpm ci`). It runs install with
the frozen lockfile, lint, typecheck, test and build.

On Fly, at a branch, tag or full commit hash:

`FLY_API_TOKEN=... FLY_APP=... scripts/release/fly-run.sh --checks main`

This starts a small Machine on the plain `node:22-bookworm` image that fetches
that ref and runs `scripts/ci.sh`. Read the result in the Machine's logs.

Both images are pinned by digest in `fly-run.sh` (looked up on 2026-11-19), so
a build runs on exactly the image that was checked: `node:22-bookworm` for the
checks and `electronuserland/builder:wine` for releases. To move to a newer
image, read its digest with `docker buildx imagetools inspect <image>`, and
change it and the date in `fly-run.sh`.
A short commit hash will not work, because Git cannot fetch one by name.

The ref can be someone else's pull request (`refs/pull/<number>/head`), so the
checked code is treated as untrusted: it runs as the unprivileged `node` user
with an empty environment, in a Machine started without the app's secrets.
Release builds are
different: they run with the secrets, so they are only ever started for a tag a
maintainer pushed.

Every Machine of a Fly app receives all of that app's secrets. Keep the release
secrets in a Fly app of their own, not in an app that holds other projects'
secrets, so a release build can only ever see its own. That is why `FLY_APP`
has no default: name that app every time, for example
`openstellarfirm-release`.

## GitHub Actions

[`.github/workflows/release.yml`](../.github/workflows/release.yml) runs when
someone pushes a tag, and from the Actions tab. It does not run on a pull
request. The parse and publish jobs use the org's self-hosted Fly runners
(`self-hosted`, `fly`, `linux`, `x64`), and those must not build code from a
fork. This is the second way to release, beside the scripts above: use one
per tag.

| Tag                                       | What the workflow publishes                             |
| ----------------------------------------- | ------------------------------------------------------- |
| `vX.Y.Z` (for example `v0.1.0`)           | A stable release, marked as the latest                  |
| `vX.Y.Z-rc.N` (for example `v0.1.0-rc.1`) | A release candidate, as a prerelease, not marked latest |

**The workflow publishes, it does not leave a draft.** For the first public
release, or any release you want to smoke-test before anyone can download it,
use the scripts (they stop at a draft), or push a `-rc.N` tag. Never push a
`vX.Y.Z` tag to the workflow before the points in
[Before the first public release](#before-the-first-public-release) are done.

The workflow writes the tag's version into `package.json` before it packages,
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
| `SHA256SUMS.txt`                                     | the publish job  |

Linux (AppImage and tar.gz) is not built by the workflow: it stays on the Fly
script, because a macOS disk image cannot be made on Linux and Windows signing
here runs on Windows. Parse and publish stay on the
Fly runners. The release notes the workflow writes say that Linux comes from
the scripts.

`macos-15-intel` is a larger runner. It starts only after the org's GitHub
Actions billing is fixed. The Fly jobs do not use Actions minutes. They
start only when the Fly runner group is allowed to serve this public
repository (org **Settings, Actions, Runner groups**). The pinned actions
run on Node 24, so the Fly runners need Actions Runner 2.327.1 or newer.

### Secrets in the workflow

The workflow keeps the same rules as the scripts. Each build job runs, in
order:

1. **Checks** (`scripts/ci.sh`: install, lint, typecheck, test, build). The
   step has no `env` at all, so install and build code never sees a signing
   value or a token.
2. **Stamp** the version from the tag. No secrets.
3. **Decide signing**. It is told only whether each secret is set (the word
   `set`), never its value, and writes `electron-builder.signed.json` (names
   and the Azure variables, no secret) and a signing status file.
4. **Package**. The only step that holds signing values, and only when signing
   is on for that platform. It runs `electron-builder` alone (the app was
   built in Checks), never a package script, and has no `GITHUB_TOKEN`.

Only the **publish** job has `contents: write`. It downloads the installers,
writes `SHA256SUMS.txt` and the release notes (which list the same sums, like
`upload.sh`), and creates the Release with the job's `GITHUB_TOKEN`. No other
token is needed.

Signing in the workflow is optional, and a tag publishes either way. When a
platform's values are all absent, that installer is unsigned, the release
title ends with `(unsigned)`, and the notes say so. A half-filled set fails
the job and names what is missing. Mac and Windows are decided separately.
An unsigned build must still not be the public launch build.

The workflow reads GitHub Actions secrets, not Fly app secrets. macOS uses
`CSC_LINK` and `CSC_KEY_PASSWORD`, plus either `APPLE_API_KEY` (the text of
the `.p8`), `APPLE_API_KEY_ID` and `APPLE_API_ISSUER`, or `APPLE_ID`,
`APPLE_APP_SPECIFIC_PASSWORD` and `APPLE_TEAM_ID`. Windows uses Azure Trusted
Signing (`AZURE_TENANT_ID`, `AZURE_CLIENT_ID`, `AZURE_CLIENT_SECRET`, and the
variables `AZURE_TRUSTED_SIGNING_ENDPOINT`, `AZURE_TRUSTED_SIGNING_ACCOUNT`,
`AZURE_TRUSTED_SIGNING_PROFILE`, `AZURE_TRUSTED_SIGNING_PUBLISHER`) or, when
every Azure value is empty, `WIN_CSC_LINK` and `WIN_CSC_KEY_PASSWORD`. On the
Mac script, `APPLE_API_KEY` is a path to the `.p8`. In the workflow it is the
key text, and the Package step writes that text to a temporary file (mode
0600, removed when the step ends).

The workflow builds the commit the tag points at. Re-running a run builds
that same commit again. If the fix landed after the tag, push the next
release candidate from the fixed commit.

## Building on your own machine

From a machine for that system, after `pnpm install`:

```bash
pnpm package:mac     # both Mac architectures, unsigned
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
  show warnings on first run.
- **deb and rpm.** They need a maintainer email address the project has not
  chosen. Only AppImage and tar.gz are built for Linux.
- **Auto-update.** Not built. People download new versions by hand.
- **Linux arm64 and Windows arm64.** Only x64 is built.
