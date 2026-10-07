# research

research is a FirstMate Plugin. It reads the pages you list for a Topic,
keeps their text, and can make a Digest of them with a model you choose.

It is a Plugin like any other, so it borrows FirstMate's words unchanged —
Host, Plugin, Plugin Page, Plugin Server, Stopped, Notice. They are
defined once, in
[FirstMate's `CONTEXT.md`](https://github.com/luanAfons0/FirstMate/blob/main/CONTEXT.md),
and this file never redefines one.

## Language

**Topic**:
One subject you research: a name, an optional question, and its own list of
Sources.
_Avoid_: research (the Plugin's name), project, search, query

**Source**:
One web address in a Topic's list. research reads that page and no page it
links to.
_Avoid_: link (Worklog's Link), URL, site, bookmark

**Sweep**:
One pass over a Topic: every Source is read once, and then a Digest is made.
Every Sweep is kept, with the time it started, and only one Sweep of a Topic
runs at a time.
_Avoid_: run (Scheduler's Run), crawl, scrape, job, refresh

**Extract**:
The readable text of one Source, as one Sweep read it, or the reason it could
not be read.
_Avoid_: content, page, scrape, snapshot

**Digest**:
What a model writes from the Extracts of one Sweep, guided by the Topic's
question, in that question's language. Each point it makes cites the Source it
came from.
_Avoid_: summary, resume, report, answer

**Digest command**:
The program and its arguments that make a Digest: it reads a prompt on stdin
and prints the Digest on stdout. research knows no model; the operator chooses
this command.
_Avoid_: model, prompt command, LLM, shell line

**Settings view**:
The part of the Plugin Page, at `#settings`, where the operator sets the
Digest command, and sees who decides it and why it cannot be used.
_Avoid_: preferences, options, config page

**settings file**:
`settings.json`, in research's own directory beside `research.db`: what the
operator set in the Settings view. `RESEARCH_DIGEST_COMMAND` beats it.
_Avoid_: config, config file, preferences

## Relationships

- A Topic has many Sources. A Source belongs to one Topic.
- A Topic has many Sweeps. A Sweep has one Extract for each Source and at most
  one Digest.
- A Digest is made from the Extracts of one Sweep, and from no other Sweep's.
- A Scheduler Run may start a Sweep. The two are different things.
- A Sweep that ends sends one Notice: its Digest is ready, or it failed and
  why. A click on it opens the Topic. No Notice is lost: one that comes too
  soon after the last waits its turn.
- A Sweep reads the Sources a Topic had when it started. Deleting a Source
  keeps its old Extracts; deleting a Topic deletes its Sweeps.
- research knows no model. The Digest comes from a Digest command you choose,
  and without one the text of each Source is still kept.
- The Settings view writes the Digest command to the settings file. A Digest
  command that is wrong does not stop the Plugin Server. A variable that is
  wrong is ignored, and the Settings view says so; a settings file that is
  wrong refuses each Digest, and the Settings view says why.

## Flagged ambiguities

- "Research" is the Plugin's name. One subject is a **Topic**, never "a
  research".
- "Notification" is what a person says for a Notice. A Notice comes from the
  Plugin Server, never from the Plugin Page, so it reaches you with the page
  closed.
- "Resume" was used for the Digest. In English it means a CV, so the word is
  **Digest**.
