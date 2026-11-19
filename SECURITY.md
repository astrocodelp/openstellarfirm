# Security

OpenStellarFirm is the source-available sibling of StellarFirm, by Astro Code.
This note is about that desktop app.

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
  the page, never logged. On Linux a key is saved only when a real keyring
  (GNOME Keyring, KWallet or another Secret Service) seals it: without one,
  Chromium falls back to a key everyone knows, so the app refuses and says so.
- **Your chats and assistants.** Plain JSON in the app's data folder, readable
  only by your user account.
- **The folders you pick** for an assistant, **the websites you allow**, **the
  connections you add**, when you turn it on and approve each look, **what is
  on your screen**, and **the pictures of a recording** you start with "Record
  how you work".
- **Docker**, when you give an assistant a computer of its own: the app runs
  your `docker` command to build and run that computer.

## Where untrusted text comes from

| Source                                            | How it is treated                                                                                                                                                                                                                                                                              |
| ------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| A model's output                                  | Shown as plain text, never as HTML. Its tool calls are checked by code before anything runs.                                                                                                                                                                                                   |
| A tool request a model writes as text             | Some models cannot call tools, so they ask in writing. Only the model's own output of the current turn is read for that, strictly, and every request goes through the same checks and approvals as a native tool call. Text in a file or page is never read as a tool request.                 |
| A file or web page an assistant reads             | Given to the model marked as information, not instructions. It can still mislead a model, which is why the rules below are enforced in code and not in the prompt.                                                                                                                             |
| A connection (MCP server)                         | Everything it sends is checked: tool names, descriptions and schemas are validated and cut, characters that draw nothing or turn text around are taken out, answers are capped, and results reach the model marked as information. A result counts as private text for the rest of the answer. |
| A mail message                                    | Written by other people, so it is information, never instructions. Turned to plain text; nothing it links to is fetched.                                                                                                                                                                       |
| Another assistant's answer                        | Reaches the asker's model marked as information, not instructions, and counts as private text for the rest of the answer.                                                                                                                                                                      |
| A file you attach                                 | Its kind is decided from its bytes, never its name. PDFs and pictures are read only in a hidden reader window: sandboxed, isolated, in its own session where every request but its own files is cancelled. Reaches the model marked as information, not instructions.                          |
| A picture of the screen                           | Reaches the model as information. The prompt says text in it is never an instruction.                                                                                                                                                                                                          |
| An assistant's own computer (screen, commands)    | Outside text: it may come from a web page or a file made there. The answer is marked, so later web reads, connection calls, mail reads and saves ask again. It reaches the model as information. Its own screen alone is not private text.                                                     |
| A recording's pictures, and its draft             | Reach the model as information; the prompt says text in them is never an instruction. The draft is read strictly, cut to its limits, and only shown to you in an editor. Once you save it, it is guidance, never access.                                                                       |
| A company's published file (`poppy.json`)         | Read strictly, every text cut and cleaned, shown as plain text. Only a web address and a name are ever copied into a form you review.                                                                                                                                                          |
| An imported assistant file, a backup or a persona | Checked field by field. It never brings a key, a model, a folder, a site, a connection, web access or screen access with it. A backup only adds new assistants and never changes or removes one you have. Chats in it come in as plain text.                                                   |
| A model service's answers and errors              | A redirect is an error. An error is shown as a short plain line with the key taken out.                                                                                                                                                                                                        |
| The page                                          | Sandboxed, isolated, under a strict Content Security Policy. It reaches the main process only through one typed bridge, and every call is checked there.                                                                                                                                       |

## The rules the code enforces

- **Folders.** Only the system's own folder picker, opened by the main process,
  can give an assistant a folder. Every path is checked after links are
  followed: it must stay inside the folder's real root, and every part of the
  real path, from that root down, is checked again, so a link with a plain
  name that points at a private file is refused like the file. No file or
  folder whose name starts with a dot is listed, found, read or written
  (`.config`, `.kube`, `.docker`, `.pgpass`, `.pypirc`, `.vault-token`, shell
  history, `.git`, ...), except three plain settings files that may be read
  because they hold no keys and a project often needs them: `.gitignore`,
  `.gitattributes` and `.editorconfig`. A file that can hold keys or passwords
  (`.env`, `.ssh`, `*.pem`, `*.ppk`, `kubeconfig`, `*_history`, ...) is never
  listed, read or written. There is no code that changes, replaces, moves or
  deletes a file: the only write makes a new file and fails if the name is
  taken. Saving a new file runs without asking only when it is a plain file
  and the answer has read nothing from outside: a file that runs or builds on
  its own (a script such as `*.sh`, `*.bat`, `*.cmd`, `*.ps1`, `*.js` or
  `*.py`, a `Makefile`, `package.json`, `conftest.py`, a
  `docker-compose*.yml`, `Directory.Build.props`, a project file, a
  `*.config.*` file, ...) asks every time, and so does every save once the
  answer has read a file, a page, mail, a connection, the screen, another
  assistant or its own computer. The card shows the whole file; one too long
  to show whole is not saved.
- **Web pages.** https only, the standard port, public addresses only, and at
  most 8,000 characters, so the address always fits on its card whole. The
  name is resolved first, every address it resolves to must be public, and the
  connection is made to that checked address. A redirect to another site is
  not followed.
- **Connections.** Made only from a web address you typed (https, or http on
  this computer). The app never starts a program for one.
- **An assistant's own computer.** On by default for every assistant, with
  no network, but only where Docker runs and only after you set the
  computers up once (the image is built only on your click, after the panel
  says what it downloads and its size). Nothing starts when the app opens: a
  computer starts when its assistant first uses it in an answer, or when you
  press Start. At most three run at once, and one nobody used for 15 minutes
  is stopped (never removed). Without Docker no computer tool is offered.
  Only the assistant form turns it off or changes it (a new assistant from a
  shared file, a backup or a persona gets the same default, network off), and
  no file carries its settings. `docker` is run with an argument array, never a shell,
  and every value from a model is checked before it becomes one argument
  (whole pixels on the screen, keys from a fixed list, a command within its
  length and time limits). The container has `--network none` unless you
  allowed the network, `--cap-drop ALL`, `no-new-privileges`, an ordinary
  user, limits on processes, memory and processors, and one folder of yours
  mounted: its own exchange folder in the app's data folder. Never
  `--privileged`, never the Docker socket. Inside it nothing asks, with one
  exception: when you let it reach the internet and the answer has read
  something private (your folders or a file you sent, the screen, mail, a
  connection's answer or another assistant's), each command, typed text and
  key press asks first, with the whole command or text on the card, because
  any of them could carry that text to a website. Clicks, scrolls and its own
  screen never carry text and do not ask. Saving a
  file from it into one of your folders asks every time and never replaces a
  file. Checks and assistants that are asked a question never use it. The
  page can send it clicks and keys only while you have taken over. The full
  design and threat model: [docs/COMPUTER.md](docs/COMPUTER.md). A redirect is an
  error; an answer is capped at 2 MB and a request at 30 seconds; at most 20
  connections, each with a name of its own, and 40 tools each. Which assistants may use a connection is set
  only by you.
- **Direct connections.** A catalog of services that run their own remote
  tool server and take a key you make there. Each entry has one fixed address
  and one fixed way to send the key, from a small table in code (an
  `Authorization: Bearer` header, an `x-api-key` header, Ref's `x-ref-api-key`
  header, or PagerDuty's `Authorization: Token token=` form), set in the main
  process and again on every call. No entry puts a key in its address. The page, a file, a
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
- **Update check.** Off by default. When on, the app makes one request to
  GitHub's public releases address for this project when it starts (none if
  one ran in the last ten minutes) and one a day while it stays open, and one
  when you press "Check now", with no key and no cookie. It reads only the
  release tag, follows no redirect, and never downloads or installs anything.
  It can only show that a version is available, once as a system notice, with
  buttons that open the release page or this computer's file on GitHub in the
  browser; both addresses are built from the three numbers of the version and
  a fixed list of file names, never from text in the answer. Installing by
  itself waits for signed builds.
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
- **Record how you work.** Nothing records until you pick a screen or a
  window in the app's own list, which the main process builds with
  `desktopCapturer` and checks again when you pick; the app's own window is
  never offered, and a window whose title reads like a password manager cannot
  be picked. The page gets no capture permission and no stream, only small
  copies of the pictures kept. A recording stops at ten minutes or 60
  pictures. A picture is kept only when the screen changed, in memory only, and
  never of the whole screen while the app's own window is in front, nor of a
  window whose title reads like a password manager. No video is saved. A video you pick is
  read in the page from your file and never copied; each picture it sends is
  checked in the main process to be a JPEG within 1 MB. What leaves the
  computer: only the pictures you keep, at most three in a call, then one call
  with text only, to the model the screen named before you pressed Draft (the
  assistant's own, or one you picked after a model could not read pictures;
  never another one on its own). The pictures are dropped when you save, start
  over, close or quit. The draft is saved only by your own Save, as one of your
  own skills, and a skill never grants access to anything. While recording,
  the window title and the app's icon say so. Your own skills in a backup
  are checked like a save and only added when they are new.
- **Approvals.** Reading a site for the first time waits for your Approve.
  "Always allow" remembers one site for one assistant, or one read-only tool
  of one connection for one assistant, or reading one mail account for one
  assistant. A connection's tool that is not marked as a read, or whose name
  reads like a change, asks every time. Even an allowed site or read asks
  again:
  - when the web address carries text after a `?`;
  - for the rest of an answer once it holds private text: it has read from
    your folders or a file you sent, read your mail, looked at your screen,
    had an answer from one of its connections, or asked another assistant,
    because an address or a tool's arguments can carry that text out (an
    allowed mailbox asks again for all of these but mail itself, and after
    its own computer, but not after a web page alone: a mail search goes only
    to your own mail server);
  - once the answer has read a web page or used its own computer, which may
    be telling it what to do: an allowed site then reads without asking only
    at its bare address (`https://example.com/`), any longer address asks,
    and an allowed connection read asks. Its own computer makes even the bare
    address ask.

  A flag the app does not know yet counts as private. Nothing in the app
  answers an approval for you.
- **Approval cards.** A card shows the whole of what a step would send: the
  full address, every argument of a connection's tool pretty-printed as JSON
  with strings in quotes (nested lists too, so a later action in a
  Composio multi-execute call is as visible as the first), the whole command
  or text for its own computer, the whole file for a save. Long details
  scroll inside the card instead of being cut. A step whose details are too
  long to show whole (100,000 characters) is turned down with a plain line
  and never sent. Characters that draw nothing or change how text is drawn
  (bidirectional overrides, zero-width characters, tags, variation
  selectors, control characters) are written out as their code, such as
  `[U+202E]`, everywhere on a card, and taken out of connection names, tool
  descriptions and the other names a server sends. The focus never moves
  onto Approve by itself: it moves to the card, when you are not typing, and
  Approve and "Always allow" take no press for half a second after a card
  shows, so a held key or a stray click cannot approve.
- **Memory.** Notes are kept in the app's data folder, one file per
  assistant, readable only by your user account. They go into the assistant's
  instructions with every message, marked as your saved notes, so a note that
  reads like a key, a password or a token is refused, from you or from the
  assistant. The `remember` tool is offered only in an answer to you, never in
  a check or to an assistant that was asked a question. It is taken away, and
  refused if called anyway, as soon as that answer has read a file, a web
  page, mail, a connection, the screen or another assistant's answer, so text
  from outside can never write itself into memory. It saves at most 3 notes an
  answer, never asks for an Approve, and every note it saves is shown in the
  chat with Undo. Notes are in a backup only when you include chats, and never
  in a shared assistant file or the StellarFirm cloud link.
- **Summaries.** "Summarise and continue" runs only on your click, with the
  assistant's own model and no tools. The older messages stop being sent at
  once but are deleted only when you keep the summary; Undo sends them again.
  The summary is sent framed as information, not as your words.
- **Model wires.** A model's wire (OpenAI-compatible, Anthropic or Gemini) is
  decided in the main process from its preset; the page cannot choose it. The
  only queries the app adds to a model address are fixed, non-secret text.
  A preset's address is pinned in code. For Azure OpenAI and Amazon Bedrock the
  resource name or region you type is checked in the main process against
  Azure's own domains and a fixed list of regions.
- **Files you export.** Saved and opened only through the system's own
  dialogs, opened by the main process. The page never names a file path.
- **Attachments.** The page hands over a file's bytes, never a path, and the
  only file picker is the system's, opened by the main process. Sent files are
  kept in `attachments/` in the data folder, named by id and their checked
  kind, removed with their chat, never in a backup or an export, and opened
  only by id on your click. Pictures are re-encoded, which drops their
  metadata.
- **Reading languages.** Off until you click Download: one pinned Hugging Face
  address, redirects only to Hugging Face's own hosts over https, and the file
  is kept only if its SHA-256 matches.
- **Links.** The only links the app opens (stellarfirm.ai, composio.dev,
  Docker's, Ollama's and LM Studio's download pages, and this project's
  source, community and release pages) are built in the main
  process from fixed parts, on your click. "Copy to StellarFirm cloud" carries
  an assistant's name, look and brief after the `#` of the address, which a
  browser does not send to a server.
- **The installed app.** It cannot be run as plain Node, started with an
  inspector, pointed at another page by an environment variable, or driven
  through a debugging port or pipe: the fuses switch Node's options off, and
  the app quits when it sees `--remote-debugging-port`,
  `--remote-debugging-pipe`, `--inspect` in any of its spellings or
  `--js-flags`. No window has the developer tools (`devTools` is off in a
  packaged app), and the app sets a menu of its own with the edit, zoom and
  window items and no "Toggle Developer Tools"; on Linux and Windows it still
  hides until Alt. No window spell-checks, so Chromium never downloads its
  dictionaries.

## Known limits

Said plainly, so nobody relies on more than is there:

- **What you attach goes to the model you chose**, and text read from a picture
  or a scan can be wrong. Attached files are not encrypted on disk.
- **PDF.js and Tesseract read untrusted files** in the sandboxed reader, not in
  the main process. PNG and JPEG pictures are decoded by Electron in the main
  process to scale them, within a size cap; a bug in that decoder would run
  in the main process. Moving that into the reader is a follow-up.

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
- **An assistant's own computer is a container, not a virtual machine.** On
  Linux it shares your kernel. With its network on, a page there can try to
  steer it and it could send what is on that computer to a website: what it
  made or read there, and what is in its exchange folder, including anything
  typed there in an earlier answer while its network was off (turning the
  network on makes a fresh computer, but the exchange folder stays). Its
  network is Docker's default one, so it can also reach your local network
  and other computers on it; a network that only reaches the internet is
  not built yet. A file copied out of it can be harmful like any download.
  Stopping an answer does not end a command already running inside it, which
  runs to its time limit. See [docs/COMPUTER.md](docs/COMPUTER.md).
- **A recording can hold private things.** It cannot spot a password, a key or
  a private message in a picture, and it cannot tell which window is in front
  when you record the whole screen (other than the app's own). Close what is
  private before you record, and remove any picture that shows it before you
  draft. A model that cannot read pictures may ignore them without saying so;
  read the draft before you save it.
- **Earlier answers stay in the chat.** If an assistant quoted a file in an
  earlier answer, a later web read on an allowed site does not ask again
  before the new answer reads anything from outside.
- **Which step it takes says a little.** After a web page, the bare address of
  an allowed site still reads without asking, and a model can choose to read
  it or not; that choice carries a bit at a time, nothing like a whole
  message.
- **A backup file is not encrypted.** If you include chats it holds your
  private text, so keep it somewhere you trust.
- **A saved chat is plain Markdown.** It is written only where you pick, and
  saved keys and the usual shapes of keys are hidden. A secret in another
  shape that you typed into the chat is written as you typed it.
- **Another program running as you** can read the app's data folder and your
  files anyway. The app does not defend against that.
- **Keys on Linux** depend on the desktop's secret store. With none, a key is
  refused rather than saved in the clear.
- **Copy to StellarFirm cloud has a length limit.** The assistant travels in
  the address, and Windows cannot open an address longer than 2,081
  characters, so a long brief is refused there with a plain message.
- **No signed installers yet.** Build from source, or check a release's
  `SHA256SUMS` files. Unsigned apps show a warning on first run. Signing for
  macOS and Windows is a gate for the first release meant for everyone.
- **The file protocol keeps its extra privileges** in the packaged app
  (`grantFileProtocolExtraPrivileges`), because the page is loaded from a
  file. Serving it from a protocol of the app's own would let that go off; it
  is a follow-up.
- **Not run against real services.** The Anthropic and Gemini wires, the
  connections client, the screen capture, the recording's capture and the
  Docker calls are covered by offline tests with stand-ins. The computer was
  also checked by hand with Docker Desktop on macOS. Report what breaks
  against the real thing.

## Dependencies

The code is bundled. Two runtime libraries ship, only inside the sandboxed
reader window: PDF.js (`pdfjs-dist`) and Tesseract.js (`tesseract.js`), both
Apache-2.0, with the files they need. Every other dependency is a build tool. Install scripts are blocked except for `electron`
and `esbuild` (`pnpm.onlyBuiltDependencies`).

`pnpm audit` on 19 November 2026 reports one advisory, on two paths, in the
packaging tool's own dependencies. It is not in code that ships or that reads
untrusted input:

| Advisory                                  | Package                             | Why it is deferred                                                                                                                                                                   |
| ----------------------------------------- | ----------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| GHSA-g3hv-75wg-m249 (moderate, two paths) | `minimatch`, via `electron-builder` | Fixed only in a new major version that `electron-builder` does not use yet. It is a slow-pattern problem in a glob matcher that only ever sees this repository's own build patterns. |

Review date: 19 December 2026, or when `electron-builder` updates, whichever
comes first.
