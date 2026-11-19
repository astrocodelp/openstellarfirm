# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

The app is at version 0.1.0. There is no tagged release yet.

### Added

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
- A gallery of 50 services to connect, up from ten: each one checked against
  the service's own page for a remote MCP server at one fixed https address
  that takes a key you make there in a header. Search by name, what it does or
  its group (Enter opens the first, Esc clears), narrow to one group, and see
  which you added already, with "Add another account" for a second one. Add by
  address and Composio stay one click away, also when nothing matches.
- A searchable list of connections on an assistant's form once you have more
  than six, with a count of how many it may use.

- Accessibility first, aiming at WCAG 2.2 AA. A new Settings section,
  Accessibility: contrast (follow this computer, more, or standard, in light
  and dark), motion (follow this computer, less, or full), underline links, a
  stronger focus ring, more space for reading, larger click targets, and the
  speed of read aloud. Each answer has a Read aloud button that uses only a
  voice on this computer. Skip links, named landmarks, one polite announcer for
  a finished answer, a step that waits and an error, a keyboard shortcuts list
  (Ctrl or Cmd with /), and remove questions that take and give back the
  focus. Field hints and errors are tied to their fields, and buttons that
  repeat in a list say what they act on. See
  [ACCESSIBILITY.md](ACCESSIBILITY.md).
- A desktop app for macOS and Windows. You make assistants (name, group, one
  of six pets in five colours, a brief, and skills) that talk through a model
  you set up: Ollama or LM Studio on this computer, your own key, or your own
  OpenAI-compatible endpoint (OpenAI, OpenRouter, Mistral, Together AI, or a
  LiteLLM gateway). An assistant can have a model of its own.
- Chat that streams, with Stop. Each assistant keeps its own chat.
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
  a model, a folder or a site, and it cannot switch web reading on.
- Copy to StellarFirm cloud. One button opens stellarfirm.ai in your browser
  with an assistant's name, look and brief. A long brief is refused on
  Windows when the address would be longer than 2,081 characters, with a
  plain message that says to shorten the brief and copy again. A brief is
  cleaned of control characters other than line breaks and tabs when it is
  saved, and again when it is exported or copied.
- First run that finds a model already running on this computer.
- Keys sealed with the operating system's keychain, read only in the main
  process, sent only to the address they were saved with, and refused when
  there is no keychain.
- [SECURITY.md](SECURITY.md), which says what the code enforces and what it
  does not, and [THIRD-PARTY-NOTICES.md](THIRD-PARTY-NOTICES.md) for bundled
  fonts.

- Starter personas (Coder, Legal, Writer, Researcher, Planner, Tutor,
  Accountant, Marketing) in [`personas/`](personas), one file each, offered
  in the new-assistant form. Anyone can add one.
- Thirteen more ready-made assistants: Product owner, Sales, Executive
  assistant, Support, Recruiting, Online shop, DJ, Copywriter, Scientist,
  Architect, Mechanical engineer, Designer and Journalist. Each persona file
  now has a `category`, and ticks its own skills.
- A skill library: 108 new skills, each a name, a one-line description and a
  few lines of guidance, grouped by the kind of work. The texts are
  contributed by Astro Code under this licence (see [NOTICE](NOTICE)).
- A gallery in "New assistant": browse by category, search by name, role or
  skill, preview the brief and the skills, and fill the form in one click.
  The list keeps one tab stop and moves with the arrow keys.
- A searchable skills picker in the assistant form, grouped, with the ticked
  skills listed on top and a limit of 20.
- Native wires for Anthropic (Claude) and Google (Gemini), on your own key.
- Tools for models that cannot call tools: the model asks in writing, through
  the same approvals.
- Connections: an assistant can use the tools of a remote MCP server by its
  web address. Every call asks first. Composio is offered as a preset, on
  your own Composio key.
- Look up a company: read what a company publishes for personal agents
  (`poppy.json`) and add one of its servers as a connection yourself.
- A look at your screen, off until you turn it on for an assistant. Every
  look asks first, the picture is never saved, and it can only look.
- Move or back up: one file with all your assistants, and your chats only if
  you tick that, to open on another computer.
- Settings: light, dark or system theme, text size, the send key, what is
  remembered, the data folder, delete all chats, and About.
- An update check that is off until you turn it on. It only asks GitHub for
  the newest version and shows a notice. It never downloads or installs.
- Memory: each assistant keeps up to 100 short notes, shown and edited in a
  Memory section of its page, and memory can be turned off per assistant. The
  assistant can save a note with `remember` (at most 3 an answer, never a
  key-like text, and never once the answer has read outside text), shown in
  the chat with Undo. Notes travel in a backup only with chats, never in a
  shared file.
- Chat context: a meter of how full the model's window is (an estimate, shown
  when the window is known), Forget on any message with Undo, Clear chat, and
  "Summarise and continue", which the assistant's own model writes and you
  keep or undo. Past 80% the chat offers it; it never does it on its own.
- An app icon, and Linux builds (AppImage and tar.gz).
- Release and check scripts that run without GitHub Actions
  ([docs/RELEASING.md](docs/RELEASING.md)).
- [COMMUNITY.md](COMMUNITY.md), [CONTRIBUTORS.md](CONTRIBUTORS.md), and
  public instructions for the maintainer assistant in
  [`docs/maintainers/`](docs/maintainers).
- Find anything: Ctrl+K (Cmd+K on a Mac), or the Find anything button in the
  sidebar, opens one box that finds assistants, screens, Settings sections,
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
- A Copy button under each answer. The words are copied by the main process
  from the saved chat; the page sends only which message.
- A computer of its own for an assistant, in Docker on this computer, never
  in a cloud. Off by default, turned on per assistant. The app finds the
  `docker` command (Docker Desktop, Docker Engine, OrbStack, Colima, Rancher
  Desktop or Podman's), builds a small Debian desktop from a Dockerfile it
  ships on your click, and runs one container per assistant with no network
  unless you allow it, every capability dropped, no new privileges, limits on
  processes, memory and processors, and only its own exchange folder mounted.
  The assistant can take a picture of its screen, click, type, press keys,
  scroll, run a command with a time limit, and copy a file out; saving a copy
  into one of your folders asks every time. A panel beside the chat shows the
  screen about once a second, with Pause, Take over, Stop, Turn off and
  Remove. See [docs/COMPUTER.md](docs/COMPUTER.md).

### Changed

- The licence is now the Apache License 2.0 with the Commons Clause: free to
  use, change and share, not to sell. Selling needs a commercial licence
  ([COMMERCIAL.md](COMMERCIAL.md)). [NOTICE](NOTICE) says what the licence
  covers.
- The app is named OpenStellarFirm.
- Motion and interactions: screens and new messages fade in; the chat follows
  an answer only while you are at the end, with a "Jump to latest" button;
  the approval card never takes focus while you type, and turns into its
  outcome line after you decide; confirms take focus, close with Escape and
  give focus back; the theme changes with one cross-fade. Everything is still
  under reduced motion.
- A redesigned interface: labelled navigation in the sidebar, pill buttons,
  one screen frame, and a compact persona picker.

### Security

- The installed app ignores the dev-server variable, refuses a debugging
  port, opens no new windows and embeds no pages. Packaging fuses switch off
  run-as-Node, NODE_OPTIONS and the inspector, and require the signed
  archive.
- Every value the page sends is checked in the main process. Keys are looked
  up by own names only.
- CI actions are pinned to commits, with read-only permissions.
