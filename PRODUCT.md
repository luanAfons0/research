# Product

<!-- impeccable:product-schema 1 -->

## Platform

web

## Stack

Static HTML, CSS and JavaScript in `web/`, served unchanged by the FirstMate
Host (FirstMate ADR-0008). No framework, no build step, no web font, no
runtime dependency.

## Users

One operator, on their own machine, inside the FirstMate window (a webview on
Windows) or a browser on loopback. They research a subject by reading the same
set of pages again and again, and want that work done for them.

## Product Purpose

research is a FirstMate Plugin. For each Topic the operator lists Sources once.
A Sweep reads each Source into an Extract, then a Digest is made from those
Extracts by a model command the operator chooses. Success: the operator reads
one Digest instead of ten pages, and can trace every point back to its Source.

## Positioning

Local and traceable: the text is kept on the operator's machine, the model is
any command they choose, and every point of a Digest cites `[n]`, an Extract
they can open.

## Operating Context

- The operator opens the Plugin Page, makes a Topic, presses "Sweep now", and
  may close the page. A Notice tells them when the Sweep ends; a click opens
  `#topic/<id>`.
- `scheduler` can start Sweeps on a Cadence through the `sweep_topic` tool.
- The Topic view leads with the latest Digest: reading is the main job.

## Capabilities and Constraints

- Words (from `CONTEXT.md`): Topic, Source, Sweep, Extract, Digest, Notice.
  Never "run", "link", "summary", "resume", "notification".
- Sweep states: `reading`, `digesting`, `done`, `failed` (with a reason).
- Extract marks: cut before the model; little text (may need JavaScript);
  `not read: <type>`; `HTTP <status>`; a network error.
- Only `http` and `https` addresses; others are refused with a sentence.
- Without `RESEARCH_DIGEST_COMMAND`, a Sweep keeps its Extracts and ends
  `failed`, naming the variable.

## Product Principles

- Never hide a failure: a failed Source or Sweep is plain to see.
- Long text must be easy to read: the Digest and each Extract are read, not
  scanned.
- Every point traces back to a Source.

## Accessibility & Inclusion

Light and dark follow the system. Keyboard use and visible focus throughout.
