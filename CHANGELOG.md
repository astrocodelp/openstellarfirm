# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

The app is at version 0.1.0. There is no tagged release yet.

### Added

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
