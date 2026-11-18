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

### Security

- The installed app ignores the dev-server variable, refuses a debugging
  port, opens no new windows and embeds no pages. Packaging fuses switch off
  run-as-Node, NODE_OPTIONS and the inspector, and require the signed
  archive.
- Every value the page sends is checked in the main process. Keys are looked
  up by own names only.
- CI actions are pinned to commits, with read-only permissions.
