/**
 * The Plugin Page shows a Digest as formatted Markdown, with each `[n]` a
 * button that lights Extract n; says when the Digest is being made, or why it
 * was not; makes it again; and marks each Extract that was cut for the model.
 *
 * The page's own scripts run as a browser runs them, against the real Plugin
 * Server, through `tests/helpers/page.ts`. The Digest comes from the fixture
 * command, and the Sources from a real HTTP server on 127.0.0.1.
 */
import { strict as assert } from 'node:assert';
import { writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import test from 'node:test';
import { openPage } from './helpers/page.ts';
import { makeDirectory, startedAndShaken } from './helpers/plugin.ts';
import { serveSources } from './helpers/sources.ts';
import {
  commandOf,
  DIGEST_COMMAND,
  ended,
  sweepNamed,
  sweepOf,
  topicWith,
  until,
} from './helpers/sweeps.ts';

const WITH_COMMAND = { env: { RESEARCH_DIGEST_COMMAND: DIGEST_COMMAND } };

test('a Sweep with a Digest shows it as Markdown, with each [n] a button to its Extract', async (t) => {
  const sources = await serveSources(t);
  const plugin = await startedAndShaken(t, WITH_COMMAND);
  const topic = await topicWith(plugin, [
    sources.address('/article.html'),
    sources.address('/missing'),
  ]);
  await ended(plugin, (await sweepOf(plugin, topic)).id);

  const page = await openPage(t, plugin, `#topic/${topic}`);

  const digest = page.byId('digest-text').innerHTML;
  assert.equal(page.byId('digest-text').hidden, false);
  assert.equal(page.byId('no-digest').hidden, true);
  assert.equal(page.byId('digest-skeleton').hidden, true);
  assert.match(digest, /<h2>What changed<\/h2>/);
  assert.match(digest, /<strong>V8 13\.6<\/strong>/);
  assert.match(digest, /&lt;b&gt;no&lt;\/b&gt;/);
  assert.ok(!digest.includes('<b>'), digest);
  assert.match(
    digest,
    /<button type="button" class="cite" data-n="1" data-at="0" aria-label="Extract 1" aria-pressed="false">1<\/button>/,
  );
  assert.match(
    digest,
    /<button type="button" class="cite bad" data-n="2" data-at="2" aria-label="Extract 2" aria-pressed="false">2<\/button>/,
  );
  assert.ok(!digest.includes('[1]'), digest);
  assert.match(page.byId('digest-made').textContent, /^Made at .+ from 1 of 2 Sources$/);
  assert.equal(page.byId('running').hidden, true);
  assert.equal(page.byId('failed').hidden, true);
  assert.equal(page.byId('digest-again-head').hidden, false);
  assert.match(page.byId('rail-topics').innerHTML, /<span class="state ">Digest ready<\/span>/);
});

test('pressing [n] lights Extract n and scrolls it into view, and pressing it again clears it', async (t) => {
  const sources = await serveSources(t);
  const plugin = await startedAndShaken(t, WITH_COMMAND);
  const topic = await topicWith(plugin, [
    sources.address('/article.html'),
    sources.address('/notes.txt'),
  ]);
  await ended(plugin, (await sweepOf(plugin, topic)).id);
  const page = await openPage(t, plugin, `#topic/${topic}`);
  const asked = page.called().length;

  page.pressIn('digest-text', 'data-at', '2');
  await page.settled();

  assert.match(page.byId('extracts').innerHTML, /<li class="x hit" data-m="read" data-x="2"/);
  assert.doesNotMatch(page.byId('extracts').innerHTML, /class="x hit" data-m="read" data-x="1"/);
  assert.match(
    page.byId('digest-text').innerHTML,
    /data-n="2" data-at="2" aria-label="Extract 2" aria-pressed="true"/,
  );
  assert.match(
    page.byId('digest-text').innerHTML,
    /data-n="1" data-at="0" aria-label="Extract 1" aria-pressed="false"/,
  );
  assert.deepEqual(page.scrolled(), ['#extracts [data-x="2"]']);
  assert.equal(page.called().length, asked, 'pressing [n] asked the Plugin Server');

  page.pressIn('digest-text', 'data-at', '1');
  await page.settled();

  assert.match(page.byId('extracts').innerHTML, /<li class="x hit" data-m="read" data-x="1"/);
  assert.match(
    page.byId('digest-text').innerHTML,
    /data-at="0" aria-label="Extract 1" aria-pressed="true"/,
  );
  assert.match(
    page.byId('digest-text').innerHTML,
    /data-at="1" aria-label="Extract 1" aria-pressed="true"/,
  );

  page.pressIn('digest-text', 'data-at', '0');
  await page.settled();

  assert.doesNotMatch(page.byId('extracts').innerHTML, /class="x hit"/);
  assert.doesNotMatch(page.byId('digest-text').innerHTML, /aria-pressed="true"/);
  assert.equal(page.scrolled().length, 2, 'clearing the light scrolled');
});

test('opening an Extract clears the light of [n]', async (t) => {
  const sources = await serveSources(t);
  const plugin = await startedAndShaken(t, WITH_COMMAND);
  const topic = await topicWith(plugin, [
    sources.address('/article.html'),
    sources.address('/notes.txt'),
  ]);
  await ended(plugin, (await sweepOf(plugin, topic)).id);
  const page = await openPage(t, plugin, `#topic/${topic}`);
  page.pressIn('digest-text', 'data-at', '0');
  await page.settled();

  page.pressIn('extracts', 'data-x', '2');
  await page.settled();
  page.key('Escape');
  await page.settled();

  assert.doesNotMatch(page.byId('extracts').innerHTML, /class="x hit"/);
  assert.doesNotMatch(page.byId('digest-text').innerHTML, /aria-pressed="true"/);
});

test('while the Digest is made, the page says so with a meter that does not know how far', async (t) => {
  const sources = await serveSources(t);
  const hold = join(await makeDirectory(t), 'go');
  const plugin = await startedAndShaken(t, {
    env: { RESEARCH_DIGEST_COMMAND: DIGEST_COMMAND, RESEARCH_TEST_DIGEST_HOLD: hold },
  });
  const topic = await topicWith(plugin, [
    sources.address('/notes.txt'),
    sources.address('/missing'),
  ]);
  const sweep = await sweepOf(plugin, topic);
  await until(
    'the Sweep is digesting',
    async () => (await sweepNamed(plugin, sweep.id)).state === 'digesting',
  );

  const page = await openPage(t, plugin, `#topic/${topic}`);

  assert.equal(page.byId('running').hidden, false);
  assert.equal(page.byId('running-what').textContent, 'Making the Digest');
  assert.equal(
    page.byId('running-why').textContent,
    '1 of 2 Sources were read. A model on a CPU can take a few minutes.',
  );
  assert.ok(page.byId('meter').classList.contains('indeterminate'));
  assert.equal(page.byId('digest-words').textContent, 'The model is writing the Digest now.');
  assert.equal(page.byId('digest-skeleton').hidden, false);
  assert.equal(page.byId('digest-text').hidden, true);
  assert.equal(page.byId('digest-again-head').hidden, true);
  assert.match(
    page.byId('rail-topics').innerHTML,
    /<span class="state running">Making the Digest<\/span>/,
  );

  await writeFile(hold, '');
  await ended(plugin, sweep.id);
  page.later();
  await page.settled();

  assert.equal(page.byId('running').hidden, true);
  assert.equal(page.byId('digest-text').hidden, false);
  assert.match(page.byId('digest-text').innerHTML, /<h2>What changed<\/h2>/);
});

test('a Sweep with no Digest command offers to make the Digest again, and that makes it', async (t) => {
  const sources = await serveSources(t);
  const first = await startedAndShaken(t);
  const topic = await topicWith(first, [sources.address('/notes.txt')]);
  const sweep = await ended(first, (await sweepOf(first, topic)).id);
  first.stop();
  await first.ended();
  const plugin = await startedAndShaken(t, { directory: first.directory, ...WITH_COMMAND });
  const page = await openPage(t, plugin, `#topic/${topic}`);
  assert.equal(page.byId('failed-what').textContent, 'Sweep failed: no Digest command is set');
  assert.equal(page.byId('failed-acts').hidden, false);

  page.byId('digest-again').click();
  await page.settled();
  await ended(plugin, sweep.id);
  page.later();
  await page.settled();

  assert.ok(page.called().includes('make_digest'));
  assert.equal(page.byId('failed').hidden, true);
  assert.equal(page.byId('digest-text').hidden, false);
  assert.match(page.byId('digest-text').innerHTML, /The prompt had 1 Sources\./);
});

test('Make the Digest again says why, when it is refused', async (t) => {
  const sources = await serveSources(t);
  const plugin = await startedAndShaken(t);
  const topic = await topicWith(plugin, [sources.address('/notes.txt')]);
  await ended(plugin, (await sweepOf(plugin, topic)).id);
  const page = await openPage(t, plugin, `#topic/${topic}`);

  page.byId('digest-again').click();
  await page.settled();

  assert.equal(page.byId('sweep-trouble').hidden, false);
  assert.equal(page.byId('sweep-trouble-what').textContent, 'The Digest was not made');
  assert.match(
    page.byId('sweep-trouble-why').textContent,
    /^make_digest needs RESEARCH_DIGEST_COMMAND/,
  );
  assert.equal(page.byId('digest-again').disabled, false);
});

test('when the Digest command failed, the band says what it said', async (t) => {
  const sources = await serveSources(t);
  const plugin = await startedAndShaken(t, {
    env: { RESEARCH_DIGEST_COMMAND: DIGEST_COMMAND, RESEARCH_TEST_DIGEST_FAIL: '1' },
  });
  const topic = await topicWith(plugin, [sources.address('/notes.txt')]);
  await ended(plugin, (await sweepOf(plugin, topic)).id);

  const page = await openPage(t, plugin, `#topic/${topic}`);

  assert.equal(page.byId('failed-what').textContent, 'Sweep failed: the Digest command failed');
  assert.equal(
    page.byId('failed-why').innerHTML,
    'It exited with 3. It said: <code>pulling manifest / loading the model / ' +
      'Error: model &quot;nada&quot; not found</code>',
  );
  assert.equal(page.byId('failed-acts').hidden, false);
  assert.equal(page.byId('no-digest').hidden, false);
});

test('a Digest command that is not found is named in the band', async (t) => {
  const sources = await serveSources(t);
  const plugin = await startedAndShaken(t, {
    env: { RESEARCH_DIGEST_COMMAND: commandOf('no-such-model-runner') },
  });
  const topic = await topicWith(plugin, [sources.address('/notes.txt')]);
  await ended(plugin, (await sweepOf(plugin, topic)).id);

  const page = await openPage(t, plugin, `#topic/${topic}`);

  assert.equal(page.byId('failed-what').textContent, 'Sweep failed: the Digest command failed');
  assert.equal(
    page.byId('failed-why').innerHTML,
    '&quot;no-such-model-runner&quot; is not found on the PATH; give its absolute path in ' +
      '<code>RESEARCH_DIGEST_COMMAND</code>.',
  );
});

test('a Sweep that read no Source does not offer to make the Digest again', async (t) => {
  const sources = await serveSources(t);
  const plugin = await startedAndShaken(t, WITH_COMMAND);
  const topic = await topicWith(plugin, [sources.address('/missing')]);
  await ended(plugin, (await sweepOf(plugin, topic)).id);

  const page = await openPage(t, plugin, `#topic/${topic}`);

  assert.equal(page.byId('failed').hidden, false);
  assert.equal(page.byId('failed-acts').hidden, true);
});

test('a Digest is made again from its head, and the page shows it being made', async (t) => {
  const sources = await serveSources(t);
  const plugin = await startedAndShaken(t, WITH_COMMAND);
  const topic = await topicWith(plugin, [sources.address('/notes.txt')]);
  const sweep = await ended(plugin, (await sweepOf(plugin, topic)).id);
  const page = await openPage(t, plugin, `#topic/${topic}`);
  await plugin.call('update_topic', { id: topic, question: 'O que mudou?' });

  page.byId('digest-again-head').click();
  await page.settled();
  await ended(plugin, sweep.id);
  page.later();
  await page.settled();

  assert.ok(page.called().includes('make_digest'));
  assert.match(page.byId('digest-text').innerHTML, /The question was: O que mudou\?/);
});

test('a cut Extract is marked in the list, and opens with a note that says so', async (t) => {
  const sources = await serveSources(t);
  const plugin = await startedAndShaken(t, WITH_COMMAND);
  const topic = await topicWith(plugin, [sources.address('/notes.txt'), sources.address('/long')]);
  const sweep = await ended(plugin, (await sweepOf(plugin, topic)).id);
  const whole = (sweep.extracts[1]?.characters ?? 0).toLocaleString('en');
  const page = await openPage(t, plugin, `#topic/${topic}`);

  const items = page.byId('extracts').innerHTML.split('</li>');
  assert.match(items[0] ?? '', /data-m="read"/);
  assert.match(items[1] ?? '', /data-m="cut" data-x="2" tabindex="0"/);
  assert.match(
    items[1] ?? '',
    new RegExp(
      '<path d="M5\\.8 10L12 2\\.5M10\\.2 10L4 2\\.5"/></svg>' +
        `Cut: the model read 20,000 of ${whole} characters</span>`,
    ),
  );

  page.pressIn('extracts', 'data-x', '2');
  await page.settled();

  assert.equal(page.byId('extract-cut').hidden, false);
  assert.equal(
    page.byId('extract-cut-why').textContent,
    `The Digest was made from the first 20,000 of ${whole} characters. ` +
      'The whole text is kept below.',
  );
  assert.match(page.byId('extract-text').innerHTML, /The last line of the long Source\./);
  page.key('Escape');
  await page.settled();
  page.pressIn('extracts', 'data-x', '1');
  await page.settled();
  assert.equal(page.byId('extract-cut').hidden, true);
});
