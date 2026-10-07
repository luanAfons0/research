/**
 * A Sweep starts at once, reads its Topic's Sources in the background, and
 * records each state it passes through. One Sweep of a Topic runs at a time,
 * and every Sweep is kept until it is deleted.
 *
 * Everything goes through the real Plugin Server, as the Host speaks to it,
 * and the Sources come from a real HTTP server on 127.0.0.1.
 */
import { strict as assert } from 'node:assert';
import test from 'node:test';
import { startedAndShaken, startPluginServer, structureOf } from './helpers/plugin.ts';
import { serveSources } from './helpers/sources.ts';
import {
  ended,
  sweepNamed,
  sweepOf,
  sweptWhole,
  topicWith,
  until,
  type Sweep,
} from './helpers/sweeps.ts';

type Summary = Omit<Sweep, 'digest' | 'digestAt' | 'extracts'>;
type TopicView = { id: number; sources: string[]; sweeps: Summary[] };
type Listed = { id: number; lastSweepAt: string | null; lastSweepState: string | null };

async function topicView(plugin: Parameters<typeof sweepOf>[0], id: number): Promise<TopicView> {
  return structureOf<{ topic: TopicView }>(await plugin.call('get_topic', { id })).topic;
}

test('it ships the three tools of a Sweep, each with a schema', async (t) => {
  const plugin = await startedAndShaken(t);

  const answer = await plugin.ask('tools/list');

  const tools = (answer.result as { tools: { name: string; inputSchema: unknown }[] }).tools;
  for (const name of ['sweep_topic', 'get_sweep', 'delete_sweep']) {
    const tool = tools.find((each) => each.name === name);
    assert.ok(tool !== undefined, `${name} is not in tools/list`);
    assert.equal((tool.inputSchema as { type: string }).type, 'object');
  }
});

test('sweep_topic answers at once with the new Sweep, and the reading goes on after it', async (t) => {
  const sources = await serveSources(t);
  const plugin = await startedAndShaken(t);
  const topic = await topicWith(plugin, [sources.address('/held/article.html')]);

  const sweep = await sweepOf(plugin, topic);

  assert.equal(typeof sweep.id, 'number');
  assert.equal(sweep.topicId, topic);
  assert.equal(sweep.state, 'reading');
  assert.equal(sweep.endedAt, null);
  assert.equal(sweep.sourceCount, 1);
  assert.ok(!Number.isNaN(Date.parse(sweep.startedAt)), sweep.startedAt);
  await until('the Source is asked for', () => sources.held() === 1);
  assert.equal((await sweepNamed(plugin, sweep.id)).state, 'reading');
  sources.release();
  assert.equal((await ended(plugin, sweep.id)).extracts[0]?.state, 'read');
});

test('with no Digest command, a Sweep ends failed, says where to set one, and keeps every Extract', async (t) => {
  const sources = await serveSources(t);
  const plugin = await startedAndShaken(t);

  const sweep = await sweptWhole(plugin, [
    sources.address('/article.html'),
    sources.address('/missing'),
  ]);

  assert.equal(sweep.state, 'failed');
  assert.equal(sweep.reason, 'no Digest command is set; set one in Settings');
  assert.equal(sweep.digest, null);
  assert.ok(!Number.isNaN(Date.parse(sweep.endedAt ?? '')), String(sweep.endedAt));
  assert.deepEqual(
    sweep.extracts.map((extract) => extract.state),
    ['read', 'failed'],
  );
  assert.ok((sweep.extracts[0]?.text ?? '').length > 0);
  assert.equal(sweep.readCount, 1);
});

test('when no Source could be read, the Sweep ends failed with that reason', async (t) => {
  const sources = await serveSources(t);
  const plugin = await startedAndShaken(t);

  const sweep = await sweptWhole(plugin, [
    sources.address('/paper.pdf'),
    sources.address('/missing'),
  ]);

  assert.equal(sweep.state, 'failed');
  assert.equal(sweep.reason, 'no Source could be read');
  assert.equal(sweep.failure, 'no-source-read');
  assert.equal(sweep.extracts.length, 2);
  assert.equal(sweep.readCount, 0);
});

test('a second Sweep of the same Topic is refused with a sentence while one runs', async (t) => {
  const sources = await serveSources(t);
  const plugin = await startedAndShaken(t);
  const topic = await topicWith(plugin, [sources.address('/held/article.html')]);
  const first = await sweepOf(plugin, topic);

  const second = await plugin.call('sweep_topic', { id: topic });

  assert.equal(second.error?.code, -32602);
  assert.equal(
    second.error?.message,
    `Sweep ${first.id} of Topic ${topic} is running. Wait for it to end, then Sweep again.`,
  );
  assert.equal((await topicView(plugin, topic)).sweeps.length, 1);
  sources.release();
  await ended(plugin, first.id);
  const third = await sweepOf(plugin, topic);
  assert.notEqual(third.id, first.id);
  await ended(plugin, third.id);
});

test('Sweeps of two Topics run at the same time', async (t) => {
  const sources = await serveSources(t);
  const plugin = await startedAndShaken(t);
  const node = await topicWith(plugin, [sources.address('/held/article.html')]);
  const wasi = await topicWith(plugin, [sources.address('/held/notes.txt')], 'WASI preview 3');

  const first = await sweepOf(plugin, node);
  const second = await sweepOf(plugin, wasi);

  await until('both Sources are asked for', () => sources.held() === 2);
  assert.equal((await sweepNamed(plugin, first.id)).state, 'reading');
  assert.equal((await sweepNamed(plugin, second.id)).state, 'reading');
  sources.release();
  assert.equal((await ended(plugin, first.id)).readCount, 1);
  assert.equal((await ended(plugin, second.id)).readCount, 1);
});

test('editing a Topic while it is swept does not change the Sweep', async (t) => {
  const sources = await serveSources(t);
  const plugin = await startedAndShaken(t);
  const before = [sources.address('/held/article.html'), sources.address('/held/notes.txt')];
  const topic = await topicWith(plugin, before);
  const started = await sweepOf(plugin, topic);

  const edited = await plugin.call('update_topic', {
    id: topic,
    name: 'Changed',
    sources: [sources.address('/paper.pdf')],
  });
  sources.release();
  const sweep = await ended(plugin, started.id);

  assert.equal(edited.error, undefined);
  assert.deepEqual(
    sweep.extracts.map((extract) => extract.address),
    before,
  );
  assert.equal(sweep.readCount, 2);
  assert.ok(!sources.requests().some((request) => request.path === '/paper.pdf'));
});

test('deleting a Source keeps its Extracts in the Sweeps that read it', async (t) => {
  const sources = await serveSources(t);
  const plugin = await startedAndShaken(t);
  const topic = await topicWith(plugin, [sources.address('/article.html')]);
  const sweep = await ended(plugin, (await sweepOf(plugin, topic)).id);

  await plugin.call('update_topic', { id: topic, sources: [] });

  const kept = await sweepNamed(plugin, sweep.id);
  assert.deepEqual(kept.extracts, sweep.extracts);
  assert.deepEqual((await topicView(plugin, topic)).sources, []);
});

test('a Topic with no Sources is refused a Sweep with a sentence', async (t) => {
  const plugin = await startedAndShaken(t);
  const topic = await topicWith(plugin, []);

  const answer = await plugin.call('sweep_topic', { id: topic });

  assert.equal(answer.error?.code, -32602);
  assert.match(answer.error?.message ?? '', new RegExp(`Topic ${topic} has no Sources`));
  assert.deepEqual((await topicView(plugin, topic)).sweeps, []);
});

test('a Sweep of an unknown Topic is refused with a sentence that names it', async (t) => {
  const plugin = await startedAndShaken(t);

  const answer = await plugin.call('sweep_topic', { id: 7 });

  assert.equal(answer.error?.code, -32602);
  assert.match(answer.error?.message ?? '', /Topic 7/);
});

test('get_sweep with only a Topic gives its latest Sweep, and null for a Topic never swept', async (t) => {
  const sources = await serveSources(t);
  const plugin = await startedAndShaken(t);
  const topic = await topicWith(plugin, [sources.address('/notes.txt')]);
  const never = await topicWith(plugin, [sources.address('/notes.txt')], 'WASI preview 3');
  await ended(plugin, (await sweepOf(plugin, topic)).id);
  const latest = await ended(plugin, (await sweepOf(plugin, topic)).id);

  const got = structureOf<{ sweep: Sweep }>(await plugin.call('get_sweep', { topic })).sweep;
  const none = structureOf<{ sweep: Sweep | null }>(
    await plugin.call('get_sweep', { topic: never }),
  );

  assert.deepEqual(got, latest);
  assert.deepEqual(none, { sweep: null });
});

test('get_sweep is refused with a sentence for no id, an unknown Sweep, or a Sweep of another Topic', async (t) => {
  const sources = await serveSources(t);
  const plugin = await startedAndShaken(t);
  const topic = await topicWith(plugin, [sources.address('/notes.txt')]);
  const other = await topicWith(plugin, [], 'WASI preview 3');
  const sweep = await ended(plugin, (await sweepOf(plugin, topic)).id);

  const nothing = await plugin.call('get_sweep', {});
  const unknown = await plugin.call('get_sweep', { id: 99 });
  const mixed = await plugin.call('get_sweep', { id: sweep.id, topic: other });
  const bad = await plugin.call('get_sweep', { id: 'one' });

  assert.match(nothing.error?.message ?? '', /needs "id".*or "topic"/);
  assert.match(unknown.error?.message ?? '', /There is no Sweep 99/);
  assert.match(mixed.error?.message ?? '', new RegExp(`not a Sweep of Topic ${other}`));
  assert.match(bad.error?.message ?? '', /whole number/);
  for (const answer of [nothing, unknown, mixed, bad]) assert.equal(answer.error?.code, -32602);
});

test('get_topic lists the Sweeps from new to old, and list_topics gives the last one', async (t) => {
  const sources = await serveSources(t);
  const plugin = await startedAndShaken(t);
  const topic = await topicWith(plugin, [sources.address('/held/notes.txt')]);
  const never = await topicWith(plugin, [], 'WASI preview 3');
  sources.release();
  const first = await ended(plugin, (await sweepOf(plugin, topic)).id);
  const second = await ended(plugin, (await sweepOf(plugin, topic)).id);

  const view = await topicView(plugin, topic);
  const listed = structureOf<{ topics: Listed[] }>(await plugin.call('list_topics')).topics;

  assert.deepEqual(
    view.sweeps.map((sweep) => sweep.id),
    [second.id, first.id],
  );
  const { digest: _digest, digestAt: _at, extracts: _extracts, ...summary } = second;
  assert.deepEqual(view.sweeps[0], summary);
  assert.equal(listed.find((each) => each.id === topic)?.lastSweepAt, second.startedAt);
  assert.equal(listed.find((each) => each.id === topic)?.lastSweepState, 'failed');
  assert.equal(listed.find((each) => each.id === never)?.lastSweepAt, null);
  assert.equal(listed.find((each) => each.id === never)?.lastSweepState, null);
});

test('list_topics shows a Sweep that runs as reading', async (t) => {
  const sources = await serveSources(t);
  const plugin = await startedAndShaken(t);
  const topic = await topicWith(plugin, [sources.address('/held/notes.txt')]);
  const sweep = await sweepOf(plugin, topic);

  const listed = structureOf<{ topics: Listed[] }>(await plugin.call('list_topics')).topics;

  assert.equal(listed[0]?.lastSweepState, 'reading');
  assert.equal(listed[0]?.lastSweepAt, sweep.startedAt);
  sources.release();
  await ended(plugin, sweep.id);
});

test('delete_sweep deletes a Sweep, and is refused while that Sweep runs', async (t) => {
  const sources = await serveSources(t);
  const plugin = await startedAndShaken(t);
  const topic = await topicWith(plugin, [sources.address('/held/notes.txt')]);
  const sweep = await sweepOf(plugin, topic);

  const refused = await plugin.call('delete_sweep', { id: sweep.id });
  sources.release();
  await ended(plugin, sweep.id);
  const deleted = await plugin.call('delete_sweep', { id: sweep.id });

  assert.equal(refused.error?.code, -32602);
  assert.equal(
    refused.error?.message,
    `Sweep ${sweep.id} is running. Wait for it to end, then delete it.`,
  );
  assert.deepEqual(structureOf(deleted), { deleted: { id: sweep.id, topicId: topic } });
  assert.deepEqual((await topicView(plugin, topic)).sweeps, []);
  assert.match((await plugin.call('get_sweep', { id: sweep.id })).error?.message ?? '', /no Sweep/);
});

test('deleting a Topic deletes its Sweeps', async (t) => {
  const sources = await serveSources(t);
  const plugin = await startedAndShaken(t);
  const topic = await topicWith(plugin, [sources.address('/notes.txt')]);
  const sweep = await ended(plugin, (await sweepOf(plugin, topic)).id);

  await plugin.call('delete_topic', { id: topic });

  assert.match((await plugin.call('get_sweep', { id: sweep.id })).error?.message ?? '', /no Sweep/);
});

test('a Sweep still reading when the Plugin Server starts again becomes failed, with that reason', async (t) => {
  const sources = await serveSources(t);
  const first = await startedAndShaken(t);
  const topic = await topicWith(first, [
    sources.address('/notes.txt'),
    sources.address('/silent'),
    sources.address('/held/article.html'),
  ]);
  const sweep = await sweepOf(first, topic);
  await until(
    'the first Source is read',
    async () => (await sweepNamed(first, sweep.id)).readCount === 1,
  );
  first.kill();
  await first.ended();

  const second = await startedAndShaken(t, { directory: first.directory });

  const after = await sweepNamed(second, sweep.id);
  assert.equal(after.state, 'failed');
  assert.equal(after.reason, 'the Plugin Server stopped before the Sweep ended');
  assert.equal(after.failure, 'plugin-server-stopped');
  assert.ok(after.endedAt !== null);
  assert.deepEqual(
    after.extracts.map((extract) => extract.state),
    ['read', 'failed', 'failed'],
  );
  assert.equal(after.extracts[1]?.reason, 'not read: the Plugin Server stopped first');
  assert.equal(second.output(), '');
  const again = await sweepOf(second, topic);
  assert.notEqual(again.id, sweep.id);
});

test('closing stdin while a Sweep reads stops the Plugin Server quietly', async (t) => {
  const sources = await serveSources(t);
  const plugin = await startedAndShaken(t);
  const topic = await topicWith(plugin, [sources.address('/silent')]);
  await sweepOf(plugin, topic);
  await until('the Source is asked for', () => sources.requests().length === 1);

  plugin.stop();
  const ending = await plugin.ended();

  assert.equal(ending.code, 0);
  assert.equal(plugin.output(), '');
});

test('a Sweep says nothing on stderr, whatever its Sources answer', async (t) => {
  const sources = await serveSources(t);
  const plugin = await startedAndShaken(t, { env: { RESEARCH_FETCH_TIMEOUT_MS: '200' } });

  await sweptWhole(plugin, [
    sources.address('/article.html'),
    sources.address('/paper.pdf'),
    sources.address('/missing'),
    sources.address('/silent'),
    sources.address('/needs-javascript.html'),
  ]);

  assert.equal(plugin.output(), '');
});

test('a fetch time that is not a whole number of milliseconds stops the Plugin Server with a sentence', async (t) => {
  const plugin = await startPluginServer(t, { env: { RESEARCH_FETCH_TIMEOUT_MS: 'soon' } });

  const ending = await plugin.ended();

  assert.notEqual(ending.code, 0);
  assert.equal(
    plugin.output(),
    'research: RESEARCH_FETCH_TIMEOUT_MS is soon; set it to a whole number of milliseconds.\n',
  );
});
