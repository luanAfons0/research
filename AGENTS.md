# research

research is a FirstMate Plugin. It reads the Sources of a Topic, keeps an
Extract of each in a Sweep, and makes a Digest of them with a command the
operator chooses. It is a Plugin Server with one SQLite file behind it, and a
Plugin Page.

Read [`CONTEXT.md`](CONTEXT.md) first. It defines every word this repo uses —
Topic, Source, Sweep, Extract, Digest — and the synonyms to avoid. It borrows
FirstMate's words (Host, Plugin, Plugin Page, Plugin Server, Stopped, Notice)
unchanged, from
[FirstMate's `CONTEXT.md`](https://github.com/luanAfons0/FirstMate/blob/main/CONTEXT.md).
Use those words in code, in comments, in tests, in issues and in commit
messages.

Read the ADR that covers the area you are about to change:
[`docs/adr/`](docs/adr), and FirstMate's own where the Host is involved
(0002, 0005, 0008, 0009, 0014). If your change contradicts one, say so out
loud instead of overriding it quietly.

## Commands

Run every command from the repository root.

| Command                                   | What it does                                  |
| ----------------------------------------- | --------------------------------------------- |
| `node --test`                             | Every test. This is the whole suite.          |
| `node --test tests/plugin-server.test.ts` | One test file, while you work on it.          |
| `npm install && npx tsc --noEmit`         | Check the types. `npm run typecheck` is the same. |
| `npm run check`                           | The types, then every test. CI runs it.       |
| `./mcp`                                   | The Plugin Server, as the Host runs it.       |

The environment variables are in the README's Settings table. Tests set every
one they need through `tests/helpers/plugin.ts`.

`npm run check` must pass before you call work done.

## Tech stack

- **Node 24**, which runs TypeScript with no build step and ships
  `node:sqlite`. No bundler, no transpiler, no watcher.
- **TypeScript 5.8**, `strict`, `noUncheckedIndexedAccess`,
  `erasableSyntaxOnly`. `typescript` is a dev dependency, used only to check
  the types.
- **No runtime dependency**, because `firstmate install` never runs
  `npm install` (ADR-0001). MCP over stdio is the Plugin's own JSON-RPC
  (`src/mcp.ts`); the data is `node:sqlite`.
- **The Page** is plain HTML, CSS and JavaScript in `web/`, served by the Host
  byte for byte (FirstMate ADR-0008). No framework, no web font, no CDN. The
  approved mock, `.impeccable/mocks/ui-studio/research.html`, is its
  reference: keep its tokens, class names and copy.

## Project structure

```
mcp            the executable the Host runs: find a Node 24, run src/main.ts.
src/           the Plugin Server. Every file is one job.
  main.ts      start-up: open research.db, serve the tools, close on stdin's end.
  store.ts     research.db: open it, move it up to the current schema version.
  tools.ts     the tools this Plugin ships, for the Page and for other Plugins.
  mcp.ts       the one connection to the Host: MCP over stdio.
web/           the Plugin Page, as the Host serves it.
  index.html   the three panes, drawn by app.js.
  rpc.js       request(), listTools() and call(): the Plugin Server, over POST rpc.
  app.js       what the page shows, from what the tools answer.
  markdown.js  the small Markdown renderer for the Digest, as Worklog's.
  app.css      the one stylesheet, ported from the mock.
tests/         one file per behaviour, plus helpers/ and fixtures/.
docs/adr/      the decisions that are expensive to reverse.
docs/agents/   how an agent works in this repo. See "Agent skills" below.
.impeccable/   the design context and the approved mock of the Plugin Page.
```

`research.db` is this machine's research, not the project's. Git ignores it.

## Code style

- A file starts with a header comment: what this file is, then why it is that
  way. Every exported name carries a one-line `/** … */`.
- Comments say **why**, in the project's words, and name the ADR when a
  decision is behind the code (`(ADR-0001)`, `(FirstMate ADR-0008)`).
- Plain functions and object literals. No classes, no default exports, no
  inheritance, no framework.
- `readonly` on every field of an exported type. Data in, data out.
- Node built-ins carry the `node:` prefix. Local imports carry the `.ts`
  extension, because Node runs the TypeScript directly.
- Single quotes, semicolons, two-space indent, lines under 100 columns. There
  is no formatter config; match the file you are in.
- Errors are sentences a person can act on, naming the tool and the field.
  A caller's mistake is `badInput(…)`, refused as bad arguments. Fail loudly
  and early; say nothing on stderr when nothing is wrong.

## Testing

`node --test`. No test imports a module of `src/`.

- **The Plugin Server**: `tests/helpers/plugin.ts` spawns the real `mcp`
  against a temporary Plugin directory and speaks to it exactly as the Host
  does, with or without the Notice capability in the handshake. A test sees
  what the Host sees: JSON-RPC lines on stdout, diagnostics on stderr, the
  exit code, and the files in the directory.
- **The Host's side of a Notice**: the same helper records each
  `firstmate/notice` with the time it came, and accepts it or refuses it as
  the test says (`answerNotice`, `tooSoon`).
- **The outside world comes from fixtures** in `tests/fixtures/`, never from
  mocks. Add a fixture rather than a mock.
- **The Page as bytes**: `tests/page.test.ts` reads `web/` off disk, and runs
  `rpc.js` in a `node:vm` context against the real Plugin Server.
  `tests/markdown.test.ts` runs `web/markdown.js` the same way.
- A test name is a sentence about behaviour:
  `'with no Node 24 anywhere, the wrapper says so in one sentence that names RESEARCH_NODE'`.

## Git workflow

- Branch `main`. The remote is GitHub: `luanAfons0/research`, so use `gh`.
- A commit subject is one imperative sentence in the project's own words, with
  no prefix, no scope and no ticket number: `Start the Plugin, or say why it
  cannot`.
- One commit is one whole, working change: code, tests and docs together.
- Never add attribution, co-author or "generated by" lines.

## Boundaries

✅ **Always**

- Read `CONTEXT.md` and the ADRs of the area first, and use their words.
- Keep tests black-box, through the seams above.
- Update `README.md` when you change a tool, its input or output, or an
  environment variable.
- Leave `npm run check` green.

⚠️ **Ask first**

- Any `git add`, `git commit`, `git push`, or anything that opens a PR.
- Adding a dependency of any kind.
- Changing the name, input or output of a tool: they are the contract with
  the Page and with other Plugins.
- A schema change to `research.db`. It is a new step at the end of `STEPS` in
  `src/store.ts`, never an edit to a step that shipped.
- Anything that reverses an ADR.
- Anything that writes inside `~/.firstmate`, or restarts the Host.

🚫 **Never**

- Follow a link from a Source, or read a page with a browser (ADR-0001).
- Hold a model address or a key. The Digest comes from the command the
  operator set (ADR-0002).
- Send a Notice the handshake did not offer, or from the Plugin Page.
- Load anything from a CDN, or name an absolute path in the Page.
- Print or commit a real `research.db`, FirstMate's token or `runtime.json`.

## Agent skills

### Issue tracker

Issues live as GitHub issues in `luanAfons0/research`, driven by the `gh` CLI.
See [`docs/agents/issue-tracker.md`](docs/agents/issue-tracker.md).

### Triage labels

The five canonical triage roles, each label string equal to its name. See
[`docs/agents/triage-labels.md`](docs/agents/triage-labels.md).

### Domain docs

Single-context: one `CONTEXT.md` and one `docs/adr/` at the repo root. See
[`docs/agents/domain.md`](docs/agents/domain.md).
