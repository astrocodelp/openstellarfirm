# StellarFirm Open

An open-source desktop app for personal AI assistants that run on your own
computer, on a model you choose. For macOS and Windows. MIT licensed.

You give each assistant a name, a look and a job. It thinks with your own
model: one that runs on this machine (Ollama, LM Studio), your own key, or your
own endpoint. There is no account, no server of ours, and no fee.

> **Early.** This is the first working slice. Today an assistant can talk. It
> cannot yet open files, use apps or act for you. See [What is built](#what-is-built)
> and the [Roadmap](#roadmap).

Made by the team behind [StellarFirm](https://stellarfirm.ai), where a whole
team of AI Agent Assistants works for your company in the cloud.

## What is built

- **Assistants you make your own.** Name, group, one of six pets in five
  colours, a brief in your own words, and skills (lines of guidance).
- **Your own model.** Any OpenAI-compatible address: Ollama and LM Studio on
  this computer, OpenAI, OpenRouter, Mistral, Together AI, or your own
  endpoint such as a LiteLLM gateway. An assistant can have a model of its own.
- **Chat that streams**, with Stop. Each assistant keeps its own chat.
- **Share an assistant as a file.** Export and import. A file never holds a key
  or a model source.
- **First run** that finds a model already running on this computer.

## What is not built yet

Honest list, so nobody is surprised:

- No tools: an assistant cannot read files, browse, or use your apps.
- No computer use, no approvals, no connections (MCP), no Poppy.
- No native Claude or Gemini wire (use an OpenAI-compatible address for now).
- No light theme, no auto-update, no signed installers, no app icon.

## Privacy and safety

- Everything is saved in the app's data folder on this computer, as plain JSON.
- A key is sealed with the operating system's keychain before it touches the
  disk. It is read only in the main process, sent only to the address it was
  saved with, never to the page, and never shown again. With no keychain, a
  key is refused rather than saved in the clear.
- A remote model address must be `https`. Plain `http` is allowed only for a
  model on this computer. A model call never follows a redirect.
- The app makes no network call of its own: no telemetry, no update check, no
  fonts from a CDN. The only calls are the ones to the model you set up.
- The page runs sandboxed with context isolation and a strict Content Security
  Policy, and can reach the main process only through one typed bridge.

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

## How it is laid out

| Folder         | What                                                                                                     |
| -------------- | -------------------------------------------------------------------------------------------------------- |
| `src/shared`   | Types, the pets, skills and model presets, the address check, the system prompt. No Node or DOM imports. |
| `src/main`     | The main process: the JSON store, sealed keys, the one model client, and the calls the page can make.    |
| `src/preload`  | The only bridge between the page and the main process.                                                   |
| `src/renderer` | The React screens and one stylesheet built on tokens.                                                    |

## Roadmap

1. **Tools with approvals.** Read tools run on their own; anything that sends,
   deletes or spends waits for your Approve.
2. **This computer.** Folders you pick (nothing is deleted there), then the
   screen and apps, with Take over and Pause.
3. **Connections.** MCP servers by address or on this computer, with your own
   sign-ins kept in the keychain.
4. **Companies.** Acting for you at a company that supports the Personal Agent
   Protocol (Poppy).
5. **Releases.** Signed builds for macOS and Windows, with updates.

## Name and brand

The MIT licence covers the code. "StellarFirm" and the pet characters are
marks of Astro Code L.P. If you distribute a changed version, please give it
its own name and look.

## Licence

[MIT](LICENSE).
