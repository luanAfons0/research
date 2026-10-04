/**
 * A Sweep reads each Source once into an Extract: the readable text of the
 * page, or the reason it could not be read (ADR-0001).
 *
 * The pages come from a real HTTP server on 127.0.0.1 that each test starts,
 * serving the fixtures in `tests/fixtures/sources/`, and the Sweep goes
 * through the real Plugin Server, as the Host speaks to it.
 */
import { strict as assert } from 'node:assert';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import test from 'node:test';
import { startedAndShaken, structureOf } from './helpers/plugin.ts';
import { nobodyThere, PAGES, serveSources } from './helpers/sources.ts';
import {
  ended,
  sweepNamed,
  sweepOf,
  sweptWhole,
  topicWith,
  until,
  type Extract,
} from './helpers/sweeps.ts';

/** The one Extract of a Sweep of one Source. */
async function extractOf(t: test.TestContext, path: string, env = {}): Promise<Extract> {
  const sources = await serveSources(t);
  const plugin = await startedAndShaken(t, { env });
  const sweep = await sweptWhole(plugin, [sources.address(path)]);
  assert.equal(sweep.extracts.length, 1);
  return sweep.extracts[0]!;
}

test('an article with menus gives the text of its article, and none of the menus, scripts or forms', async (t) => {
  const extract = await extractOf(t, '/article.html');

  assert.equal(extract.state, 'read');
  assert.equal(
    extract.text,
    [
      'Node.js 24.0.0 (Current)',
      'By the Node.js release team',
      'This release updates the V8 JavaScript engine to 13.6 & upgrades npm to version 11, and ' +
        'it promotes several features to stable.',
      'Notable changes',
      'The URLPattern API is now a global — you use it without an import.',
      'The permission model flag changes from --experimental-permission to --permission, and ' +
        'it is no longer experimental.',
      '- Float16Array\n- RegExp.escape — at last\n- Explicit resource management with <using>',
    ].join('\n\n'),
  );
  assert.equal(extract.characters, extract.text?.length);
  assert.equal(extract.contentType, 'text/html');
  assert.equal(extract.reason, null);
  assert.equal(extract.note, null);
  assert.ok(!Number.isNaN(Date.parse(extract.readAt ?? '')), String(extract.readAt));
});

test('a page with no article gives the text of its main part, with its entities decoded', async (t) => {
  const extract = await extractOf(t, '/no-article.html');

  assert.equal(extract.state, 'read');
  const text = extract.text ?? '';
  assert.ok(text.startsWith('Notas de versão\n\nEsta versão traz uma correção'), text);
  assert.ok(!text.includes('Cookie banner'), text);
  assert.ok(!text.includes('after the main part'), text);
  assert.ok(!text.includes('Notas\n'), 'the title became text');
});

test('a page with neither an article nor a main part gives the text of its body', async (t) => {
  const extract = await extractOf(t, '/body-only.html');

  assert.ok(extract.text?.startsWith('Changelog\n\nA page with no article'), String(extract.text));
  assert.ok(!extract.text?.includes('Menu entry'), String(extract.text));
  assert.ok(!extract.text?.includes('Footer text'), String(extract.text));
  assert.ok(!extract.text?.includes('neither an article'), 'the title became text');
});

test('a page that is empty without JavaScript is kept and marked, with a note that says so', async (t) => {
  const extract = await extractOf(t, '/needs-javascript.html');

  assert.equal(extract.state, 'thin');
  assert.equal(extract.text, 'Loading…');
  assert.equal(extract.characters, 8);
  assert.equal(extract.note, 'Little text (8 characters). The page may need JavaScript.');
  assert.equal(extract.reason, null);
});

test('plain text is kept as it is, and none of it is read as HTML', async (t) => {
  const extract = await extractOf(t, '/notes.txt');

  assert.equal(extract.state, 'read');
  assert.equal(extract.contentType, 'text/plain');
  assert.equal(extract.text, (await readFile(join(PAGES, 'notes.txt'), 'utf8')).trim());
});

test('a PDF is not read, and its Extract names its type', async (t) => {
  const extract = await extractOf(t, '/paper.pdf');

  assert.equal(extract.state, 'failed');
  assert.equal(extract.reason, 'not read: application/pdf');
  assert.equal(extract.contentType, 'application/pdf');
  assert.equal(extract.text, null);
  assert.equal(extract.characters, null);
});

test('a page that answers 404 gives an Extract with that status', async (t) => {
  const extract = await extractOf(t, '/missing');

  assert.equal(extract.state, 'failed');
  assert.equal(extract.reason, 'HTTP 404');
  assert.equal(extract.text, null);
});

test('a redirect is followed to the page it points at', async (t) => {
  const sources = await serveSources(t);
  const plugin = await startedAndShaken(t);

  const sweep = await sweptWhole(plugin, [sources.address('/moved')]);

  const [extract] = sweep.extracts;
  assert.equal(extract?.state, 'read');
  assert.equal(extract?.address, sources.address('/moved'));
  assert.ok(extract?.text?.startsWith('Node.js 24.0.0 (Current)'), String(extract?.text));
  assert.deepEqual(
    sources.requests().map((request) => request.path),
    ['/moved', '/article.html'],
  );
});

test('a page that never answers is given up after RESEARCH_FETCH_TIMEOUT_MS, with that reason', async (t) => {
  const started = Date.now();

  const extract = await extractOf(t, '/silent', { RESEARCH_FETCH_TIMEOUT_MS: '300' });

  assert.equal(extract.state, 'failed');
  assert.equal(extract.reason, 'no answer in 300 ms');
  assert.ok(Date.now() - started < 5_000, 'it waited far longer than its time');
});

test('a Source that cannot be reached gives the network error as its reason', async (t) => {
  const plugin = await startedAndShaken(t);

  const sweep = await sweptWhole(plugin, [await nobodyThere()]);

  const [extract] = sweep.extracts;
  assert.equal(extract?.state, 'failed');
  assert.match(extract?.reason ?? '', /^network error: .*ECONNREFUSED/);
});

test('a response over the size cap is not read', async (t) => {
  const extract = await extractOf(t, '/large');

  assert.equal(extract.state, 'failed');
  assert.equal(extract.reason, 'not read: larger than 5 MB');
  assert.equal(extract.text, null);
});

test('each request names research honestly in its User-Agent', async (t) => {
  const sources = await serveSources(t);
  const plugin = await startedAndShaken(t);

  await sweptWhole(plugin, [sources.address('/moved'), sources.address('/notes.txt')]);

  assert.equal(sources.requests().length, 3);
  for (const request of sources.requests()) {
    assert.equal(request.userAgent, 'research (FirstMate Plugin)');
  }
});

test('at most 4 Sources of one Sweep are read at the same time', async (t) => {
  const sources = await serveSources(t);
  const plugin = await startedAndShaken(t);
  const names = ['article.html', 'no-article.html', 'body-only.html', 'notes.txt', 'paper.pdf'];
  const topic = await topicWith(plugin, [
    ...names.map((name) => sources.address(`/held/${name}`)),
    sources.address('/held/article.html'),
  ]);

  const started = await sweepOf(plugin, topic);
  await until('four requests held', () => sources.held() === 4);
  await new Promise((later) => setTimeout(later, 100));

  assert.equal(sources.held(), 4, 'a fifth Source was read before one of the four ended');
  const reading = await sweepNamed(plugin, started.id);
  assert.deepEqual(
    reading.extracts.map((extract) => extract.state),
    ['reading', 'reading', 'reading', 'reading', 'waiting', 'waiting'],
  );
  sources.release();
  const sweep = await ended(plugin, started.id);
  assert.equal(sources.mostAtOnce(), 4);
  assert.equal(sources.requests().length, 6);
  assert.deepEqual(
    sweep.extracts.map((extract) => extract.n),
    [1, 2, 3, 4, 5, 6],
  );
});

test('every Extract keeps its number and its address, in the order of the Sources', async (t) => {
  const sources = await serveSources(t);
  const plugin = await startedAndShaken(t);
  const addresses = [
    sources.address('/article.html'),
    sources.address('/paper.pdf'),
    sources.address('/missing'),
  ];

  const sweep = await sweptWhole(plugin, addresses);

  assert.deepEqual(
    sweep.extracts.map((extract) => [extract.n, extract.address, extract.state]),
    [
      [1, addresses[0], 'read'],
      [2, addresses[1], 'failed'],
      [3, addresses[2], 'failed'],
    ],
  );
  assert.equal(sweep.sourceCount, 3);
  assert.equal(sweep.readCount, 1);
  const text = structureOf(await plugin.call('get_sweep', { id: sweep.id }));
  assert.deepEqual(text, { sweep });
});
