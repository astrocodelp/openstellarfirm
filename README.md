# OpenStellarFirm

Personal AI assistants on your own computer. A desktop app for macOS, Windows
and Linux that thinks with your own model: a local AI model on this machine
(Ollama, LM Studio), offline if you like, or your own key. It is an MCP client
too. No account, no cloud saving, no telemetry.

[![Latest release](https://img.shields.io/github/v/release/astrocodelp/openstellarfirm?include_prereleases&sort=semver&label=release)](https://github.com/astrocodelp/openstellarfirm/releases)
[![Licence: Apache-2.0 + Commons Clause](https://img.shields.io/badge/licence-Apache--2.0%20%2B%20Commons%20Clause-blue)](LICENSE)
[![Platforms: macOS, Windows, Linux](https://img.shields.io/badge/platforms-macOS%20%7C%20Windows%20%7C%20Linux-lightgrey)](#install-a-release)
[![Discussions](https://img.shields.io/github/discussions/astrocodelp/openstellarfirm?label=discussions)](https://github.com/astrocodelp/openstellarfirm/discussions)

<!-- screenshot: docs/screenshot.png -->

## Download

Download the newest build for your system from the
[Releases page](https://github.com/astrocodelp/openstellarfirm/releases).
Until the first release is out, run it from source (see [Run it](#run-it)).
The builds are not signed yet, so your system warns you the first time:
[Install a release](#install-a-release) says how to open one. Check the file
you downloaded against the sums file beside it first:

```bash
shasum -a 256 -c SHA256SUMS-mac.txt --ignore-missing   # macOS
sha256sum -c SHA256SUMS.txt --ignore-missing           # Linux
```

```powershell
# Windows: compare with the file's line in SHA256SUMS.txt
Get-FileHash .\OpenStellarFirm-0.1.0-win-x64.exe -Algorithm SHA256
```

**Works with** Ollama, LM Studio, OpenAI, Claude, Gemini, OpenRouter, any
OpenAI-compatible address, and remote MCP servers.

## What it is

You give each assistant a name, a look and a job. It thinks with your own
model: one that runs on this machine (Ollama, LM Studio), your own key, or your
own endpoint. There is no account, no server of ours, and no fee. Its code is
open to read, change and share, not to sell (see [Licence](#licence)).

> **Early.** An assistant can talk, read and add files in folders you pick,
> read web pages you allow, use the tools of servers you connect, look at
> your screen when you approve, and, if you give it one, use a computer of its
> own in Docker. It cannot click, type or use your own apps.
> See [What is built](#what-is-built) and the [Roadmap](#roadmap).

OpenStellarFirm is the source-available sibling of
[StellarFirm](https://stellarfirm.ai), by Astro Code. StellarFirm is where a
whole team of AI Agent Assistants works for your company in the cloud.

## Install a release

The builds are not signed or notarized yet, so macOS and Windows warn you the
first time you open the app. Check the file's sum first (see
[Download](#download)), then:

### macOS

1. Open the `.dmg` and drag OpenStellarFirm to Applications (or unzip the
   `.zip`). Take `arm64` for Apple silicon, `x64` for an Intel Mac.
2. Open the app. macOS says it cannot check it; press **Done**.
3. Open **System Settings**, then **Privacy & Security**. Under Security, press
   **Open Anyway** next to OpenStellarFirm, and confirm.

Check it: `shasum -a 256 -c SHA256SUMS-mac.txt --ignore-missing`.

### Windows

1. Run `OpenStellarFirm-<version>-win-x64.exe`.
2. When SmartScreen says "Windows protected your PC", press **More info**, then
   **Run anyway**.

Check it in PowerShell:
`Get-FileHash .\OpenStellarFirm-<version>-win-x64.exe -Algorithm SHA256`, and
compare the result with the file's line in `SHA256SUMS.txt`.

### Linux

1. Make the AppImage runnable and start it:
   `chmod +x OpenStellarFirm-<version>-linux-x64.AppImage`, then
   `./OpenStellarFirm-<version>-linux-x64.AppImage`.
2. An AppImage needs FUSE (on Debian or Ubuntu, the `libfuse2` package;
   `libfuse2t64` on Ubuntu 24.04). Without it, start it with
   `--appimage-extract-and-run`. Or take the `.tar.gz`, unpack it, and run
   `openstellarfirm` inside.
3. To save a key, the app needs a running Secret Service keyring, such as
   GNOME Keyring or KWallet. Without one it refuses to save a key rather than
   keep it in the clear; a model on this computer needs no key.

Check it: `sha256sum -c SHA256SUMS.txt --ignore-missing`.

## What is built

- **Assistants you make your own.** Name, group, one of six pets in five
  colours, a brief in your own words, and skills (lines of guidance).
- **Ready-made assistants.** 21 personas, from Coder, Product owner and
  Designer to Sales, Support, Accountant, Legal, Scientist, Journalist and DJ,
  each a starting point you can change. "New assistant" opens a gallery: browse
  by category, search by name, role or skill, read the brief and the skills,
  and fill the form in one click. Nothing is saved until you save. They live in
  [`personas/`](personas), one file each, and anyone can add one.
- **A library of skills.** Over a hundred short lines of guidance, grouped by
  the kind of work (a contract checklist, a fact check, a lesson plan, a
  measured survey), with a searchable picker. A skill is guidance, never
  access: only the ones an assistant has ticked go into its instructions.
- **Your own model.** On this computer with Ollama or LM Studio, or your own
  key for OpenAI, Anthropic (Claude), Google (Gemini), Mistral, xAI, DeepSeek,
  Groq, Cerebras, NVIDIA, Together AI, Hugging Face, OpenRouter, Requesty,
  Vercel AI Gateway, LLM API, Ironlane, OrcaRouter, Azure OpenAI, Amazon
  Bedrock, a LiteLLM gateway, or any OpenAI-compatible address. An assistant
  can have a model of its own. Google Vertex AI is not supported: it signs in
  with a service account, not a key.
- **Chat that streams**, with Stop. Each assistant keeps its own chat.
- **Files in a message.** Attach pictures, PDFs and text files by the paper
  clip, a drop or a paste. Where your model takes them it gets them as they
  are; otherwise the app reads their text on this computer, scanned pages too.
  English is built in; other languages download from Settings on your click.
- **Find anything.** Ctrl+K (Cmd+K on a Mac), or Find anything in the
  sidebar, finds an assistant, a screen, a setting, a connection or an action,
  and searches every chat on this computer, case and accents aside. A result
  opens the chat at the message. Save a chat as a Markdown file where you
  pick, with no key in it, and copy any answer.
- **Folders you pick.** An assistant can list, find and read files there, and
  save a new file. It can never change, replace, move or delete one. Files and
  folders whose names start with a dot, and files that hold keys, are never
  opened. Saving a script or a build file asks first, and so does any save
  once the answer has read something from outside.
- **Web pages, with your Approve.** It asks before it reaches a site for the
  first time. You can allow a site for good, and take that back.
- **Connections.** Let an assistant use the tools of a remote MCP server by
  its web address. Every call asks first and shows what would be sent. A tool
  the server marks as read-only, with a name that does not read like a change,
  can be allowed for good; everything else asks every time.
- **The services you already use.** Fifty services in a gallery you can
  search and sort by group, each connected with a key you make in that
  service, straight from this computer to it. Add the same service more than
  once, such as a work and a personal account. An assistant's settings have a
  searchable list of the connections it may use.
  - **Code:** GitHub, Context7, Ref, Hugging Face, Render, Buildkite, Postman,
    DigitalOcean, Cloudflare, Pulumi.
  - **Data and databases:** Neon, Supabase, MotherDuck, Tinybird, PostHog,
    Datadog (US1 and EU1), Honeycomb (US and EU), Pydantic Logfire (US and
    EU), Better Stack, Weights & Biases.
  - **Search and web:** Apify, Firecrawl, Exa, Jina AI, Parallel, Linkup,
    Perplexity, SerpApi, You.com.
  - **Payments and money:** Stripe.
  - **Work and projects:** Linear, Jira and Confluence, monday.com,
    Smartsheet, Wrike, Clockify, Fireflies, PagerDuty, Zapier.
  - **Mail and messages:** AgentMail, Intercom (US and EU), Resend, Brevo,
    Mailchimp Transactional.
  - **Files and docs:** Sanity, Tally.
- **Your own Composio account.** One connection that reaches many apps
  (mail, calendars, GitHub, search and more) through Composio, on your own
  Composio key. Your usage and any cost are between you and Composio.
- **Look up a company.** See what a company publishes for personal agents
  (the Personal Agent Protocol's `poppy.json`), and add one of its servers as
  a connection yourself.
- **Settings.** Theme, text size, the send key, what is remembered, your data
  folder, and an update check you can turn on.
- **Your mail, read only.** Add a mailbox with an app password and tick it for
  an assistant. It can list and read messages, and never sends, deletes,
  moves or marks anything. Every look asks first.
- **Assistants that ask each other.** Let one assistant ask the others you
  tick a question. The one asked answers with its own brief, tools and model,
  and any step it needs still asks you.
- **A main assistant that checks on its own.** Pick one assistant and say what
  to look for (new mail that needs an answer, a note marked urgent). While the
  app is open it checks on the schedule you choose and writes an update. A
  check only reads: anything that would need your Approve is left for you.
- **A look at your screen.** Off until you turn it on for an assistant. Every
  look asks first, and the picture is never saved. It can only look.
- **Memory you can see.** Each assistant keeps up to 100 short notes you
  give it in its Memory section, and it can save one itself when you tell it
  something worth keeping. Every note it saves shows in the chat with Undo,
  and you can turn memory off for an assistant. A chat shows how full the
  model's window is, lets you forget a message or clear the chat, and offers
  to sum up the older messages when it gets long.
- **A computer of its own, in Docker.** Off until you turn it on for an
  assistant. A small Linux desktop (a browser, Python, a terminal) runs in a
  Docker container on this computer, never in a cloud. The assistant clicks,
  types and runs commands there without asking, because that computer has no
  network unless you allow it, no capabilities, limits on memory and
  processors, and no folder of yours but its own exchange folder. With its
  network on, a command, typing or a key press asks once the answer has read
  something of yours. Saving a file from it into one of your folders asks
  every time. You watch it beside
  the chat, and can pause it or take over. Needs Docker Desktop, Docker
  Engine, OrbStack, Colima or Podman. See [docs/COMPUTER.md](docs/COMPUTER.md).
- **Record how you work.** On an assistant's page, show it a task once:
  record your whole screen or one window (up to ten minutes), or pick a video
  you already have. A picture is kept every two seconds only when the screen
  changed, in memory, and no video is saved. Remove any picture, say what you
  were doing, and see how many pictures go to which model before anything is
  sent. Its own model drafts a skill (a name, a line and a few lines of
  guidance); you read and edit it, and only your Save keeps it, in a new "My
  skills" group you can edit, delete and tick for any assistant. A skill is
  guidance, never access. Your own skills travel in a backup, as text.
- **Tools on small models too.** A model that cannot call tools asks for them
  in writing, through the same approvals.
- **Move or back up.** One file with all your assistants, and your chats only
  if you tick that, to open on another computer. A single assistant can be
  shared as a file too. A file never holds a key, a model, a folder, a site or
  a connection.
- **Copy to StellarFirm cloud.** One button opens stellarfirm.ai in your
  browser with an assistant's name, look and brief, where you can hire it to
  work in the cloud. StellarFirm is a separate paid service with its own
  account and plans.
- **Light and dark**, following your computer or your choice.
- **Accessibility first.** More contrast, less motion, underlined links, a
  stronger focus ring, more space for reading, larger click targets, and read
  aloud with a voice on this computer only. Skip links, named landmarks, a
  keyboard shortcuts list (Ctrl or Cmd with /), and a screen reader is told
  when an answer is done or a step waits. The target is WCAG 2.2 AA; see
  [ACCESSIBILITY.md](ACCESSIBILITY.md) for what was tested and how to report a
  barrier.
- **First run** that finds a model already running on this computer, and says
  how to get one when there is none.

## What is not built yet

- **No control of your own desktop.** An assistant can click and type only on
  its own computer in Docker, never on your screen or in your apps. Driving
  your real desktop was considered and not built: it cannot be isolated, and
  one wrong click there reaches your mail, files and signed-in accounts.
- **No servers started as a command.** A connection is a web address. The
  only program the app starts is `docker`, for an assistant whose computer
  you turned on.
- **No sign-in with a company (Poppy).** Version 1.0 of the Personal Agent
  Protocol needs an identity that lives on a server, which an app that runs
  only on your computer does not have.
- **No signed installers and no automatic update.** Build from source, or use
  an unsigned release and check its sums. See
  [Install a release](#install-a-release) and
  [docs/RELEASING.md](docs/RELEASING.md).

## Privacy and safety

- Everything is saved in the app's data folder on this computer, as plain JSON.
- A key is sealed with the operating system's keychain before it touches the
  disk. It is read only in the main process, sent only to the address it was
  saved with, never to the page, and never shown again. With no keychain, a
  key is refused rather than saved in the clear; on Linux that means a running
  Secret Service keyring such as GNOME Keyring or KWallet.
- What an assistant reads is sent to the model you chose. With a model on this
  computer, it stays here. The same goes for the pictures you keep from a
  recording, and the screen says how many go to which model first.
- A remote model address must be `https`. Plain `http` is allowed only for a
  model on this computer. A model call never follows a redirect.
- The app has no telemetry and loads nothing from a CDN. It talks to the model
  you set up, the web pages you approved and the connections you added. Four
  more calls exist, and each starts only when you ask:
  - **Update check** (off by default). When you turn it on, or press "Check
    now", the app asks GitHub once a day which version is the newest. It sends
    nothing about you, and it never downloads or installs anything.
  - **Composio.** Adding or using a Composio connection contacts Composio with
    your own key.
  - **A reading language.** Downloading one from Settings fetches that one
    file from Hugging Face, and keeps it only if its SHA-256 matches.
  - **Look up a company.** Contacts the site you typed, once, and sends
    nothing but the request itself.
  - **Setting up an assistant's computer.** Docker downloads a Debian base
    image and its packages from Docker Hub and Debian's mirrors, on your
    click. With its network on, that computer reaches the internet on its
    own; it is off by default.
- Links to stellarfirm.ai, composio.dev, Docker's install page, Ollama's and
  LM Studio's download pages, and this project's pages open in your browser,
  only on your click.

The full list of what the code enforces, and what it does not, is in
[SECURITY.md](SECURITY.md).

## Run it

From source, on macOS, Windows or Linux:

```bash
git clone https://github.com/astrocodelp/openstellarfirm.git
cd openstellarfirm
corepack enable        # or: npm install -g pnpm@10
pnpm install
pnpm dev
```

- **Node 22.13 or newer**: Node 22 or 24 LTS.
- **pnpm 10**, through Corepack (it comes with Node) or `npm install -g pnpm@10`.
- **The first `pnpm dev` downloads Electron**, about 100 MB, once.
- **A model.** Start Ollama or LM Studio with a model in it, or have a key for
  a service such as OpenAI or Anthropic. The first run looks for a model on
  this computer.
- **On Linux**, Electron needs the usual desktop libraries (on Debian or
  Ubuntu: `libgtk-3-0`, `libnss3`, `libgbm1` and `libasound2`), and saving a
  key needs a Secret Service keyring (see [Linux](#linux)).
- **Docker is optional.** Only an assistant's own computer needs it (Docker
  Desktop, Docker Engine, OrbStack, Colima or Podman).
- **`pnpm dev` and `pnpm dev:ui` use the same port** (5199): run one at a time.
- **The data folder** of `pnpm dev` is the installed app's own:
  `~/Library/Application Support/OpenStellarFirm` on a Mac,
  `%APPDATA%\OpenStellarFirm` on Windows, and `~/.config/OpenStellarFirm` on
  Linux. Settings, Your data, opens it.

```bash
pnpm dev        # the app, with hot reload
pnpm dev:ui     # only the screens, in a browser, on stand-in data
pnpm test       # offline tests
pnpm typecheck
pnpm lint
pnpm build      # dist/
pnpm package    # unsigned installers for this system, in release/
bash scripts/ci.sh   # everything the maintainers check, in one go
```

`pnpm package` builds unsigned. On a Mac it makes a `.dmg` and a `.zip` for
both Apple silicon and Intel, about 500 MB in all; `pnpm package:win` and
`pnpm package:linux` build for those systems. Signed releases are made with
the scripts in [docs/RELEASING.md](docs/RELEASING.md).

## How it is laid out

| Folder               | What                                                                                                                                                                                                                     |
| -------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `src/shared`         | Types, the pets, skills and model presets, the address checks, the system prompt, the assistant file format, the links to StellarFirm. No Node or DOM imports.                                                           |
| `src/main`           | The main process: the JSON store, sealed keys, the model wires, the folder, web, connection and screen tools, the loop that runs them, and the gate that asks you.                                                       |
| `src/preload`        | The only bridge between the page and the main process.                                                                                                                                                                   |
| `src/reader`         | The hidden window that opens PDFs and reads pictures on this computer, with PDF.js and Tesseract.js.                                                                                                                     |
| `src/renderer`       | The React screens, built on tokens in three stylesheets: `styles.css` (the tokens and most screens), `gallery.css` (the connections gallery) and `record.css` (Record how you work, your own skills, and their dialogs). |
| `resources/computer` | The Dockerfile and scripts an assistant's own computer is built from.                                                                                                                                                    |
| `personas`           | Starter personas, one JSON file each.                                                                                                                                                                                    |
| `build`              | The app icon, its Linux sizes, and the macOS entitlements.                                                                                                                                                               |
| `scripts`            | Build, licence, checks and release scripts.                                                                                                                                                                              |
| `docs`               | Releasing, the release notes template, an assistant's computer, and the maintainer assistant's instructions.                                                                                                             |

## Roadmap

1. **Signed releases** for macOS, Windows and Linux.
2. **Sign-ins for connections** (OAuth), kept in the keychain.
3. **More personas and skills** from the community.
4. **More for its own computer.** Copying a file into it from the chat, more
   tools in the image, and a virtual machine where one is available.
5. **Companies.** Acting for you at a company that supports the Personal
   Agent Protocol (Poppy), when the protocol allows agents on a device.

## Community

This is built in the open by the people who use it. Add a persona, try it on
your system, fix a bug, or build a roadmap item.

- [COMMUNITY.md](COMMUNITY.md): the promise the project keeps, where to talk,
  ways to help.
- [CONTRIBUTING.md](CONTRIBUTING.md): the rules for a pull request.
- [Discussions](https://github.com/astrocodelp/openstellarfirm/discussions):
  questions, ideas, personas.
- [CONTRIBUTORS.md](CONTRIBUTORS.md): everyone who helped.

## Licence

Apache License 2.0 with the Commons Clause: see [LICENSE](LICENSE) and
[NOTICE](NOTICE).

- You may use it, at home and at work, read it, change it and share it.
- You may not sell it without a commercial licence from Astro Code L.P. In
  the Commons Clause's own words, selling includes providing to others, for a
  fee or other consideration, "a product or service whose value derives,
  entirely or substantially, from the functionality of the Software". See
  [COMMERCIAL.md](COMMERCIAL.md).

Because selling is not allowed, this is not an "open source" licence in the
Open Source Initiative's sense: the project is source-available. Its code is
open to read, change and share, not to sell.

The licence covers this repository only. It does not cover StellarFirm cloud
(stellarfirm.ai), StellarFirm for Universities, for Scientists or for Course
Creators, or any other Astro Code software. "StellarFirm" and the pet
characters are marks of Astro Code L.P. OpenStellarFirm includes that mark.
If you share a changed version, give it its own name and look.

Other people's work inside a built app is listed in
[THIRD-PARTY-NOTICES.md](THIRD-PARTY-NOTICES.md); the build writes their full
licence texts to THIRD-PARTY-LICENSES.txt, which ships beside the app and opens
from Settings, About.
