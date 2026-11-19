# OpenStellarFirm

A desktop app for personal AI assistants that run on your own computer, on a
model you choose. For macOS, Windows and Linux. The code is open: free to use,
change and share, not to sell.

You give each assistant a name, a look and a job. It thinks with your own
model: one that runs on this machine (Ollama, LM Studio), your own key, or your
own endpoint. There is no account, no server of ours, and no fee.

> **Early.** An assistant can talk, read and add files in folders you pick,
> read web pages you allow, use the tools of servers you connect, and look at
> your screen when you approve. It cannot click, type or use your apps.
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
- **First run** that finds a model already running on this computer.

## What is not built yet

- **No control of your computer.** An assistant cannot click, type or use
  your apps.
- **No servers started as a command.** A connection is a web address. The app
  does not start programs.
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
  computer, it stays here. The same goes for the pictures you keep from a
  recording, and the screen says how many go to which model first.
- A remote model address must be `https`. Plain `http` is allowed only for a
  model on this computer. A model call never follows a redirect.
- The app has no telemetry and loads nothing from a CDN. It talks to the model
  you set up, the web pages you approved and the connections you added. Three
  more calls exist, and each starts only when you ask:
  - **Update check** (off by default). When you turn it on, or press "Check
    now", the app asks GitHub once a day which version is the newest. It sends
    nothing about you, and it never downloads or installs anything.
  - **Composio.** Adding or using a Composio connection contacts Composio with
    your own key.
  - **Look up a company.** Contacts the site you typed, once, and sends
    nothing but the request itself.
- Links to stellarfirm.ai, composio.dev and this project's pages open in your
  browser, only on your click.

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
4. **This computer.** Using your apps, with Take over and Pause, once it can
   be done safely.
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
