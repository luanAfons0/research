/**
 * When a Sweep ends, research sends the operator one Notice through the Host
 * (FirstMate ADR-0014): `Digest ready` or `Sweep failed`, with the Topic, and
 * a path that opens that Topic. It sends none at any other moment.
 *
 * The test seam plays the Host's side of `firstmate/notice`: it records each
 * Notice with the time it came, and accepts it or refuses it as a test says,
 * with the Host's own sentences. Everything else is real: the Plugin Server
 * over stdio, the Sources over HTTP, and the fixture Digest command.
 */
import { strict as assert } from 'node:assert';
import { writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import test from 'node:test';
import { openPage } from './helpers/page.ts';
import {
  HOST_ERROR,
  makeDirectory,
  startedAndShaken,
  structureOf,
  tooSoon,
  type ReceivedNotice,
  type Refusal,
  type Started,
  type StartOptions,
} from './helpers/plugin.ts';
import { serveSources, type Sources } from './helpers/sources.ts';
import {
  DIGEST_COMMAND,
  ended,
  sweepNamed,
  sweepOf,
  topicWith,
  until,
} from './helpers/sweeps.ts';

/** A short gap between two Notices, so that a test does not wait 5 seconds for each. */
const SHORT_GAP = { RESEARCH_NOTICE_GAP_MS: '100' };

/** The longest title and body the Host takes, in characters (FirstMate ADR-0014). */
const TITLE_LIMIT = 64;
const BODY_LIMIT = 200;

/** How long a text is, in characters, as the Host counts them: by code point. */
function characters(text: unknown): number {
  return [...String(text)].length;
}

/** The Host's own check of a Notice's lengths: a refusal, as the Host words it, or none. */
function hostLengths(params: Readonly<Record<string, unknown>>): Refusal | undefined {
  const title = characters(params['title']);
  const body = characters(params['body']);
  if (title < 1 || title > TITLE_LIMIT) {
    return {
      code: HOST_ERROR,
      message: `The "title" of a Notice may be 64 characters long, and this one is ${title}.`,
    };
  }
  if (body > BODY_LIMIT) {
    return {
      code: HOST_ERROR,
      message: `The "body" of a Notice may be 200 characters long, and this one is ${body}.`,
    };
  }
  return undefined;
}

/** Wait this long, to see that nothing more comes. */
function quietFor(ms: number): Promise<void> {
  return new Promise((later) => setTimeout(later, ms));
}

/** A Plugin Server with the fixture Digest command and a short gap. */
function withCommand(
  t: Parameters<typeof startedAndShaken>[0],
  options: StartOptions = {},
): Promise<Started> {
  return startedAndShaken(t, {
    ...options,
    env: { RESEARCH_DIGEST_COMMAND: DIGEST_COMMAND, ...SHORT_GAP, ...options.env },
  });
}

/**
 * Topics whose Sweeps all wait on a held Source, so that they end at the same
 * moment when the test lets the Source go. Hands back their ids.
 */
async function heldSweeps(plugin: Started, sources: Sources, names: readonly string[]) {
  const topics: number[] = [];
  for (const name of names) {
    const topic = await topicWith(plugin, [sources.address('/held/article.html')], name);
    await sweepOf(plugin, topic);
    topics.push(topic);
  }
  await until('every Sweep waits on its Source', () => sources.held() === names.length);
  return topics;
}

/** What a Notice asked the Host to show, without the time it came. */
function shown(notice: ReceivedNotice | undefined): Readonly<Record<string, unknown>> {
  return notice?.params ?? {};
}

test('a Sweep that ends done sends Digest ready, how many Sources were read, and its Topic', async (t) => {
  const sources = await serveSources(t);
  const plugin = await withCommand(t);
  const topic = await topicWith(plugin, [
    sources.address('/article.html'),
    sources.address('/missing'),
  ]);

  const sweep = await ended(plugin, (await sweepOf(plugin, topic)).id);
  const [notice] = await plugin.untilNotices(1);

  assert.equal(sweep.state, 'done');
  assert.deepEqual(shown(notice), {
    title: 'Digest ready',
    body: 'Node 24 release — 1 of 2 Sources read.',
    path: `#topic/${topic}`,
  });
  await quietFor(300);
  assert.equal(plugin.notices().length, 1);
  assert.equal(plugin.output(), '');
});

test('a Sweep that ends failed sends Sweep failed, with its Topic and the reason', async (t) => {
  const sources = await serveSources(t);
  const plugin = await startedAndShaken(t, { env: SHORT_GAP });
  const topic = await topicWith(plugin, [sources.address('/notes.txt')], 'Release notes');

  await ended(plugin, (await sweepOf(plugin, topic)).id);
  const [notice] = await plugin.untilNotices(1);

  assert.deepEqual(shown(notice), {
    title: 'Sweep failed',
    body: 'Release notes — no Digest command is set in RESEARCH_DIGEST_COMMAND.',
    path: `#topic/${topic}`,
  });
});

test('a Sweep that read no Source sends Sweep failed with that reason', async (t) => {
  const sources = await serveSources(t);
  const plugin = await withCommand(t);
  const topic = await topicWith(plugin, [sources.address('/missing')]);

  await ended(plugin, (await sweepOf(plugin, topic)).id);
  const [notice] = await plugin.untilNotices(1);

  assert.equal(shown(notice)['title'], 'Sweep failed');
  assert.equal(shown(notice)['body'], 'Node 24 release — no Source could be read.');
});

test('a long Topic name and a long reason are shortened, so the Host never refuses them', async (t) => {
  const sources = await serveSources(t);
  const program = `/opt/models/${'very-long-directory/'.repeat(12)}runner`;
  const plugin = await startedAndShaken(t, {
    env: { RESEARCH_DIGEST_COMMAND: program, ...SHORT_GAP },
    answerNotice: hostLengths,
  });
  const words = await topicWith(
    plugin,
    [sources.address('/notes.txt')],
    `Research ${'on the long and winding road of releases '.repeat(8)}`.trim(),
  );
  // A letter outside the Basic Multilingual Plane is one character to the
  // Host, and two to JavaScript's `length`.
  const compass = await topicWith(plugin, [sources.address('/notes.txt')], '🧭'.repeat(300));

  await ended(plugin, (await sweepOf(plugin, words)).id);
  await ended(plugin, (await sweepOf(plugin, compass)).id);
  const notices = await plugin.untilNotices(2);

  for (const notice of notices) {
    assert.equal(notice.refused, undefined, JSON.stringify(notice));
    assert.equal(notice.params['title'], 'Sweep failed');
    const body = String(notice.params['body']);
    assert.ok(characters(body) <= BODY_LIMIT, body);
    assert.match(body, /… — the Digest command failed: "\/opt\/models\//);
    assert.ok(body.endsWith('….'), body);
  }
  const bodies = notices.map((notice) => String(notice.params['body']));
  assert.ok(bodies.some((body) => body.startsWith('Research on the long and winding road')));
  assert.ok(bodies.some((body) => body.startsWith('🧭🧭🧭')));
});

test('a long Topic name still leaves room for how many Sources were read', async (t) => {
  const sources = await serveSources(t);
  const plugin = await withCommand(t, { answerNotice: hostLengths });
  const topic = await topicWith(plugin, [sources.address('/notes.txt')], 'n'.repeat(400));

  await ended(plugin, (await sweepOf(plugin, topic)).id);
  const [notice] = await plugin.untilNotices(1);

  const body = String(shown(notice)['body']);
  assert.equal(notice?.refused, undefined);
  assert.ok(characters(body) <= BODY_LIMIT, body);
  assert.match(body, /^n+… — 1 of 1 Sources read\.$/);
});

test('a Notice waits the gap after the last one, and RESEARCH_NOTICE_GAP_MS sets it', async (t) => {
  const sources = await serveSources(t);
  const plugin = await withCommand(t, { env: { RESEARCH_NOTICE_GAP_MS: '600' } });
  await heldSweeps(plugin, sources, ['First', 'Second']);

  sources.release();
  const [first, second] = await plugin.untilNotices(2);

  assert.ok(first !== undefined && second !== undefined);
  assert.ok(second.at - first.at >= 590, `${second.at - first.at} ms apart`);
});

test('without RESEARCH_NOTICE_GAP_MS, two Notices are 5 seconds apart', async (t) => {
  const sources = await serveSources(t);
  const plugin = await startedAndShaken(t, {
    env: { RESEARCH_DIGEST_COMMAND: DIGEST_COMMAND },
  });
  await heldSweeps(plugin, sources, ['First', 'Second']);

  sources.release();
  const [first, second] = await plugin.untilNotices(2, 15_000);

  assert.ok(first !== undefined && second !== undefined);
  assert.ok(second.at - first.at >= 4_990, `${second.at - first.at} ms apart`);
});

test('a Notice the Host refuses as too soon goes back to the front of the queue', async (t) => {
  const sources = await serveSources(t);
  const plugin = await withCommand(t, {
    env: { RESEARCH_NOTICE_GAP_MS: '300' },
    answerNotice: (_, index) => (index === 0 ? tooSoon('research', 1200) : undefined),
  });
  const [a, b] = await heldSweeps(plugin, sources, ['First', 'Second']);

  sources.release();
  const notices = await plugin.untilNotices(3);

  assert.ok(notices[0]?.refused !== undefined);
  assert.deepEqual(shown(notices[1]), shown(notices[0]));
  assert.equal(notices[1]?.refused, undefined);
  const paths = notices.map((notice) => notice.params['path']);
  assert.deepEqual(new Set(paths.slice(1)), new Set([`#topic/${a}`, `#topic/${b}`]));
  await quietFor(500);
  assert.equal(plugin.notices().length, 3);
  assert.equal(plugin.output(), '');
});

test('any other refusal is said once on stderr, and that Notice is dropped', async (t) => {
  const sources = await serveSources(t);
  const refusal = {
    code: HOST_ERROR,
    message: 'The "path" "#topic/1" leaves the address of research, /p/research/.',
  };
  const plugin = await withCommand(t, {
    answerNotice: (_, index) => (index === 0 ? refusal : undefined),
  });
  await heldSweeps(plugin, sources, ['First', 'Second']);

  sources.release();
  const notices = await plugin.untilNotices(2);
  await quietFor(400);

  assert.equal(plugin.notices().length, 2);
  assert.notDeepEqual(shown(notices[1]), shown(notices[0]));
  const lines = plugin.output().trim().split('\n');
  assert.equal(lines.length, 1, plugin.output());
  assert.match(lines[0] ?? '', /^research: /);
  assert.ok(lines[0]?.includes(refusal.message), lines[0]);
  assert.ok(lines[0]?.includes(String(shown(notices[0])['title'])), lines[0]);
});

test('no Notice is sent when the handshake does not offer one', async (t) => {
  const sources = await serveSources(t);
  const plugin = await withCommand(t, { notice: false });
  const topic = await topicWith(plugin, [sources.address('/notes.txt')]);

  const sweep = await ended(plugin, (await sweepOf(plugin, topic)).id);
  await quietFor(400);

  assert.equal(sweep.state, 'done');
  assert.deepEqual(plugin.notices(), []);
  assert.equal(plugin.output(), '');
  assert.ok(plugin.lines().every((line) => !line.includes('firstmate/notice')));
});

test('no Notice is sent when a Sweep starts, or when its reading ends', async (t) => {
  const sources = await serveSources(t);
  const hold = join(await makeDirectory(t), 'go');
  const plugin = await withCommand(t, { env: { RESEARCH_TEST_DIGEST_HOLD: hold } });
  const topic = await topicWith(plugin, [sources.address('/held/notes.txt')]);

  const sweep = await sweepOf(plugin, topic);
  await until('the Source is asked for', () => sources.held() === 1);
  await quietFor(200);
  assert.deepEqual(plugin.notices(), []);

  sources.release();
  await until(
    'the Sweep is digesting',
    async () => (await sweepNamed(plugin, sweep.id)).state === 'digesting',
  );
  await quietFor(200);
  assert.deepEqual(plugin.notices(), []);

  await writeFile(hold, '');
  await ended(plugin, sweep.id);
  const notices = await plugin.untilNotices(1);
  assert.equal(shown(notices[0])['title'], 'Digest ready');
});

test('make_digest sends no Notice, whether the Digest is made or fails', async (t) => {
  const sources = await serveSources(t);
  const plugin = await withCommand(t);
  const topic = await topicWith(plugin, [sources.address('/notes.txt')]);
  const sweep = await ended(plugin, (await sweepOf(plugin, topic)).id);
  await plugin.untilNotices(1);

  structureOf(await plugin.call('make_digest', { id: sweep.id }));
  assert.equal((await ended(plugin, sweep.id)).state, 'done');
  await quietFor(300);

  assert.equal(plugin.notices().length, 1);
});

test('a failed make_digest sends no Notice either', async (t) => {
  const sources = await serveSources(t);
  const plugin = await withCommand(t, { env: { RESEARCH_TEST_DIGEST_FAIL: '1' } });
  const topic = await topicWith(plugin, [sources.address('/notes.txt')]);
  const sweep = await ended(plugin, (await sweepOf(plugin, topic)).id);
  await plugin.untilNotices(1);

  structureOf(await plugin.call('make_digest', { id: sweep.id }));
  assert.equal((await ended(plugin, sweep.id)).state, 'failed');
  await quietFor(300);

  assert.equal(plugin.notices().length, 1);
  assert.equal(plugin.output(), '');
});

test('Sweeps that end at the same time send one Notice each, and none is lost', async (t) => {
  const sources = await serveSources(t);
  const plugin = await withCommand(t, { env: { RESEARCH_NOTICE_GAP_MS: '50' } });
  const topics = await heldSweeps(plugin, sources, ['First', 'Second', 'Third', 'Fourth']);

  sources.release();
  const notices = await plugin.untilNotices(4);
  await quietFor(300);

  assert.equal(plugin.notices().length, 4);
  assert.deepEqual(
    new Set(notices.map((notice) => notice.params['path'])),
    new Set(topics.map((topic) => `#topic/${topic}`)),
  );
  assert.ok(notices.every((notice) => notice.params['title'] === 'Digest ready'));
});

test('a Sweep the last Plugin Server left running sends Sweep failed once the Host offers Notices', async (t) => {
  const sources = await serveSources(t);
  const first = await startedAndShaken(t, { env: SHORT_GAP });
  const topic = await topicWith(first, [sources.address('/silent')], 'Left running');
  await sweepOf(first, topic);
  await until('the Source is asked for', () => sources.requests().length === 1);
  first.kill();
  await first.ended();

  const second = await startedAndShaken(t, { directory: first.directory, env: SHORT_GAP });
  const [notice] = await second.untilNotices(1);

  assert.deepEqual(shown(notice), {
    title: 'Sweep failed',
    body: 'Left running — the Plugin Server stopped before the Sweep ended.',
    path: `#topic/${topic}`,
  });
  await quietFor(300);
  assert.equal(second.notices().length, 1);
  assert.equal(second.output(), '');
});

test('research numbers its own requests apart from the ones the Host sends it', async (t) => {
  const sources = await serveSources(t);
  const plugin = await withCommand(t);
  await heldSweeps(plugin, sources, ['First', 'Second']);
  sources.release();
  const notices = await plugin.untilNotices(2);
  const [first, second] = notices.map((notice) => notice.id);

  assert.ok(typeof first === 'string' || typeof first === 'number');
  assert.notEqual(first, second);
  // The Host numbers its own requests, and may well reach the same number:
  // a request that comes with research's id is still a request, and is answered.
  plugin.raw(
    JSON.stringify({
      jsonrpc: '2.0',
      id: first,
      method: 'tools/call',
      params: { name: 'list_topics', arguments: {} },
    }),
  );
  await until('the request is answered', () =>
    plugin.lines().some((line) => {
      const message = JSON.parse(line) as { id?: unknown; result?: unknown };
      return message.id === first && message.result !== undefined;
    }),
  );
  assert.equal(plugin.output(), '');
});

test('the path of a Notice opens its Topic on the Plugin Page, at its latest Sweep', async (t) => {
  const sources = await serveSources(t);
  const plugin = await withCommand(t);
  await topicWith(plugin, [sources.address('/notes.txt')], 'Another Topic');
  const topic = await topicWith(plugin, [sources.address('/notes.txt')], 'Release notes');
  await ended(plugin, (await sweepOf(plugin, topic)).id);
  await plugin.untilNotices(1);
  const latest = await ended(plugin, (await sweepOf(plugin, topic)).id);
  const notices = await plugin.untilNotices(2);
  const path = String(shown(notices[1])['path']);

  const page = await openPage(t, plugin, path);

  assert.equal(page.hash(), `#topic/${topic}`);
  assert.equal(page.byId('topic-view').hidden, false);
  assert.equal(page.byId('topic-name').textContent, 'Release notes');
  assert.match(
    page.byId('sweeps').innerHTML,
    new RegExp(`<li class="sweep on"><button type="button" class="pick" data-sweep="${latest.id}"`),
  );

  const index = await openPage(t, plugin);
  index.go(path);
  await index.settled();
  assert.equal(index.byId('topic-view').hidden, false);
  assert.equal(index.byId('topic-name').textContent, 'Release notes');
});
