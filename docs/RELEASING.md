# Releasing OpenStellarFirm

OpenStellarFirm is the source-available sibling of StellarFirm, by Astro Code:
its code is open to read, change and share, not to sell. The GitHub repository
name stays `worker-bot-open-source` for now. Its address lives in one place,
`repository` in `package.json`; the release scripts read it from there, and a
test holds the app's links (`src/shared/links.ts`) to it.

GitHub Actions is blocked for this organization, so releases are built on a
short-lived Fly Machine (Linux and Windows) and on a maintainer's Mac (macOS).
A release is only ever built from a tag in the public repository. What is built
is what anyone can read.

## Before the first public release

- [ ] **Signing.** Signed and notarized builds are the goal (see
      [What is not done yet](#what-is-not-done-yet)). An unsigned v0.1.0 is
      allowed only because the README's
      [Install a release](../README.md#install-a-release) section and the
      release notes say how to open it and check its sums.
- [ ] **A screenshot.** Add `docs/screenshot.png` (the app with an assistant
      and a short chat, light or dark, no personal data in it) and replace the
      `<!-- screenshot: docs/screenshot.png -->` line near the top of the README
      with the image.
- [ ] **The smoke test** below passes on every system.

## The steps, in order

1. **Version.** `version` in `package.json` must be the version you release.
   If it already matches (0.1.0 does), skip this step. Otherwise change it and
   commit it on `main`.
2. **Changelog.** In `CHANGELOG.md`, rename `## [Unreleased]` to
   `## [0.1.0] - YYYY-MM-DD` (today's date), take out the line "There is no
   tagged release yet", start a new empty `## [Unreleased]` above it, and add
   the compare links at the end of the file:

   ```markdown
   [Unreleased]: https://github.com/astrocodelp/worker-bot-open-source/compare/v0.1.0...HEAD
   [0.1.0]: https://github.com/astrocodelp/worker-bot-open-source/releases/tag/v0.1.0
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
   open Settings, About, and its licences. On Linux, save a key, to check the
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

## What is not done yet

- **Signing.** Builds are unsigned until certificates exist. macOS needs an Apple
  Developer ID and an App Store Connect API key. Windows needs a code signing
  certificate. The scripts sign automatically when the variables above are set
  and say "unsigned" in one line when they are not. Unsigned apps show warnings
  on first run.
- **deb and rpm.** They need a maintainer email address the project has not
  chosen. Only AppImage and tar.gz are built for Linux.
- **Auto-update.** Not built. People download new versions by hand.
- **Linux arm64 and Windows arm64.** Only x64 is built.
