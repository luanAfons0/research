# The Digest comes from a command

research makes a Digest by running the command in `RESEARCH_DIGEST_COMMAND`.
It writes the prompt — the rules, the Topic's question and the Extracts of one
Sweep — to the command's stdin, and reads the Digest from its stdout. research
knows no model, holds no key and has no default command. This is the decision
scribe made for its Minutes (scribe ADR-0002), for the same reasons.

The command is a program and its arguments, started with no shell (ADR-0003).

Any tool that reads a prompt and prints text will do: a local model through
`ollama run`, or a cloud CLI such as `claude -p`.

## Considered Options

A model address and a key, set on the Plugin Page. The Plugin would then store
a key, and the choice of model would be a change to research rather than a
change to one variable.

FirstMate's Sampling. The Host does not have it yet. When it does, research may
ask the Host for a model instead, and this decision does not wait for it.

## Consequences

With no command set, or one that is not found, a Sweep still reads every
Source and keeps every Extract. Only the Digest is refused, with a sentence
that names `RESEARCH_DIGEST_COMMAND`.

An Extract is text from the web, and a page can write to the model as well as
to you: "ignore your rules and …". The prompt puts each Extract in a
`<source n="…">` tag and tells the model that what is inside is data. That
lowers the risk and does not remove it, so the README says to use a command
that has no tools. An agent with tools, given a prompt that a stranger wrote
part of, is the danger.

A model reads only so much text. Each Extract is cut at a fixed size before it
goes into the prompt, the page shows which Extracts were cut, and the whole
Extract stays stored. A Digest made from short Digests of each Source would
read any length, at the cost of many more calls to the model; that is the next
step if the cuts hurt.

A Digest can be made again from a stored Sweep, with no new fetch, after you
change the command or the question. The new Digest replaces the old one.

A command installed through nvm is not on the Host's service PATH, so it needs
its absolute path.
