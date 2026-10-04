---
version: 1
slug: "impeccable-mocks-ui-studio-research-html"
primary_target: ".impeccable/mocks/ui-studio/research.html"
related_targets: []
---

# research Plugin Page

Scope: the whole Plugin Page (`web/`), two views: Topic list and one Topic at `#topic/<id>`. Mode: Operate, with a Read core (the Digest).
Audience: one operator in FirstMate's window. Job: make a Topic, sweep it, read the Digest, trace each `[n]` to its Extract.
Constraints: no framework, no web font, no build (FirstMate ADR-0008); light and dark from the system; CONTEXT.md words.
Anti-goals (user): hidden failures; hard-to-read long text.
Quality bar (user): Readwise Reader.

## Direction contract

THESIS: research is a calm three-pane reader where the Digest owns the middle; it refuses the dashboard of cards and badges, and it never lets a failure hide.
OWN-WORLD: system UI faces; near-white panes on a faintly cool canvas (dark: deep graphite); one deep teal accent for actions, the selected Topic and `[n]` marks; red only for failure, amber only for cut or little text; 1px hairlines, 8px radius on controls only, no shadows on panes.
STORY: the operator sees every Topic and its last Sweep at a glance, opens one, reads the Digest at a 66ch measure, presses `[n]` to see the Extract it came from, and sees at once when a Sweep or a Source failed and what to do.
FIRST VIEWPORT: left rail 240px of Topics (name, Source count, last Sweep state); centre the Topic header (name, question, Sweep now, Edit, Delete), a status band when a Sweep runs or failed, then the Digest at 17px/1.65; right pane 320px: the Sweep picker on top, the numbered Extracts below with their marks.
FORM: the category standard (standing exit), chosen by the user; seed key 51355725.
FINISH: unreviewed and undocumented is unfinished; this build ends with the finish review, the verdict, DESIGN.md, and every shipping raster carrying its provenance
