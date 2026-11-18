# Security

## Reporting a problem

Please report a security problem privately, not in a public issue: use
GitHub's "Report a vulnerability" on this repository's Security tab.

Useful to include: what you did, what happened, what you expected, and the
app's version and operating system. Please do not include a real key.

## What the app is trusted with

- **Your model keys.** Sealed with the operating system's keychain before they
  touch the disk, read only in the main process, sent only as a bearer header
  to the address they were saved with. Never sent to the page, never logged.
- **Your chats and assistants.** Plain JSON in the app's data folder, readable
  only by your user account.
- **The folders you pick** for an assistant, and **the websites you allow**.

## Where untrusted text comes from

| Source                                | How it is treated                                                                                                                                                  |
| ------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| A model's output                      | Shown as plain text, never as HTML. Its tool calls are checked by code before anything runs.                                                                       |
| A file or web page an assistant reads | Given to the model marked as information, not instructions. It can still mislead a model, which is why the rules below are enforced in code and not in the prompt. |
| An imported assistant file            | Checked field by field. It never brings a key, a model, a folder, a site or web access with it.                                                                    |
| A model service's answers and errors  | A redirect is an error. An error is shown as a short plain line with the key taken out.                                                                            |
| The page                              | Sandboxed, isolated, under a strict Content Security Policy. It reaches the main process only through one typed bridge, and every call is checked there.           |

## The rules the code enforces

- **Folders.** Only the system's own folder picker, opened by the main process,
  can give an assistant a folder. Every path is checked after links are
  followed. A file that can hold keys or passwords (`.env`, `.ssh`, `*.pem`,
  ...) is never listed, read or written. There is no code that changes,
  replaces, moves or deletes a file: the only write makes a new file and fails
  if the name is taken.
- **Web pages.** https only, the standard port, public addresses only. The
  name is resolved first, every address it resolves to must be public, and the
  connection is made to that checked address. A redirect to another site is
  not followed.
- **Approvals.** Reading a site for the first time waits for your Approve.
  "Always allow" remembers one site for one assistant. Even an allowed site
  asks again when the address carries text after a `?`, and for the rest of an
  answer once the assistant has read from your folders in it, because an
  address can carry text out. Nothing in the app answers an approval for you.
- **StellarFirm links.** The only links the app opens are to stellarfirm.ai,
  built in the main process from fixed parts, on your click. "Copy to
  StellarFirm cloud" carries an assistant's name, look and brief after the `#`
  of the address, which a browser does not send to a server.
- **The installed app.** It cannot be run as plain Node, started with an
  inspector, pointed at another page by an environment variable, or driven
  through a debugging port.

## Known limits

Said plainly, so nobody relies on more than is there:

- **What an assistant reads goes to the model you chose.** With a hosted key,
  that provider receives your messages and anything the assistant read from
  your folders. With a model on this computer, it stays here.
- **Prompt injection is reduced, not solved.** A page or file can still talk a
  model into a bad answer, or into asking you for a web read whose address
  holds something private. The card shows the full address: read it.
- **Earlier answers stay in the chat.** If an assistant quoted a file in an
  earlier answer, a later web read on an allowed site does not ask again.
- **Another program running as you** can read the app's data folder and your
  files anyway. The app does not defend against that.
- **Keys on Linux** depend on the desktop's secret store; the app is built for
  macOS and Windows.
- **No signed installers yet.** Build from source, or wait for signed releases.
- **The file protocol keeps its extra privileges** in the packaged app, because
  the page is loaded from a file. Serving it from a protocol of the app's own
  would let that go off.

## Dependencies

Nothing from `node_modules` ships in the app: the code is bundled, and every
dependency is a build tool. Install scripts are blocked except for `electron`
and `esbuild` (`pnpm.onlyBuiltDependencies`).

`pnpm audit` on 18 November 2026 reports three advisories, all in the
packaging tool's own dependencies, none in code that ships or that reads
untrusted input:

| Advisory                                  | Package                             | Why it is deferred                                                                                                                    |
| ----------------------------------------- | ----------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------- |
| GHSA-fc5q-39xc-vjpf (high)                | `picomatch`, via `electron-builder` | No fixed version exists yet. It is a slow-pattern problem in a glob matcher that only ever sees this repository's own build patterns. |
| GHSA-g3hv-75wg-m249 (moderate, two paths) | `minimatch`, via `electron-builder` | Fixed only in a new major version that `electron-builder` does not use yet. Same reason: build patterns only.                         |

Review date: 18 December 2026, or when `electron-builder` updates, whichever
comes first.
