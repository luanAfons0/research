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

## Running it

`./mcp` is the Plugin Server, as the Host runs it: MCP over stdio.
`npm run check` checks the types and runs every test.
