# Personas

A persona is a starting point for a new assistant. The "New assistant" form
shows them as a gallery, by category, and searchable by name, role and skill.
Using one fills in a name, a look, a brief and its skills. The person can change all
of it, and nothing is saved until they save. A persona never sets a model,
a folder, a site or web access.

## Add one

1. Add one file here, such as `personas/designer.json`.
2. Run `pnpm test`. It checks every file in this folder.
3. Open a pull request.

Nothing else needs a change: the app bundles every file in this folder when it
is built.

## The file

It is the same format an exported assistant has, plus a one-line `summary` and
a `category` for the gallery. An import ignores both.

```json
{
  "format": "stellarfirm-open.assistant",
  "version": 1,
  "name": "Designer",
  "group": "Work",
  "pet": "pop",
  "color": "rose",
  "category": "design",
  "summary": "Helps you think through layouts and wording.",
  "brief": "You help me ...\nNever ...",
  "skills": ["design-brief", "wireframes", "write"]
}
```

| Field      | Rule                                                                                            |
| ---------- | ----------------------------------------------------------------------------------------------- |
| `format`   | Exactly `stellarfirm-open.assistant`.                                                           |
| `version`  | Exactly `1`.                                                                                    |
| `name`     | Up to 60 characters, one line. Unique among personas.                                           |
| `group`    | Up to 40 characters. The sidebar heading it sits under, such as `Work` or `Home`.               |
| `pet`      | One of `blip`, `glim`, `pop`, `puff`, `tally`, `drift`.                                         |
| `color`    | One of `lime`, `sky`, `nebula`, `rose`, `moon`.                                                 |
| `category` | One of `code`, `business`, `money-law`, `writing`, `learning`, `design`, `everyday`.            |
| `summary`  | Up to 120 characters. Shown in the gallery.                                                     |
| `brief`    | 4 to 10 short lines, up to 4,000 characters. What it does, how it answers, what it must not do. |
| `skills`   | 2 to 12 skill ids, each once, from `src/shared/catalog.ts` and `src/shared/skill-library.ts`.   |

No other field is allowed. There is no model, folder, site or web field on
purpose.

## Rules

- Write it in your own words. Copy nothing from another product, prompt
  collection or website.
- No brand name and no real person's name.
- Do not claim a tool or a licence it does not have. The app's tools are
  reading the folders a person picked and saving a new file there, reading web
  pages after the person approves each site, the connections the person adds,
  reading (never sending) the mail the person allows, asking another assistant
  the person allows, and one look at the screen when the person turns it on.
  Each of those is the person's choice in the form; a persona never brings one.
  An assistant cannot run programs.
- For law, tax, health, money and similar fields, add a safety line: it gives
  general information, it is not a professional, it cannot give advice for the
  person's own case, it asks which country applies, and it tells the person to
  check with a qualified professional. Never invent a law, a rate, a dose or a
  deadline.
- Plain, short English. Say "assistant", never a shorter nickname for one.

## Skills

A skill is a name, a one-line description and a few lines of guidance. Only
the guidance of the skills an assistant has ticked goes into its instructions,
so keep each one short: one to three plain sentences, at most 320 characters.
A skill is guidance, never access. To add one, add it to
`src/shared/skill-library.ts` under the right group, tick it in a persona, and
run `pnpm test`, which checks the ids, the lengths, the size of every
persona's instructions, and that no text names a service, a brand or a web
address.
