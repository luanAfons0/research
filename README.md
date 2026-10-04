# research

A FirstMate Plugin that reads the pages you list for a subject, keeps their
text on your machine, and makes a Digest of what they say with a model you
choose.

You make a **Topic**: a name, an optional question, and its **Sources**, one
web address each. A **Sweep** reads each Source once into an **Extract**, and
then a model command writes the **Digest** from those Extracts, with `[n]`
marks that point back at each Source.

Read [`CONTEXT.md`](CONTEXT.md) for the words this project uses — Topic,
Source, Sweep, Extract, Digest — and [`docs/adr/`](docs/adr) for why a Source
is read with plain `fetch` and why the Digest comes from a command.

## What it needs

- **Node 24 or newer**, for TypeScript with no build step and for
  `node:sqlite`. The Host's service `PATH` often has only an older Node, so
  `mcp` looks for one in this order: `RESEARCH_NODE`, `node` on `PATH`, then
  every Node under nvm. With none, it says so in one sentence and the Plugin
  is Stopped.

research has no runtime dependency, so `firstmate install` gives you a Plugin
that runs as it is (ADR-0001).

## Settings

The Plugin Server reads these from its environment, which is the Host's:

| Variable                    | What it is                                                         |
| --------------------------- | ------------------------------------------------------------------ |
| `RESEARCH_NODE`             | The Node 24 that `mcp` runs, when `PATH` has none.                 |
| `RESEARCH_FETCH_TIMEOUT_MS` | How long one Source may take to answer, body and all. Default `30000`. |

When the Host runs as a systemd service, give it the settings with a drop-in,
which `firstmate service on` leaves alone:

```sh
systemctl --user edit firstmate
```

```ini
[Service]
Environment=RESEARCH_NODE=/home/you/.nvm/versions/node/v24.15.0/bin/node
```

## Install it

Register the directory where it lives, then restart the Host:

```sh
firstmate add research /absolute/path/to/research
systemctl --user restart firstmate
```

Then open the Index Page, find `research`, and open its Plugin Page.

research keeps its data in one file, `research.db`, in its own directory. Git
ignores it: it is your research, not the project's.

## Topics

A **Topic** is one subject: a name, an optional question, and its own list of
Sources. On the Plugin Page, press **New Topic**, and type the Sources one
address on each line. An address that is not `http` or `https` is refused, and
the page names its line. A Topic opens at `#topic/<id>`, so a reload or a link
lands on the same Topic. Deleting a Topic asks for confirmation first, and its
Sources and Sweeps go with it.

## Sweeps

Press **Sweep now** on a Topic. A **Sweep** reads each Source once, as one
page and no page it links to, and keeps an **Extract** of each: the readable
text of the page, or the reason it could not be read. The page shows how many
Sources are read while the Sweep runs, the Sweeps of the Topic from new to
old, and the Extracts of the one you pick. Press an Extract to read its whole
text; Escape closes it. Every Sweep is kept until you delete it with its trash
button.

How a Source is read (ADR-0001):

- with Node's own `fetch`, redirects followed, and the User-Agent
  `research (FirstMate Plugin)`;
- for 30 seconds at most, body and all (`RESEARCH_FETCH_TIMEOUT_MS`);
- at most 4 Sources of one Sweep at the same time;
- only `text/html` and `text/plain`, and only up to 5 MB. Any other type gives
  the Extract `not read: <type>`, a status that is not 2xx gives `HTTP <status>`,
  and a network error or a timeout gives its reason;
- from a page, research keeps the `<article>`, else the `<main>`, else the
  `<body>`, without scripts, styles, menus, headers, footers, asides and
  forms, as headings and paragraphs of plain text. A page with very little
  text is kept and marked: it may make its text with JavaScript, which research
  does not run.

A Sweep is `reading`, then `digesting`, then `done`, or `failed` with a reason.
research does not make a Digest yet, so a Sweep that reads its Sources ends
`failed` with the reason `no Digest command is set in RESEARCH_DIGEST_COMMAND`,
and keeps every Extract. A Sweep where no Source could be read ends `failed`
with that reason. Only one Sweep of a Topic runs at a time; Sweeps of different
Topics run at the same time. A Sweep reads the Sources the Topic had when it
started, so you can edit the Topic while it runs. If the Plugin Server stops
during a Sweep, the next start marks that Sweep `failed`: the Plugin Server
stopped before the Sweep ended.

## Tools

The Plugin Page and other Plugins use the same tools. A Topic is named by its
id. Each refusal is a JSON-RPC error with a sentence.

| Tool           | Arguments                              | What it answers                                         |
| -------------- | -------------------------------------- | ------------------------------------------------------- |
| `list_topics`  | none                                   | `topics`: each Topic with `sourceCount`, `lastSweepAt` and `lastSweepState` (null until it is swept). |
| `get_topic`    | `id`                                   | `topic`: its name, question, `sources` in order, and `sweeps` from new to old, each with `id`, `startedAt`, `endedAt`, `state`, `reason`, `sourceCount` and `readCount`. |
| `create_topic` | `name`, `question` (optional), `sources` (optional list of addresses) | `topic`, as `get_topic` gives it. |
| `update_topic` | `id`, and any of `name`, `question`, `sources` | `topic`. What is not given is kept; `sources` replaces the whole list. |
| `delete_topic` | `id`                                   | `deleted`: the id and name of the Topic. Its Sources and Sweeps go with it. |
| `sweep_topic`  | `id` (a Topic)                         | `sweep`, at once, as `get_topic` lists it. The reading goes on after the answer. Refused while a Sweep of that Topic runs, and for a Topic with no Sources. |
| `get_sweep`    | `id` (a Sweep), or `topic` alone        | `sweep`: its state, `reason`, `digest`, and `extracts`, each with `n`, `address`, `state` (`waiting`, `reading`, `read`, `thin` or `failed`), `text`, `characters`, `note`, `reason`, `contentType` and `readAt`. With `topic` alone, its latest Sweep, or null. |
| `delete_sweep` | `id` (a Sweep)                         | `deleted`: the id of the Sweep and of its Topic. Refused while that Sweep runs. |

An address that is not `http:` or `https:` is refused with a sentence that
names it, and nothing is saved. That refusal also carries
`data: { field: "sources", index, address }`, with `index` counted from 0, so
a caller can point at the exact Source.

## Running it

`./mcp` is the Plugin Server, as the Host runs it: MCP over stdio.
`npm run check` checks the types and runs every test.
