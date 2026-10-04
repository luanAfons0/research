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

| Variable        | What it is                                          |
| --------------- | --------------------------------------------------- |
| `RESEARCH_NODE` | The Node 24 that `mcp` runs, when `PATH` has none.  |

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
Sources go with it.

## Tools

The Plugin Page and other Plugins use the same tools. A Topic is named by its
id. Each refusal is a JSON-RPC error with a sentence.

| Tool           | Arguments                              | What it answers                                         |
| -------------- | -------------------------------------- | ------------------------------------------------------- |
| `list_topics`  | none                                   | `topics`: each Topic with `sourceCount`, `lastSweepAt` and `lastSweepState` (null until it is swept). |
| `get_topic`    | `id`                                   | `topic`: its name, question, `sources` in order, and `sweeps` from new to old. |
| `create_topic` | `name`, `question` (optional), `sources` (optional list of addresses) | `topic`, as `get_topic` gives it. |
| `update_topic` | `id`, and any of `name`, `question`, `sources` | `topic`. What is not given is kept; `sources` replaces the whole list. |
| `delete_topic` | `id`                                   | `deleted`: the id and name of the Topic. Its Sources go with it. |

An address that is not `http:` or `https:` is refused with a sentence that
names it, and nothing is saved. That refusal also carries
`data: { field: "sources", index, address }`, with `index` counted from 0, so
a caller can point at the exact Source.

## Running it

`./mcp` is the Plugin Server, as the Host runs it: MCP over stdio.
`npm run check` checks the types and runs every test.
