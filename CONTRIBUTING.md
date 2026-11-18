# Contributing

Thank you for helping. A few rules keep the app small and safe.

## Before you open a pull request

```bash
pnpm lint && pnpm typecheck && pnpm test && pnpm build
```

## Rules

- **Tests are offline.** Inject `fetch`; mark stand-in addresses `stub://`.
  Never call a real model or service from a test.
- **Keys stay in the main process.** Never send a key to the page, put one in
  an address, a log, an error or a file in the clear.
- **One model client.** Every model call goes through `src/main/models.ts`.
- **The page gets no Node.** New abilities are a typed call in
  `src/shared/types.ts`, handled in `src/main`, exposed in `src/preload`.
- **No network calls of the app's own.** No telemetry, no CDN, no update check
  without the person turning it on.
- **Copy.** Plain English. An assistant is an "assistant". Say what is true:
  if a feature is not built, the screen must not suggest it is.
- **Design.** Use the tokens in `src/renderer/src/styles.css`. One lime button
  per view. Success is teal with an icon and a word. Every control has a name
  and a keyboard path.
- Keep a change small and in scope.

## Licence

By contributing you agree that your contribution is licensed under the
[MIT licence](LICENSE).
