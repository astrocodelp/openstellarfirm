# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Added

- Desk pets, phase 3: a pet can now talk and be told things (`src/main/pets/`).
  What you say is heard with ElevenLabs Scribe on your own key, sent to the
  assistant you chose as your own message (marked as from a desk pet, through
  the same approval rules as a typed one) and the answer is spoken back with
  ElevenLabs Flash, without numbers, amounts or links. The pet hears "done",
  "stopped", "needs you" and a check's update, and only "needs you" for a step
  that waits: it can never approve one. Its built-in lines are made on your
  key as a voice pack, kept in the app's data folder. A refused or used-up key
  is said by the pet and shown in the app's status. Still no Settings screen
  for it; that comes next.
- Desk pets, phase 2: the app can now be a desk pet's server (`src/main/pets/`):
  the certificate made by the app and kept in the keychain, an HTTPS server
  that only answers addresses on your own network, pairing with a setup code
  and a confirm code you type, and the mDNS name. It stays off, with no port
  open, until a later release adds the Settings switch.
- Desk pets: the firmware, the 3D print files and the protocol code for Nova,
  Zib and Comet, a small desk figure on an Arduino Nano ESP32, are here
  (`firmware/`, `hardware/` and `src/shared/pets/`). They pair with the app in
  a later release; the plan and the phases are in
  [docs/desk-pets-plan.md](docs/desk-pets-plan.md). `pnpm pets:header` writes
  the C++ headers the firmware shares with the protocol code.

### Security

- The release scripts take the GitHub token and the signing variables out of
  the environment while the checks and the build scripts run: the checks get
  none, electron-builder gets only the signing variables, and the token goes to
  the upload step alone.
- The main window now cancels every request that is not one of the app's own
  files (the dev server only when run from source) and refuses permission
  checks, as the reader window already did.
- The app asks before saving a web page, an SVG or a macro-enabled Office file
  (`.html`, `.htm`, `.svg`, `.docm`, `.xlsm`, `.pptm` and similar), as it
  already does for scripts.
- Reading a web page also refuses the documentation address ranges
  (192.0.2.0/24, 198.51.100.0/24, 203.0.113.0/24).

### Changed

- The release upload writes the SHA-256 checksums into the draft's notes as
  well as attaching them. RELEASING.md says an unsigned build must not be the
  public launch build and lists the signing variables.
- Conduct reports go to hey@stellarfirm.ai; security reports stay on GitHub's
  private reporting. Added `.github/CODEOWNERS`.
- The README says the "Copy to StellarFirm cloud" address keeps the brief in
  its fragment, which stays in the browser's history and on the clipboard.

## [0.1.0] - 2026-11-19

The first release. The builds are not signed yet: see the README's
[Install a release](README.md#install-a-release) for how to open them and
check their sums.

If you ran a development build before: the app was called StellarFirm Solo,
and a build under that name keeps its data folder and sealed keys there. This
name uses a new folder, named OpenStellarFirm (see the README's
[Run it](README.md#run-it)); on Linux, a development build from before the
product name was set used `~/.config/openstellarfirm`.

### Added

- A desktop app for macOS, Windows and Linux. You make assistants (name,
  group, one of six pets in five colours, a brief, and skills) that talk
  through a model you set up: Ollama or LM Studio on this computer, your own
  key, or your own OpenAI-compatible endpoint (OpenAI, OpenRouter, Mistral,
  Together AI, or a LiteLLM gateway). An assistant can have a model of its own.
  Its code is open to read, change and share, not to sell: the Apache License
  2.0 with the Commons Clause. Selling needs a commercial licence
  ([COMMERCIAL.md](COMMERCIAL.md)), and [NOTICE](NOTICE) says what the licence
  covers.
- An interface built on one set of tokens: a sidebar that keeps to your
  assistants, with one quiet Settings row at its foot (Cmd+comma on a Mac,
  Ctrl+comma elsewhere), pill buttons, one screen frame, and a compact persona picker. Light and dark,
  following your computer or your choice, with one cross-fade when the theme
  changes.
- Motion that never gets in the way: screens and new messages fade in, the
  chat follows an answer only while you are at the end (with a "Jump to latest"
  button), and the approval card never takes focus while you type and turns
  into its outcome line after you decide. Everything is still under reduced
  motion.
- First run that finds a model already running on this computer. It picks a
  model that can use tools and read pictures, the newest of those, never an
  embedding model, and says which it picked and why. With no model running, it
  offers to get Ollama or LM Studio (their download pages open in your browser
  only on your click) and to look again; with Ollama or LM Studio running but
  empty, it says so and, for Ollama, shows a line to run in a terminal with a
  Copy button. The app never runs it.
- Chat that streams, with Stop. Each assistant keeps its own chat. The chat
  head is one row: the name and model, Computer, Customize and a More menu
  with Save this chat, Summarise and continue and Clear chat.
- Answers show their Markdown: bold, italic, code, code blocks with Copy and
  their own sideways scroll, lists, task lists, tables (GitHub's pipe form,
  each in its own sideways scroll; a copy pastes into a spreadsheet as
  columns), quotes and links, drawn as the app's own
  elements (never HTML from the model). A link shows its address on hover and
  focus, and opens in the browser only after you say yes to its host; the app
  checks the link is in that answer and is http or https. The sidebar's last
  line, Copy and Read aloud use the plain words; Save this chat keeps the
  Markdown. The instructions ask the model for Markdown where it helps
  (short headings, lists, tables, fenced code with its language) and plain
  sentences for a short answer.
- A Copy button under each answer. The words are copied by the main process
  from the saved chat; the page sends only which message.
- Folders you pick. An assistant can list, find and read files there, and
  save a new file. It can never change, replace, move or delete one. Only the
  system's folder picker, opened by the main process, can grant a folder.
  Paths are checked after links are followed. Files that can hold keys or
  passwords are never opened.
- Web pages, with your Approve. https only, the standard port, public
  addresses only, connecting to the address that was checked. A redirect to
  another site is not followed. Reaching a site for the first time waits for
  your Approve. "Always allow" remembers one site for one assistant. An
  address with text after a "?" always asks, and so does any web read once
  the answer has read from your folders.
- Share an assistant as a file. Export and import. A file never holds a key,
  a model, a folder or a site, and it cannot switch web reading on. Assistant
  files and backups use the `stellarfirm-open.assistant` and
  `stellarfirm-open.backup` formats.
- Copy to StellarFirm cloud. One button opens stellarfirm.ai in your browser
  with an assistant's name, look and brief. A long brief is refused on
  Windows when the address would be longer than 2,081 characters, with a
  plain message that says to shorten the brief and copy again. A brief is
  cleaned of control characters other than line breaks and tabs when it is
  saved, and again when it is exported or copied.
- Keys sealed with the operating system's keychain, read only in the main
  process, sent only to the address they were saved with, and refused when
  there is no keychain.
- Starter personas (Coder, Legal, Writer, Researcher, Planner, Tutor,
  Accountant, Marketing) and thirteen more ready-made assistants (Product
  owner, Sales, Executive assistant, Support, Recruiting, Online shop, DJ,
  Copywriter, Scientist, Architect, Mechanical engineer, Designer and
  Journalist) in [`personas/`](personas), one file each, with a `category`,
  ticking their own skills. Anyone can add one.
- A gallery in "New assistant": browse by category, search by name, role or
  skill, preview the brief and the skills, and fill the form in one click.
  The list keeps one tab stop and moves with the arrow keys.
- A skill library: 108 skills, each a name, a one-line description and a few
  lines of guidance, grouped by the kind of work. The texts are contributed by
  Astro Code under this licence (see [NOTICE](NOTICE)).
- A searchable skills picker in the assistant form, grouped, with the ticked
  skills listed on top and a limit of 20.
- Native wires for Anthropic (Claude) and Google (Gemini), on your own key.
- Tools for models that cannot call tools: the model asks in writing, through
  the same approvals.
- Connections: an assistant can use the tools of a remote MCP server by its
  web address. Every call asks first. Composio is offered as a preset, on
  your own Composio key.
- A gallery of 50 services to connect: each one checked against the service's
  own page for a remote MCP server at one fixed https address that takes a key
  you make there in a header. Search by name, what it does or its group (Enter
  opens the first, Esc clears), narrow to one group, and see which you added
  already, with "Add another account" for a second one. Add by address and
  Composio stay one click away, also when nothing matches.
- A searchable list of connections on an assistant's form once you have more
  than six, with a count of how many it may use.
- Look up a company: read what a company publishes for personal agents
  (`poppy.json`) and add one of its servers as a connection yourself.
- A look at your screen, off until you turn it on for an assistant. Every
  look asks first, the picture is never saved, and it can only look.
- Record how you work: on an assistant's page, record your whole screen or one
  window (your pick is the consent, up to ten minutes) or pick a video you
  have. A picture is kept every two seconds only when the screen changed, in
  memory only; no video is saved. Remove any picture with the mouse or the
  keyboard, add a few words, and see how many pictures go to which model
  before anything is sent. The assistant's own model studies them three at a
  time and drafts a skill; a model that cannot read pictures is named, and you
  can pick another for that draft. You read and edit the draft, and only your
  Save keeps it, in "My skills" in the skills picker, where you can edit,
  delete and tick it. Own skills travel in a backup as text. No picture of the
  whole screen is kept while OpenStellarFirm is in front, nor of a window whose
  title reads like a password manager.
- Move or back up: one file with all your assistants, and your chats only if
  you tick that, to open on another computer.
- Settings, the one place where the app is set up, with its pages listed on
  its own left side (a row of buttons in a narrow window): General (light,
  dark or system theme, text size, the send key, the main assistant, what is
  allowed for good, the data folder and delete all chats), Models,
  Connections, Mail, Accessibility, Reading other languages, Move or back up,
  and Updates and About, which opens the full licence texts of the work of
  others inside the app. It opens where you left it; Escape or Back to chats
  goes back, and every way in (the chat's "Set up a model", Find anything)
  opens the right page with the focus on its heading.
- An update check that is off until you turn it on. It only asks GitHub for
  the newest version and shows a notice. It never downloads or installs.
- Memory: each assistant keeps up to 100 short notes, shown and edited in a
  Memory section of its page, and memory can be turned off per assistant. The
  assistant can save a note with `remember` (at most 3 an answer, never a
  key-like text, and never once the answer has read outside text), shown in
  the chat with Undo. Notes travel in a backup only with chats, never in a
  shared file.
- Chat context: a meter of how full the model's window is (an estimate, shown
  from the start when the window is known; the line takes no room when it is
  not), Forget on any message with Undo, Clear chat, and "Summarise and
  continue", which the assistant's own model writes and you keep or undo. Past
  80% the chat offers it; it never does it on its own.
- Find anything: Ctrl+K (Cmd+K on a Mac), or the Find anything button in the
  sidebar, opens one box that finds assistants, Settings pages and sections,
  connections and actions, and searches every chat on this computer. The
  search runs in the main process over the chat files, ignores case and
  accents, ranks whole words first and newest first within a rank, and shows a
  short piece of the message with the words marked. A result opens the chat,
  jumps to the message and lights it for a moment. Arrow keys, Enter and
  Escape work, and the number of results is announced.
- Save this chat: one chat as a Markdown file, through the system's save
  dialog, with names, times, and what you and the assistant wrote. The steps
  an assistant took are left out, and every saved key, and the usual shapes
  of keys, are hidden wherever they appear.
- A computer of its own for an assistant, in Docker on this computer, never
  in a cloud. On by default for every assistant, with no network, where
  Docker runs and once the computers are set up (one build, on your click,
  for all of them); turned off per assistant in its form, and an assistant
  saved before keeps what it chose. Nothing starts when the app opens: a
  computer starts when its assistant first uses it or you press Start. At
  most three run at once (starting one more stops the one used longest ago
  that nothing is using), and one idle for 15 minutes stops; its files stay.
  Without Docker the assistant has no computer tools, and an empty chat says
  in one line how to get Docker. While it is on, the Computer button in the
  chat's head shows a small live picture of its screen, about once a second
  and only while the window is visible; each step on it shows a picture of
  the screen after it (kept in memory while the app runs, never saved) that
  opens full size; the panel slides in only when you click (never from a
  key) and lists every assistant's computer with Turn off and Remove. The app finds the
  `docker` command (Docker Desktop, Docker Engine, OrbStack, Colima, Rancher
  Desktop or Podman's), builds a small Debian desktop from a Dockerfile it
  ships on your click, and runs one container per assistant with no network
  unless you allow it, every capability dropped, no new privileges, limits on
  processes, memory and processors, and only its own exchange folder mounted.
  The assistant can take a picture of its screen, click, type, press keys,
  scroll, run a command with a time limit, and copy a file out; saving a copy
  into one of your folders asks every time. A panel beside the chat shows the
  screen about once a second while it is open, with Pause, Take over, Stop,
  Turn off and Remove. Its empty screen is a night desktop with the app's mark, the panel
  says when nothing is open on it yet, and the exchange folder's path is
  behind "Where the folder is". See [docs/COMPUTER.md](docs/COMPUTER.md).
- Accessibility first, aiming at WCAG 2.2 AA. A Settings section,
  Accessibility: contrast (follow this computer, more, or standard, in light
  and dark), motion (follow this computer, less, or full), underline links, a
  stronger focus ring, more space for reading, larger click targets, and the
  speed of read aloud. Each answer has a Read aloud button that uses only a
  voice on this computer. Skip links, named landmarks, one polite announcer for
  a finished answer, a step that waits and an error, and a keyboard shortcuts
  list (Ctrl or Cmd with /). A confirm puts the focus on Keep it or Cancel,
  closes with Escape, and gives the focus back to the button that opened it.
  Field hints and errors are tied to their fields, and buttons that repeat in a
  list say what they act on. See [ACCESSIBILITY.md](ACCESSIBILITY.md).
- An app icon; Linux builds (AppImage and tar.gz) with icons from 16 to 512
  pixels and a desktop entry; and unsigned installers from `pnpm package`.
- [SECURITY.md](SECURITY.md), which says what the code enforces and what it
  does not; [THIRD-PARTY-NOTICES.md](THIRD-PARTY-NOTICES.md), the list of
  other people's work inside the app; and THIRD-PARTY-LICENSES.txt, their full
  licence texts, written by the build and shipped beside the app.
- Release and check scripts that run without GitHub Actions
  ([docs/RELEASING.md](docs/RELEASING.md)), with release notes from
  [docs/release-notes-template.md](docs/release-notes-template.md).
- [COMMUNITY.md](COMMUNITY.md), [CONTRIBUTORS.md](CONTRIBUTORS.md), and
  public instructions for the maintainer assistant in
  [`docs/maintainers/`](docs/maintainers).

### Fixed

- An assistant's computer shows Chinese, Japanese and Korean text on web
  pages instead of boxes (two small font packages in its image).
- Three problems an automated accessibility check (axe-core) found on the
  running app: a word Find anything found in a chat fell under 4.5:1 contrast
  on the chosen row in dark; the service search pointed a screen reader at a
  list that was gone when nothing matched (and so did the connection search
  in an assistant's settings); and the sidebar's StellarFirm card had the same
  name as a section of Settings.
- An assistant's computer, after a real model did real work on it: Firefox
  opens straight to the page asked for (no welcome or privacy notice tabs),
  and a second page opens as a tab instead of an "already running" box;
  `open-app` returns once the window shows; main windows fill the screen and
  the terminal's text is readable in a picture; the first step waits until the
  window manager is up; an answer with its computer has 24 rounds of tools,
  not 8. Keys you type on the live view while you have it arrive in order. A
  folder tool given a path on its computer (`exchange/…`, `/tmp/…`, `~/…`) is
  turned down instead of writing into your folder, `computer_copy_out` reads
  `~`, and a file already in the exchange folder is not copied beside itself.

### Security

- The installed app ignores the dev-server variable, refuses a debugging
  port, opens no new windows and embeds no pages. Packaging fuses switch off
  run-as-Node, NODE_OPTIONS and the inspector, and require the signed
  archive.
- Every value the page sends is checked in the main process. Keys are looked
  up by own names only.
- CI actions are pinned to commits, with read-only permissions. The release
  scripts pin their build images by digest, and a release build runs only in
  a Fly app named for it (there is no default).

[Unreleased]: https://github.com/astrocodelp/openstellarfirm/compare/v0.1.0...HEAD
[0.1.0]: https://github.com/astrocodelp/openstellarfirm/releases/tag/v0.1.0
