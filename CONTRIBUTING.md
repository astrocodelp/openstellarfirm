# Contributing

Thank you for helping. A few rules keep the app small and safe.

## How to contribute

Only Astro Code maintainers push to `main`. Everyone else forks this
repository and opens a pull request.

1. Fork the repository and clone your fork.
2. Name the branch for the change, in lowercase with hyphens
   (`fix-copy-link`, `docs-releasing`).
3. Keep the branch in step with this repository's `main`. Add it once as
   `upstream`, then rebase before you open the pull request and again if
   `main` moves:

   ```bash
   git remote add upstream https://github.com/astrocodelp/worker-bot-open-source.git
   git fetch upstream
   git rebase upstream/main
   ```

   Push that branch to your fork.
4. Open the pull request against `main`.
5. CI has to pass. Run the checks in the next section first. The pull request
   runs them again.
6. A maintainer reviews it and approves it. The merge is a squash merge.

Maintainers open pull requests too. A direct push to `main` is for an
emergency, and the change still gets a pull request afterwards.

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
