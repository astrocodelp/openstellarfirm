# Releasing StellarFirm Open

GitHub Actions is blocked for this organization, so releases are built on a
short-lived Fly Machine (Linux and Windows) and on a maintainer's Mac (macOS).
A release is only ever built from a tag in the public repository. What is built
is what anyone can read.

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
7. Publish the release by hand. No script ever publishes.

Scripts refuse to overwrite an asset that already exists on the draft. To redo a
build, delete the bad asset on GitHub first.

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
with an empty environment and never sees the app's secrets. Release builds are
different: they run with the secrets, so they are only ever started for a tag a
maintainer pushed.

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
