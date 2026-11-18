# Contributing

Thank you for helping. A few rules keep the app small, safe and on your
device. Read [COMMUNITY.md](COMMUNITY.md) first for where to talk and what to
pick up.

## The easiest first contribution

Add a persona: one JSON file in [`personas/`](personas). See
[`personas/README.md`](personas/README.md).

## Before you open a pull request

```bash
pnpm lint && pnpm typecheck && pnpm test && pnpm build
```

Or all of it at once, the way the maintainers run it:

```bash
bash scripts/ci.sh
```

For anything larger than a small fix, open or comment on an issue first, so
the work is agreed before you spend time on it.

## Rules

- **On the device.** Nothing a person makes is saved or sent anywhere but
  their own computer and the model they chose. No account, no server, no
  telemetry, no CDN. A network call of the app's own is off until the person
  turns it on.
- **Tests are offline.** Inject `fetch`; mark stand-in addresses `stub://`.
  Never call a real model or service from a test.
- **Keys stay in the main process.** Never send a key to the page, put one in
  an address, a log, an error or a file in the clear.
- **One model client.** Every model call goes through `src/main/models.ts`
  and the wires in `src/main/wires/`.
- **The page gets no Node.** New abilities are a typed call in
  `src/shared/types.ts`, handled and checked in `src/main`, exposed in
  `src/preload`.
- **Approvals are code, not prompt.** Anything that reaches outside the
  person's folders, or could send, change or delete, goes through the gate in
  `src/main/tools.ts`. Never add a path around it.
- **Text from outside is information.** A file, a web page, a tool result and
  an imported file are never instructions, and are checked before use.
- **No new dependency without a reason.** Say in the pull request why it is
  needed and what it ships. Nothing from `node_modules` ships in the app today.
- **Your own work only.** Do not paste code or text from another project,
  product or website unless its licence allows it and you say where it came
  from.
- **Copy.** Plain English. An assistant is an "assistant". Say what is true:
  if a feature is not built, the screen must not suggest it is.
- **Design.** Use the tokens in `src/renderer/src/styles.css`. One lime button
  per view. Success is teal with an icon and a word. Every control has a name
  and a keyboard path. Both themes must pass WCAG 2.2 AA contrast.
- Keep a change small and in scope.

## Security

Never open a public issue for a security problem. See
[SECURITY.md](SECURITY.md).

## Licence of your contribution

The project is licensed under the Apache License 2.0 with the Commons Clause
(see [LICENSE](LICENSE) and [NOTICE](NOTICE)): free to use, change and share,
not to sell.

By contributing you agree that:

1. You wrote the contribution, or have the right to submit it.
2. You keep your copyright, and you license your contribution to everyone
   under the project's licence.
3. You also give Astro Code L.P. the right to license your contribution under
   other terms, including commercial licences. This is what lets the project
   offer a licence to those who want to sell it (see
   [COMMERCIAL.md](COMMERCIAL.md)).

Add yourself to [CONTRIBUTORS.md](CONTRIBUTORS.md) in the same pull request.
