## What this changes

<!-- A short, plain description. -->

Open this against `main`. CI has to pass, and a maintainer approves it,
before a squash merge. The steps are in
[CONTRIBUTING.md](CONTRIBUTING.md#how-to-contribute).

## Checks

Please run these before you open the pull request, as in
[CONTRIBUTING.md](CONTRIBUTING.md):

```bash
pnpm lint && pnpm typecheck && pnpm test && pnpm build
```

- [ ] `pnpm lint`
- [ ] `pnpm typecheck`
- [ ] `pnpm test`
- [ ] `pnpm build`
