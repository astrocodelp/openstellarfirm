# Community

OpenStellar is built in the open by the people who use it. The goal is
simple: personal assistants, each with its own persona (a coder, a legal
helper, a writer, a planner), that run on your own model, on your own
computer.

## The promise this project keeps

Every change is held to these. A pull request that breaks one is not merged.

1. **On your device.** Assistants, chats and settings are saved only on your
   computer. The project runs no server and has no account.
2. **Your model.** A model on this computer, your own key, or your own
   endpoint. What an assistant reads goes only to the model you chose.
3. **No cloud saving, no telemetry.** The app sends nothing about you or your
   use to anyone. Any network call beyond your model and the pages you
   approved is off until you turn it on, and the screen says what it does.
4. **You approve what reaches outside.** Reading a new site, and anything that
   could send, change or delete, waits for your click.
5. **You can leave with everything.** Export one assistant, or everything, as
   a plain file, and import it on another device.

If you want assistants that work in the cloud, as a team, around the clock,
that is [StellarFirm](https://stellarfirm.ai), a separate paid service by the
same team. You can copy an assistant there from the app. Nothing moves unless
you click.

## Where to talk

| Place                                                                            | Use it for                                                                    |
| -------------------------------------------------------------------------------- | ----------------------------------------------------------------------------- |
| [Discussions](https://github.com/astrocodelp/worker-bot-open-source/discussions) | Questions, ideas, showing what you made, sharing a persona before you send it |
| [Issues](https://github.com/astrocodelp/worker-bot-open-source/issues)           | A bug you can reproduce, or a piece of work that is agreed and ready to build |
| [Security tab](https://github.com/astrocodelp/worker-bot-open-source/security)   | A security problem. Report it privately, never in public                      |

Discussion categories:

- **Announcements**: releases and decisions, from the maintainers.
- **Q&A**: setting up a model, a persona, a folder.
- **Ideas**: what the app should do next. An idea becomes an issue when it is
  agreed and small enough to build.
- **Personas**: share an assistant you made and get feedback.
- **Show and tell**: what you built with it.

## Ways to help

- **Add a persona.** One JSON file in [`personas/`](personas). The easiest
  first contribution. See [`personas/README.md`](personas/README.md).
- **Try it on your system** and report what breaks: Windows and Linux most of
  all, and local models of every size.
- **Fix a bug** labelled `good first issue`.
- **Build a roadmap item.** Comment on its issue first so two people do not
  build the same thing.
- **Improve the words.** Plain English that a person who is not a developer
  can follow.
- **Answer a question** in Discussions.

Start with [CONTRIBUTING.md](CONTRIBUTING.md).

## How decisions are made

- The roadmap is public, in the README.
- Small changes are decided in the pull request.
- A change to the promise above, to the security rules in
  [SECURITY.md](SECURITY.md), or to the licence is decided by the maintainers
  at Astro Code L.P., after a public discussion.
- A maintainer assistant (an AI agent) helps run this community: it sorts new
  issues, answers common questions, checks pull requests against the rules and
  writes the weekly summary. It says that it is an AI when it writes. A person
  on the maintainer team approves every merge and every release. Its
  instructions are public in [`docs/maintainers/`](docs/maintainers).

## People

Everyone who has helped is listed in [CONTRIBUTORS.md](CONTRIBUTORS.md).

Be kind. The rules are in the [Code of Conduct](CODE_OF_CONDUCT.md).
