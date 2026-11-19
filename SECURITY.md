# Security

## Reporting a problem

Please report a security problem privately, not in a public issue: use
GitHub's "Report a vulnerability" on this repository's Security tab.

Useful to include: what you did, what happened, what you expected, and the
app's version and operating system. Please do not include a real key.

## What the app is trusted with

- **Your model keys and connection keys.** Sealed with the operating system's
  keychain before they touch the disk, read only in the main process, sent
  only in a request header (`Authorization`, `x-api-key`, `x-goog-api-key` or
  `api-key`)
  to the address they were saved with. Never in a web address, never sent to
  the page, never logged.
- **Your chats and assistants.** Plain JSON in the app's data folder, readable
  only by your user account.
- **The folders you pick** for an assistant, **the websites you allow**, **the
  connections you add**, and, when you turn it on and approve each look,
  **what is on your screen**.

## Where untrusted text comes from

| Source                                            | How it is treated                                                                                                                                                                                                                                                              |
| ------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| A model's output                                  | Shown as plain text, never as HTML. Its tool calls are checked by code before anything runs.                                                                                                                                                                                   |
| A tool request a model writes as text             | Some models cannot call tools, so they ask in writing. Only the model's own output of the current turn is read for that, strictly, and every request goes through the same checks and approvals as a native tool call. Text in a file or page is never read as a tool request. |
| A file or web page an assistant reads             | Given to the model marked as information, not instructions. It can still mislead a model, which is why the rules below are enforced in code and not in the prompt.                                                                                                             |
| A connection (MCP server)                         | Everything it sends is checked: tool names, descriptions and schemas are validated and cut, answers are capped, and results reach the model marked as information.                                                                                                             |
| A mail message                                    | Written by other people, so it is information, never instructions. Turned to plain text; nothing it links to is fetched.                                                                                                                                                       |
| Another assistant's answer                        | Reaches the asker's model marked as information, not instructions.                                                                                                                                                                                                             |
| A picture of the screen                           | Reaches the model as information. The prompt says text in it is never an instruction.                                                                                                                                                                                          |
| A company's published file (`poppy.json`)         | Read strictly, every text cut and cleaned, shown as plain text. Only a web address and a name are ever copied into a form you review.                                                                                                                                          |
| An imported assistant file, a backup or a persona | Checked field by field. It never brings a key, a model, a folder, a site, a connection, web access or screen access with it. A backup only adds new assistants and never changes or removes one you have. Chats in it come in as plain text.                                   |
| A model service's answers and errors              | A redirect is an error. An error is shown as a short plain line with the key taken out.                                                                                                                                                                                        |
| The page                                          | Sandboxed, isolated, under a strict Content Security Policy. It reaches the main process only through one typed bridge, and every call is checked there.                                                                                                                       |

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
- **Connections.** Made only from a web address you typed (https, or http on
  this computer). The app never starts a program for one. A redirect is an
  error; an answer is capped at 2 MB and a request at 30 seconds; at most 20
  connections, each with a name of its own, and 40 tools each. Which assistants may use a connection is set
  only by you.
- **Direct connections.** A catalog of services that run their own remote
  tool server and take a key you make there. Each entry has one fixed address
  and one fixed way to send the key (an `Authorization: Bearer` or `x-api-key`
  header), set in the main process and again on every call. The page, a file, a
  backup, a persona or the server cannot change them. A key is sent only to the
  address of the connection it was saved for.
- **Composio.** An optional preset of a connection. It uses your own Composio
  key, sent only to Composio's one fixed address in Composio's own header. The
  address and the header are set in the main process, never by the page, a
  file or a server. Its tools are general ones: any that runs, executes,
  manages or changes something asks every time, with its arguments on the
  card.
- **Company look-up.** When you press Look up and type a site name, the app
  contacts that site once and reads `https://<site>/.well-known/poppy.json`.
  It sends no key and no cookie. The same checks as a web page read apply, a
  redirect is never followed, and the file is capped at 256 KB and 10 seconds.
  What the file says is shown as plain text and never sent to a model. Nothing
  is saved or connected by it.
- **Update check.** Off by default. When on, or when you press "Check now",
  the app makes one request a day to GitHub's public releases address for this
  project, with no key and no cookie, reads only the release tag, follows no
  redirect, and never downloads or installs anything. It can only show that a
  version is available, with a button that opens the release page.
- **Mail.** The client can only look: it opens folders with `EXAMINE` and
  reads with `BODY.PEEK`, so nothing is marked read, and it can send only a
  fixed list of commands (sign in, list folders, examine, search, fetch, sign
  out). There is no sending, deleting, moving or marking. The server is reached
  over TLS only, with its certificate checked; the host is a name you typed,
  resolved first, and a private address is used only when you tick "This
  server is on my own network". Waits and sizes are bounded. Mail is turned to
  plain text: HTML is never rendered, nothing a message links to is fetched,
  and attachments are named but never opened. Nothing from a message is saved
  beyond a step label.
- **Asking another assistant.** Only an assistant you tick can be asked. It
  answers in a run of its own and sees only the question. It cannot ask a
  third assistant, and one answer asks at most 3 times. Its cards appear in
  the asker's chat, saying whose step it is, with no "Always allow".
- **Checks.** Off by default, and they run only while the app is open. A check
  only reads: anything that would need your Approve is never shown and never
  run, and is left for you. A check cannot save a file, look at the screen or
  ask another assistant. One at a time, at most 4 model turns and 48 a day; it
  turns itself off after 3 failures in a row. A notification, if you turn it
  on, carries the assistant's name only.
- **The screen.** Off until you turn it on for one assistant. Every look
  shows a card first, and there is no "Always allow" for it. The picture is
  taken only after you approve, in the main process, is held in memory for one
  answer, and is never written to disk, saved in the chat or logged. The app
  can only look: there is no code that clicks, types or controls another app.
- **Approvals.** Reading a site for the first time waits for your Approve.
  "Always allow" remembers one site for one assistant, or one read-only tool
  of one connection for one assistant, or reading one mail account for one
  assistant. A connection's tool that is not marked
  as a read, or whose name reads like a change, asks every time. Even an
  allowed site or read asks again when the web address carries text after a
  `?`, and for the rest of an answer once the assistant has read from your
  folders, read your mail or looked at your screen in it, because an address
  or a tool's
  arguments can carry text out. Nothing in the app answers an approval for
  you.
- **Model wires.** A model's wire (OpenAI-compatible, Anthropic or Gemini) is
  decided in the main process from its preset; the page cannot choose it. The
  only queries the app adds to a model address are fixed, non-secret text.
  A preset's address is pinned in code. For Azure OpenAI and Amazon Bedrock the
  resource name or region you type is checked in the main process against
  Azure's own domains and a fixed list of regions.
- **Files you export.** Saved and opened only through the system's own
  dialogs, opened by the main process. The page never names a file path.
- **Links.** The only links the app opens (stellarfirm.ai, composio.dev and
  this project's source, community and release pages) are built in the main
  process from fixed parts, on your click. "Copy to StellarFirm cloud" carries
  an assistant's name, look and brief after the `#` of the address, which a
  browser does not send to a server.
- **The installed app.** It cannot be run as plain Node, started with an
  inspector, pointed at another page by an environment variable, or driven
  through a debugging port.

## Known limits

Said plainly, so nobody relies on more than is there:

- **What an assistant reads goes to the model you chose.** With a hosted key,
  that provider receives your messages and anything the assistant read from
  your folders, a connection or your screen. With a model on this computer, it
  stays here.
- **Prompt injection is reduced, not solved.** A page, a file, a connection or
  something on your screen can still talk a model into a bad answer, or into
  asking you for a step whose address or arguments hold something private. The
  card shows the full address or the arguments: read it.
- **A connection is someone else's server.** What you send it leaves this
  computer, and what it does with a tool call is up to it. Its tool
  descriptions reach the model, cut and cleaned, and could still mislead it.
- **Composio sees what you send through it.** What an assistant sends there,
  and the answers, pass through your Composio account. Composio's own terms
  and costs apply to you.
- **Mail.** What an assistant reads from your mail goes to the model you
  chose. An app password is needed, so providers that do not allow one (such
  as Microsoft 365) do not work yet. Folder names must be plain ASCII. Not yet
  run against real mail servers.
- **Asking another assistant.** A question, and what the other assistant reads
  to answer it, goes to that assistant's model, which may be another service.
- **Checks cost what your model costs.** Each check is a call to your model.
- **A look at the screen shows everything visible.** Close anything private
  before you approve. Many models on this computer cannot read pictures.
- **Earlier answers stay in the chat.** If an assistant quoted a file in an
  earlier answer, a later web read on an allowed site does not ask again.
- **A backup file is not encrypted.** If you include chats it holds your
  private text, so keep it somewhere you trust.
- **Another program running as you** can read the app's data folder and your
  files anyway. The app does not defend against that.
- **Keys on Linux** depend on the desktop's secret store. With none, a key is
  refused rather than saved in the clear.
- **Copy to StellarFirm cloud has a length limit.** The assistant travels in
  the address, and Windows cannot open an address longer than 2,081
  characters, so a long brief is refused there with a plain message.
- **No signed installers yet.** Build from source, or check a release's
  `SHA256SUMS` files. Unsigned apps show a warning on first run.
- **The file protocol keeps its extra privileges** in the packaged app, because
  the page is loaded from a file. Serving it from a protocol of the app's own
  would let that go off.
- **Not run against real services.** The Anthropic and Gemini wires, the
  connections client and the screen capture are covered by offline tests with
  stand-ins. Report what breaks against the real thing.

## Dependencies

Nothing from `node_modules` ships in the app: the code is bundled, and every
dependency is a build tool. Install scripts are blocked except for `electron`
and `esbuild` (`pnpm.onlyBuiltDependencies`).

`pnpm audit` on 19 November 2026 reports one advisory, on two paths, in the
packaging tool's own dependencies. It is not in code that ships or that reads
untrusted input:

| Advisory                                  | Package                             | Why it is deferred                                                                                                                                                                   |
| ----------------------------------------- | ----------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| GHSA-g3hv-75wg-m249 (moderate, two paths) | `minimatch`, via `electron-builder` | Fixed only in a new major version that `electron-builder` does not use yet. It is a slow-pattern problem in a glob matcher that only ever sees this repository's own build patterns. |

Review date: 19 December 2026, or when `electron-builder` updates, whichever
comes first.
