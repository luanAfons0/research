/**
 * The Plugin Page starts a Sweep, shows it while it reads, lists the Sweeps
 * of a Topic from new to old, marks each Extract, and opens one in the centre.
 *
 * The page's own scripts run as a browser runs them, against the real Plugin
 * Server, through `tests/helpers/page.ts`, and the Sources come from a real
 * HTTP server on 127.0.0.1. A test reads what a person would see.
 */
import { strict as assert } from 'node:assert';
import test from 'node:test';
import { openPage } from './helpers/page.ts';
import { startedAndShaken } from './helpers/plugin.ts';
import { nobodyThere, serveSources } from './helpers/sources.ts';
import { ended, sweepOf, topicWith, until } from './helpers/sweeps.ts';

test('Sweep now starts a Sweep, and the page shows it reading', async (t) => {
  const sources = await serveSources(t);
  const plugin = await startedAndShaken(t);
  const topic = await topicWith(plugin, [
    sources.address('/held/article.html'),
    sources.address('/held/notes.txt'),
  ]);
  const page = await openPage(t, plugin, `#topic/${topic}`);
  assert.equal(page.byId('sweep-now').disabled, false);
  assert.equal(page.byId('running').hidden, true);

  page.byId('sweep-now').click();
  await page.settled();

  assert.ok(page.called().includes('sweep_topic'));
  assert.equal(page.byId('running').hidden, false);
  assert.equal(page.byId('running-what').textContent, 'Reading 0 of 2 Sources');
  assert.match(
    page.byId('running-why').textContent,
    /^Started at .+\. The Digest is made when every Source is read\.$/,
  );
  assert.equal(page.byId('meter').style.getPropertyValue('--done'), '0');
  assert.equal(page.byId('failed').hidden, true);
  assert.equal(page.byId('sweep-now').disabled, true);
  assert.equal(
    page.byId('sweep-now').title,
    'A Sweep of this Topic is running. Wait for it to end.',
  );
  assert.equal(page.byId('digest').hidden, false);
  assert.equal(page.byId('digest-words').textContent, 'No Digest yet.');
  assert.equal(page.byId('digest-skeleton').hidden, false);
  assert.match(page.byId('rail-topics').innerHTML, /<span class="state running">Reading<\/span>/);
  assert.match(page.byId('sweeps').innerHTML, /<span class="state running">Reading<\/span>/);
  assert.match(
    page.byId('sweeps').innerHTML,
    /disabled title="A running Sweep cannot be deleted\."/,
  );
  sources.release();
});

test('each Source that is read now, and each that waits, says so', async (t) => {
  const sources = await serveSources(t);
  const plugin = await startedAndShaken(t);
  const names = ['article.html', 'no-article.html', 'body-only.html', 'notes.txt', 'paper.pdf'];
  const topic = await topicWith(
    plugin,
    names.map((name) => sources.address(`/held/${name}`)),
  );
  const sweep = await sweepOf(plugin, topic);

  const page = await openPage(t, plugin, `#topic/${topic}`);

  const extracts = page.byId('extracts').innerHTML;
  assert.equal(extracts.match(/data-m="reading"/g)?.length, 4);
  assert.equal(extracts.match(/data-m="wait"/g)?.length, 1);
  assert.equal(extracts.match(/<span class="mark">.*?Reading now<\/span>/g)?.length, 4);
  assert.match(extracts, /data-x="5" tabindex="-1"[^>]*><span class="n">5<\/span>/);
  assert.match(extracts, /<path d="M13\.5 8a5\.5 5\.5 0 1 1-1\.6-3\.9"\/>.*Reading now/);
  assert.match(extracts, /<circle cx="8" cy="8" r="2\.4"\/><\/svg>Waiting<\/span>/);
  assert.equal(page.byId('extracts-count').textContent, '0 of 5 read');
  page.pressIn('extracts', 'data-x', '5');
  await page.settled();
  assert.equal(page.byId('extract-view').hidden, true, 'a waiting Extract opened');
  page.pressIn('sweeps', 'data-delete-sweep', String(sweep.id));
  await page.settled();
  assert.ok(!page.called().includes('delete_sweep'), 'a running Sweep could be deleted');
  sources.release();
});

test('while a Sweep runs, the page asks again, and shows it fail for want of a Digest command', async (t) => {
  const sources = await serveSources(t);
  const plugin = await startedAndShaken(t);
  const topic = await topicWith(plugin, [sources.address('/held/article.html')]);
  const sweep = await sweepOf(plugin, topic);
  const page = await openPage(t, plugin, `#topic/${topic}`);
  assert.equal(page.byId('running').hidden, false);
  const asked = page.called().filter((name) => name === 'get_sweep').length;

  sources.release();
  await ended(plugin, sweep.id);
  page.later();
  await page.settled();

  assert.ok(page.called().filter((name) => name === 'get_sweep').length > asked);
  assert.equal(page.byId('running').hidden, true);
  assert.equal(page.byId('failed').hidden, false);
  assert.equal(page.byId('failed-what').textContent, 'Sweep failed: no Digest command is set');
  assert.equal(
    page.byId('failed-why').innerHTML,
    'Set <code>RESEARCH_DIGEST_COMMAND</code> where the Host starts, then make the Digest ' +
      'again. The 1 Extract this Sweep read is kept.',
  );
  assert.equal(
    page.byId('digest-words').textContent,
    'This Sweep has no Digest. Open an Extract on the right to read what research kept.',
  );
  assert.equal(page.byId('digest-skeleton').hidden, true);
  assert.equal(page.byId('sweep-now').disabled, false);
  assert.match(
    page.byId('rail-topics').innerHTML,
    /<span class="state failed">Sweep failed<\/span>/,
  );
  assert.match(page.byId('sweeps').innerHTML, /<span class="state failed">Failed<\/span>/);
  assert.equal(page.byId('extracts-count').textContent, '1 of 1 read');
});

test('a Sweep that read no Source says so in its band', async (t) => {
  const sources = await serveSources(t);
  const plugin = await startedAndShaken(t);
  const topic = await topicWith(plugin, [sources.address('/missing')]);
  await ended(plugin, (await sweepOf(plugin, topic)).id);

  const page = await openPage(t, plugin, `#topic/${topic}`);

  assert.equal(page.byId('failed-what').textContent, 'Sweep failed: no Source could be read');
  assert.equal(
    page.byId('failed-why').innerHTML,
    'Each Extract on the right says why. Check the addresses, then Sweep again.',
  );
});

test('the Topic list shows a running Sweep, and its end without a reload', async (t) => {
  const sources = await serveSources(t);
  const plugin = await startedAndShaken(t);
  const topic = await topicWith(plugin, [sources.address('/held/notes.txt')]);
  const sweep = await sweepOf(plugin, topic);
  const page = await openPage(t, plugin);
  assert.match(page.byId('rows').innerHTML, /<span class="state running">Reading<\/span>/);

  sources.release();
  await ended(plugin, sweep.id);
  page.later();
  await page.settled();

  assert.match(page.byId('rows').innerHTML, /<span class="state failed">Sweep failed<\/span>/);
});

test('each Extract carries its mark and its icon, as the mock draws them', async (t) => {
  const sources = await serveSources(t);
  const plugin = await startedAndShaken(t);
  const topic = await topicWith(plugin, [
    sources.address('/article.html'),
    sources.address('/needs-javascript.html'),
    sources.address('/paper.pdf'),
    sources.address('/missing'),
    await nobodyThere(),
  ]);
  const sweep = await ended(plugin, (await sweepOf(plugin, topic)).id);

  const page = await openPage(t, plugin, `#topic/${topic}`);

  const items = page.byId('extracts').innerHTML.split('</li>');
  const read = sweep.extracts[0]?.characters ?? 0;
  assert.match(items[0] ?? '', /data-m="read" data-x="1" tabindex="0" role="button"/);
  assert.match(
    items[0] ?? '',
    /<span class="host">127\.0\.0\.1:\d+<\/span><span class="path">\/article\.html<\/span>/,
  );
  assert.match(
    items[0] ?? '',
    new RegExp(
      `<path d="M3 8\\.5l3\\.2 3L13 4\\.5"/></svg>${read.toLocaleString('en')} characters</span>`,
    ),
  );
  assert.match(items[1] ?? '', /data-m="thin"/);
  assert.match(
    items[1] ?? '',
    /<\/svg>Little text \(8 characters\)\. The page may need JavaScript\.<\/span>/,
  );
  assert.match(items[2] ?? '', /data-m="fail"/);
  assert.match(items[2] ?? '', /<\/svg>Not read: application\/pdf<\/span>/);
  assert.match(items[3] ?? '', /data-m="fail".*<\/svg>HTTP 404<\/span>/);
  assert.match(items[4] ?? '', /data-m="fail".*<\/svg>Network error: [^<]*ECONNREFUSED/);
  assert.match(items[2] ?? '', /<path d="M8 1\.8l6\.5 11\.4h-13z"\/>/);
  assert.equal(page.byId('extracts-count').textContent, '2 of 5 read');
});

test('pressing an Extract opens its whole text in the centre, and Escape closes it', async (t) => {
  const sources = await serveSources(t);
  const plugin = await startedAndShaken(t);
  const topic = await topicWith(plugin, [sources.address('/article.html')]);
  await ended(plugin, (await sweepOf(plugin, topic)).id);
  const page = await openPage(t, plugin, `#topic/${topic}`);

  page.pressIn('extracts', 'data-x', '1');
  await page.settled();

  assert.equal(page.byId('extract-view').hidden, false);
  assert.equal(page.byId('topic-main').hidden, true);
  assert.equal(page.byId('extract-n').textContent, '1');
  assert.match(page.byId('extract-host').textContent, /^127\.0\.0\.1:\d+$/);
  assert.equal(
    page.byId('extract-address').textContent,
    `${page.byId('extract-host').textContent}/article.html`,
  );
  assert.match(page.byId('extract-when').textContent, /^Read at .+ in the Sweep of .+\.$/);
  assert.equal(page.byId('extract-source').getAttribute('href'), sources.address('/article.html'));
  assert.equal(page.byId('extract-back').getAttribute('href'), `#topic/${topic}`);
  assert.equal(page.byId('extract-thin').hidden, true);
  assert.equal(page.byId('extract-failed').hidden, true);
  assert.match(
    page.byId('extract-text').innerHTML,
    /^<p>Node\.js 24\.0\.0 \(Current\)<\/p><p>By the Node\.js release team<\/p>/,
  );
  assert.match(
    page.byId('extract-text').innerHTML,
    /<p>- Float16Array<br>- RegExp\.escape — at last<br>- Explicit resource management with &lt;using&gt;<\/p>$/,
  );
  assert.match(page.byId('extracts').innerHTML, /class="x open" data-m="read" data-x="1"/);

  page.key('Escape');
  await page.settled();

  assert.equal(page.byId('extract-view').hidden, true);
  assert.equal(page.byId('topic-main').hidden, false);
  assert.equal(page.hash(), `#topic/${topic}`);
});

test('an Extract with little text, and one that failed, open with a note that says why', async (t) => {
  const sources = await serveSources(t);
  const plugin = await startedAndShaken(t);
  const topic = await topicWith(plugin, [
    sources.address('/needs-javascript.html'),
    sources.address('/missing'),
  ]);
  await ended(plugin, (await sweepOf(plugin, topic)).id);
  const page = await openPage(t, plugin, `#topic/${topic}`);

  page.pressIn('extracts', 'data-x', '1');
  await page.settled();

  assert.equal(page.byId('extract-thin').hidden, false);
  assert.equal(
    page.byId('extract-thin-why').textContent,
    'The page gave only 8 characters. It may make its text with JavaScript, which research does not run.',
  );
  assert.equal(page.byId('extract-text').innerHTML, '<p>Loading…</p>');
  page.byId('extract-back').click();
  await page.settled();
  assert.equal(page.byId('extract-view').hidden, true);

  page.pressIn('extracts', 'data-x', '2');
  await page.settled();

  assert.equal(page.byId('extract-failed').hidden, false);
  assert.equal(page.byId('extract-failed-what').textContent, 'HTTP 404.');
  assert.equal(page.byId('extract-thin').hidden, true);
  assert.equal(page.byId('extract-text').innerHTML, '');
});

test('the Sweeps are listed new to old; one is picked, and one is deleted with its trash button', async (t) => {
  const sources = await serveSources(t);
  const plugin = await startedAndShaken(t);
  const topic = await topicWith(plugin, [sources.address('/notes.txt')]);
  const first = await ended(plugin, (await sweepOf(plugin, topic)).id);
  await plugin.call('update_topic', { id: topic, sources: [sources.address('/missing')] });
  const second = await ended(plugin, (await sweepOf(plugin, topic)).id);
  const page = await openPage(t, plugin, `#topic/${topic}`);

  const listed = page.byId('sweeps').innerHTML;
  assert.ok(
    listed.indexOf(`data-sweep="${second.id}"`) < listed.indexOf(`data-sweep="${first.id}"`),
  );
  assert.match(
    listed,
    new RegExp(`<li class="sweep on"><button type="button" class="pick" data-sweep="${second.id}"`),
  );
  assert.match(page.byId('extracts').innerHTML, /HTTP 404/);

  page.pressIn('sweeps', 'data-sweep', String(first.id));
  await page.settled();

  assert.match(
    page.byId('sweeps').innerHTML,
    new RegExp(`<li class="sweep on"><button type="button" class="pick" data-sweep="${first.id}"`),
  );
  assert.match(page.byId('extracts').innerHTML, /\/notes\.txt/);
  assert.equal(page.byId('failed-what').textContent, 'Sweep failed: no Digest command is set');

  page.pressIn('sweeps', 'data-delete-sweep', String(first.id));
  await page.settled();

  assert.ok(page.called().includes('delete_sweep'));
  assert.doesNotMatch(page.byId('sweeps').innerHTML, new RegExp(`data-sweep="${first.id}"`));
  assert.match(
    page.byId('sweeps').innerHTML,
    new RegExp(`<li class="sweep on"><button type="button" class="pick" data-sweep="${second.id}"`),
  );
});

test('a Topic never swept shows an empty list of Sweeps on the right, and no Digest', async (t) => {
  const plugin = await startedAndShaken(t);
  const topic = await topicWith(plugin, ['https://nodejs.org/en/blog/release/v24.0.0']);

  const page = await openPage(t, plugin, `#topic/${topic}`);

  assert.equal(page.byId('side-topic').hidden, false);
  assert.equal(page.byId('no-sweeps').hidden, false);
  assert.equal(page.byId('extracts-part').hidden, true);
  assert.equal(page.byId('digest').hidden, true);
  assert.equal(page.byId('running').hidden, true);
  assert.equal(page.byId('failed').hidden, true);
});

test('a Topic with no Sources cannot be swept from the page', async (t) => {
  const plugin = await startedAndShaken(t);
  const topic = await topicWith(plugin, []);

  const page = await openPage(t, plugin, `#topic/${topic}`);

  assert.equal(page.byId('sweep-now').disabled, true);
  assert.equal(page.byId('sweep-now').title, 'Add a Source first.');
});

test('the edit form says a Sweep is running, and keeps the Sweeps on the right', async (t) => {
  const sources = await serveSources(t);
  const plugin = await startedAndShaken(t);
  const topic = await topicWith(plugin, [sources.address('/held/notes.txt')]);
  await sweepOf(plugin, topic);
  await until('the Source is asked for', () => sources.held() === 1);

  const page = await openPage(t, plugin, `#topic/${topic}/edit`);

  assert.equal(page.byId('form-running').hidden, false);
  assert.equal(page.byId('side-topic').hidden, false);
  assert.match(page.byId('sweeps').innerHTML, /Reading/);
  page.byId('f-name').value = 'Typed, not saved';
  page.later();
  await page.settled();
  assert.equal(page.byId('f-name').value, 'Typed, not saved', 'the poll wrote over the form');
  sources.release();
});
