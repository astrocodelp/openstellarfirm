# StellarFirm Open

An open-source desktop app for personal AI assistants that run on your own
computer, on a model you choose. For macOS and Windows. MIT licensed.

You give each assistant a name, a look and a job. It thinks with your own
model: one that runs on this machine (Ollama, LM Studio), your own key, or your
own endpoint. There is no account, no server of ours, and no fee.

> **Early.** An assistant can talk, read and add files in folders you pick,
> and read web pages you allow. It cannot yet use your apps or your screen.
> See [What is built](#what-is-built) and the [Roadmap](#roadmap).

Made by the team behind [StellarFirm](https://stellarfirm.ai), where a whole
team of AI Agent Assistants works for your company in the cloud.

## What is built

- **Assistants you make your own.** Name, group, one of six pets in five
  colours, a brief in your own words, and skills (lines of guidance).
- **Your own model.** Any OpenAI-compatible address: Ollama and LM Studio on
  this computer, OpenAI, OpenRouter, Mistral, Together AI, or your own
  endpoint such as a LiteLLM gateway. An assistant can have a model of its own.
- **Chat that streams**, with Stop. Each assistant keeps its own chat.
- **Folders you pick.** An assistant can list, find and read files there, and
  save a new file. It can never change, replace, move or delete one.
- **Web pages, with your Approve.** It asks before it reaches a site for the
  first time. You can allow a site for good, and take that back.
- **Share an assistant as a file.** Export and import. A file never holds a
  key, a model, a folder or a site.
- **Copy to StellarFirm cloud.** One button opens stellarfirm.ai in your
  browser with an assistant's name, look and brief, where you can hire it to
  work in the cloud. StellarFirm is a separate service with its own account
  and plans.
- **First run** that finds a model already running on this computer.

## What is not built yet

- No use of your screen or your apps, and no connections (MCP).
- No Poppy (acting for you at a company).
- No native Claude or Gemini wire (use an OpenAI-compatible address for now).
- Tools need a model that supports tool calls. With one that does not, the
  assistant only talks, and says so.
- No light theme, no auto-update, no app icon. A release is unsigned until
  the certificates in [issue 4](https://github.com/astrocodelp/worker-bot-open-source/issues/4)
  are set, and the release says so.

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
- The app has no telemetry, no update check, and loads nothing from a CDN.
  The only calls it makes are to the model you set up and to the web pages you
  approved. A link to stellarfirm.ai opens in your browser, only on your click.

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
```

## Releases

A maintainer publishes installers by pushing a version tag (`v0.1.0`, or
`v0.1.0-rc.1` for a release candidate). The steps, the runners, and the
signing secrets are in [docs/releasing.md](docs/releasing.md). Signed builds
are still [issue 4](https://github.com/astrocodelp/worker-bot-open-source/issues/4).

## How it is laid out

| Folder         | What                                                                                                                                                |
| -------------- | --------------------------------------------------------------------------------------------------------------------------------------------------- |
| `src/shared`   | Types, the pets, skills and model presets, the address checks, the system prompt, the links to StellarFirm. No Node or DOM imports.                 |
| `src/main`     | The main process: the JSON store, sealed keys, the one model client, the folder and web tools, the loop that runs them, and the gate that asks you. |
| `src/preload`  | The only bridge between the page and the main process.                                                                                              |
| `src/renderer` | The React screens and one stylesheet built on tokens.                                                                                               |

## Roadmap

1. **Connections.** MCP servers by address or on this computer, with your own
   sign-ins kept in the keychain. Anything that sends, deletes or spends waits
   for your Approve.
2. **This computer.** The screen and apps, with Take over and Pause.
3. **Companies.** Acting for you at a company that supports the Personal Agent
   Protocol (Poppy).
4. **Releases.** The tag workflow publishes installers. Signed builds and
   updates are still to come
   ([issue 4](https://github.com/astrocodelp/worker-bot-open-source/issues/4)).

## Name and brand

The MIT licence covers the code. "StellarFirm" and the pet characters are
marks of Astro Code L.P. If you distribute a changed version, please give it
its own name and look.

## Contributing

Fork the repository and open a pull request against `main`. Only Astro Code
maintainers push to `main`, and they use pull requests too. The steps are in
[CONTRIBUTING.md](CONTRIBUTING.md).

## Licence

[MIT](LICENSE). Other people's work inside a built app is listed in
[THIRD-PARTY-NOTICES.md](THIRD-PARTY-NOTICES.md).
