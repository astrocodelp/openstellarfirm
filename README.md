# OpenStellarFirm

A desktop app for personal AI assistants that run on your own computer, on a
model you choose. For macOS, Windows and Linux. The code is open: free to use,
change and share, not to sell.

You give each assistant a name, a look and a job. It thinks with your own
model: one that runs on this machine (Ollama, LM Studio), your own key, or your
own endpoint. There is no account, no server of ours, and no fee.

> **Early.** An assistant can talk, read and add files in folders you pick,
> read web pages you allow, use the tools of servers you connect, look at
> your screen when you approve, and, if you give it one, use a computer of its
> own in Docker. It cannot click, type or use your own apps.
> See [What is built](#what-is-built) and the [Roadmap](#roadmap).

Made by the team behind [StellarFirm](https://stellarfirm.ai), where a whole
team of AI Agent Assistants works for your company in the cloud.

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
  save a new file. It can never change, replace, move or delete one.
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
  processors, and no folder of yours but its own exchange folder. Saving a
  file from it into one of your folders asks every time. You watch it beside
  the chat, and can pause it or take over. Needs Docker Desktop, Docker
  Engine, OrbStack, Colima or Podman. See [docs/COMPUTER.md](docs/COMPUTER.md).
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
- **First run** that finds a model already running on this computer.

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
  [docs/RELEASING.md](docs/RELEASING.md).

## Privacy and safety

- Everything is saved in the app's data folder on this computer, as plain JSON.
- A key is sealed with the operating system's keychain before it touches the
  disk. It is read only in the main process, sent only to the address it was
  saved with, never to the page, and never shown again. With no keychain, a
  key is refused rather than saved in the clear.
- What an assistant reads is sent to the model you chose. With a model on this
  computer, it stays here.
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
- Links to stellarfirm.ai, composio.dev, Docker's install page and this
  project's pages open in your browser, only on your click.

The full list of what the code enforces, and what it does not, is in
[SECURITY.md](SECURITY.md).

## Run it

Needs Node 22 or newer and pnpm 10.

```bash
pnpm install
pnpm dev        # the app, with hot reload
pnpm dev:ui     # only the screens, in a browser, on stand-in data
pnpm test       # offline tests
pnpm typecheck
pnpm lint
pnpm build      # dist/
pnpm package    # an unsigned installer in release/
bash scripts/ci.sh   # everything the maintainers check, in one go
```

## How it is laid out

| Folder         | What                                                                                                                                                               |
| -------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `src/shared`   | Types, the pets, skills and model presets, the address checks, the system prompt, the assistant file format, the links to StellarFirm. No Node or DOM imports.     |
| `src/main`     | The main process: the JSON store, sealed keys, the model wires, the folder, web, connection and screen tools, the loop that runs them, and the gate that asks you. |
| `src/preload`  | The only bridge between the page and the main process.                                                                                                             |
| `src/renderer` | The React screens and one stylesheet built on tokens.                                                                                                              |
| `personas`     | Starter personas, one JSON file each.                                                                                                                              |
| `scripts`      | Build, checks and release scripts.                                                                                                                                 |
| `docs`         | Releasing, and the maintainer assistant's instructions.                                                                                                            |

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
- [Discussions](https://github.com/astrocodelp/worker-bot-open-source/discussions):
  questions, ideas, personas.
- [CONTRIBUTORS.md](CONTRIBUTORS.md): everyone who helped.

## Licence

Apache License 2.0 with the Commons Clause: see [LICENSE](LICENSE) and
[NOTICE](NOTICE).

- You may use it, at home and at work, read it, change it and share it.
- You may not sell it, or a product or service built on it, without a
  commercial licence from Astro Code L.P. See [COMMERCIAL.md](COMMERCIAL.md).

Because selling is not allowed, this is not an "open source" licence in the
Open Source Initiative's sense. The source is open to read, change and share.

The licence covers this repository only. It does not cover StellarFirm cloud
(stellarfirm.ai), StellarFirm for Universities, for Scientists or for Course
Creators, or any other Astro Code software. "StellarFirm" and the pet
characters are marks of Astro Code L.P.: if you share a changed version, give
it its own name and look.

Other people's work inside a built app is listed in
[THIRD-PARTY-NOTICES.md](THIRD-PARTY-NOTICES.md).
