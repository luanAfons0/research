# A Source is read with plain fetch

research reads a Source with Node's own `fetch`, one request for the page at
the Source's address and none for the pages it links to. It finds the readable
text with an extractor of its own: it drops `script`, `style`, `nav`,
`header`, `footer` and `aside`, takes `<article>` or `<main>` when the page has
one, and keeps the headings and the paragraphs. It reads HTML and plain text
and nothing else.

`firstmate install` runs nothing it fetches, so it never runs `npm install`. A
Plugin with a runtime dependency is Stopped after an install until someone
runs that by hand. research has no runtime dependency for that reason, as
Scheduler and Worklog have none.

## Considered Options

- **A headless browser (Playwright and Chromium).** It reads a page that makes
  its text with JavaScript, but it is a large download, a slow start and a
  runtime dependency.
- **Mozilla Readability and an HTML parser.** Its text is better on news
  sites, but it is two runtime dependencies.
- **A crawl that follows links to a set depth.** It brings loops, scale and
  far more text than a model can read. You add a Source when you want one
  more page.

## Consequences

A page that makes its text with JavaScript gives an Extract with little or no
text, and the page says so. A PDF or an image is not read, and its Extract
says `not read` and the type.

Each request sends an honest User-Agent, `research (FirstMate Plugin)`, and
waits 30 seconds at most. research does not read `robots.txt`: each Source is
one page you chose by hand, as a person does in a browser.

If many of your Sources need a browser, this is the decision to revisit, and
the dependency is the cost.
