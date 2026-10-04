/**
 * Topics are made, changed, listed and deleted through the tools, the same
 * tools the Plugin Page and other Plugins call.
 *
 * Everything here goes through the one seam: the real `mcp` executable against
 * a temporary Plugin directory, spoken to as the Host speaks to it.
 */
import { strict as assert } from 'node:assert';
import test from 'node:test';
import { startedAndShaken, structureOf, textOf, type Started } from './helpers/plugin.ts';

type Topic = {
  id: number;
  name: string;
  question: string;
  madeAt: string;
  sources: string[];
  sweeps: unknown[];
};

type Listed = {
  id: number;
  name: string;
  question: string;
  sourceCount: number;
  lastSweepAt: string | null;
  lastSweepState: string | null;
};

const NODE_SOURCES = [
  'https://nodejs.org/en/blog/release/v24.0.0',
  'https://github.com/nodejs/node/blob/main/doc/changelogs/CHANGELOG_V24.md',
  'http://developer.mozilla.org/en-US/docs/Web/API/URLPattern',
];

async function made(plugin: Started, args: Record<string, unknown>): Promise<Topic> {
  return structureOf<{ topic: Topic }>(await plugin.call('create_topic', args)).topic;
}

async function listed(plugin: Started): Promise<Listed[]> {
  return structureOf<{ topics: Listed[] }>(await plugin.call('list_topics')).topics;
}

test('it ships the five tools of a Topic, each with a schema', async (t) => {
  const plugin = await startedAndShaken(t);

  const answer = await plugin.ask('tools/list');

  const names = (answer.result as { tools: { name: string }[] }).tools.map((tool) => tool.name);
  for (const name of ['list_topics', 'get_topic', 'create_topic', 'update_topic', 'delete_topic']) {
    assert.ok(names.includes(name), `${name} is not in tools/list`);
  }
});

test('a Topic is made with a name, a question and its Sources, in order', async (t) => {
  const plugin = await startedAndShaken(t);

  const topic = await made(plugin, {
    name: 'Node 24 release',
    question: 'What changed in the Node 24 release?',
    sources: NODE_SOURCES,
  });

  assert.equal(typeof topic.id, 'number');
  assert.equal(topic.name, 'Node 24 release');
  assert.equal(topic.question, 'What changed in the Node 24 release?');
  assert.deepEqual(topic.sources, NODE_SOURCES);
  assert.deepEqual(topic.sweeps, []);
  assert.ok(!Number.isNaN(Date.parse(topic.madeAt)), topic.madeAt);
});

test('a Topic may have an empty question', async (t) => {
  const plugin = await startedAndShaken(t);

  const topic = await made(plugin, { name: 'WASI preview 3', question: '', sources: [] });

  assert.equal(topic.question, '');
  assert.deepEqual(topic.sources, []);
});

test('the name, the question and each address are kept without the spaces around them', async (t) => {
  const plugin = await startedAndShaken(t);

  const topic = await made(plugin, {
    name: '  Node 24 release ',
    question: ' Why? ',
    sources: [' https://nodejs.org/ '],
  });

  assert.equal(topic.name, 'Node 24 release');
  assert.equal(topic.question, 'Why?');
  assert.deepEqual(topic.sources, ['https://nodejs.org/']);
});

test('a Topic with no name is refused with a sentence, and nothing is saved', async (t) => {
  const plugin = await startedAndShaken(t);

  const answer = await plugin.call('create_topic', { name: '   ', question: '', sources: [] });

  assert.equal(answer.error?.code, -32602);
  assert.match(answer.error?.message ?? '', /name/);
  assert.deepEqual(await listed(plugin), []);
});

test('an address that is not http or https is refused with a sentence that names it', async (t) => {
  const plugin = await startedAndShaken(t);

  const answer = await plugin.call('create_topic', {
    name: 'Node 24 release',
    question: '',
    sources: [...NODE_SOURCES, 'ftp://files.example.org/node-24-notes.txt'],
  });

  assert.equal(answer.error?.code, -32602);
  assert.ok(
    answer.error?.message.includes('ftp://files.example.org/node-24-notes.txt'),
    answer.error?.message,
  );
  assert.match(answer.error?.message ?? '', /http or https/);
  assert.deepEqual(await listed(plugin), []);
});

test('the refusal of an address says which Source it is, for the page to point at', async (t) => {
  const plugin = await startedAndShaken(t);

  const answer = await plugin.call('create_topic', {
    name: 'Node 24 release',
    sources: ['https://nodejs.org/', 'not an address'],
  });

  const error = answer.error as { message: string; data?: unknown };
  assert.match(error.message, /not an address/);
  assert.deepEqual(error.data, { field: 'sources', index: 1, address: 'not an address' });
});

test('Sources that are not a list of text are refused with a sentence', async (t) => {
  const plugin = await startedAndShaken(t);

  const answer = await plugin.call('create_topic', { name: 'X', sources: 'https://a.example/' });

  assert.equal(answer.error?.code, -32602);
  assert.match(answer.error?.message ?? '', /sources/);
});

test('every Topic is listed with its number of Sources, and no last Sweep yet', async (t) => {
  const plugin = await startedAndShaken(t);
  const node = await made(plugin, { name: 'Node 24 release', question: 'Q?', sources: NODE_SOURCES });
  const wasi = await made(plugin, { name: 'WASI preview 3', question: '', sources: [] });

  const topics = await listed(plugin);

  assert.deepEqual(topics, [
    {
      id: node.id,
      name: 'Node 24 release',
      question: 'Q?',
      sourceCount: 3,
      lastSweepAt: null,
      lastSweepState: null,
    },
    {
      id: wasi.id,
      name: 'WASI preview 3',
      question: '',
      sourceCount: 0,
      lastSweepAt: null,
      lastSweepState: null,
    },
  ]);
});

test('the text of an answer holds the same Topics as its structure', async (t) => {
  const plugin = await startedAndShaken(t);
  await made(plugin, { name: 'Node 24 release', sources: NODE_SOURCES });

  const answer = await plugin.call('list_topics');

  assert.deepEqual(JSON.parse(textOf(answer)), structureOf(answer));
});

test('get_topic gives one Topic, its Sources in order, and its Sweeps', async (t) => {
  const plugin = await startedAndShaken(t);
  const topic = await made(plugin, { name: 'Node 24 release', question: 'Q?', sources: NODE_SOURCES });

  const got = structureOf<{ topic: Topic }>(await plugin.call('get_topic', { id: topic.id })).topic;

  assert.deepEqual(got, topic);
});

test('an unknown Topic id is refused with a sentence that names it', async (t) => {
  const plugin = await startedAndShaken(t);

  const answer = await plugin.call('get_topic', { id: 41 });

  assert.equal(answer.error?.code, -32602);
  assert.match(answer.error?.message ?? '', /Topic 41/);
});

test('a Topic id that is not a whole number is refused with a sentence', async (t) => {
  const plugin = await startedAndShaken(t);

  const answer = await plugin.call('get_topic', { id: 'Node 24' });

  assert.equal(answer.error?.code, -32602);
  assert.match(answer.error?.message ?? '', /"id"/);
});

test('update_topic changes the name, the question and the Sources, in their new order', async (t) => {
  const plugin = await startedAndShaken(t);
  const topic = await made(plugin, { name: 'Node 24', question: 'Q?', sources: NODE_SOURCES });
  const sources = [NODE_SOURCES[2], 'https://nodeweekly.com/issues/580', NODE_SOURCES[0]];

  const changed = structureOf<{ topic: Topic }>(
    await plugin.call('update_topic', {
      id: topic.id,
      name: 'Node 24 release',
      question: '',
      sources,
    }),
  ).topic;

  assert.equal(changed.id, topic.id);
  assert.equal(changed.name, 'Node 24 release');
  assert.equal(changed.question, '');
  assert.deepEqual(changed.sources, sources);
  assert.equal(changed.madeAt, topic.madeAt);
  const got = structureOf<{ topic: Topic }>(await plugin.call('get_topic', { id: topic.id })).topic;
  assert.deepEqual(got, changed);
});

test('update_topic keeps what it is not given', async (t) => {
  const plugin = await startedAndShaken(t);
  const topic = await made(plugin, { name: 'Node 24', question: 'Q?', sources: NODE_SOURCES });

  const changed = structureOf<{ topic: Topic }>(
    await plugin.call('update_topic', { id: topic.id, name: 'Node 24 release' }),
  ).topic;

  assert.equal(changed.question, 'Q?');
  assert.deepEqual(changed.sources, NODE_SOURCES);
});

test('an update with a bad address is refused, and the Topic stays as it was', async (t) => {
  const plugin = await startedAndShaken(t);
  const topic = await made(plugin, { name: 'Node 24', question: 'Q?', sources: NODE_SOURCES });

  const answer = await plugin.call('update_topic', {
    id: topic.id,
    name: 'Changed',
    question: 'Changed?',
    sources: ['https://nodejs.org/', 'javascript:alert(1)'],
  });

  assert.equal(answer.error?.code, -32602);
  assert.ok(answer.error?.message.includes('javascript:alert(1)'), answer.error?.message);
  const got = structureOf<{ topic: Topic }>(await plugin.call('get_topic', { id: topic.id })).topic;
  assert.deepEqual(got, topic);
});

test('updating an unknown Topic is refused with a sentence', async (t) => {
  const plugin = await startedAndShaken(t);

  const answer = await plugin.call('update_topic', { id: 9, name: 'X' });

  assert.equal(answer.error?.code, -32602);
  assert.match(answer.error?.message ?? '', /Topic 9/);
});

test('delete_topic deletes the Topic and its Sources, and leaves the others', async (t) => {
  const plugin = await startedAndShaken(t);
  const node = await made(plugin, { name: 'Node 24 release', sources: NODE_SOURCES });
  const wasi = await made(plugin, { name: 'WASI preview 3', sources: ['https://wasi.dev/'] });

  const answer = await plugin.call('delete_topic', { id: node.id });

  assert.equal(answer.error, undefined, answer.error?.message);
  assert.deepEqual(
    (await listed(plugin)).map((topic) => topic.id),
    [wasi.id],
  );
  assert.match((await plugin.call('get_topic', { id: node.id })).error?.message ?? '', /Topic/);
  const kept = structureOf<{ topic: Topic }>(await plugin.call('get_topic', { id: wasi.id })).topic;
  assert.deepEqual(kept.sources, ['https://wasi.dev/']);
});

test('deleting an unknown Topic is refused with a sentence', async (t) => {
  const plugin = await startedAndShaken(t);

  const answer = await plugin.call('delete_topic', { id: 3 });

  assert.equal(answer.error?.code, -32602);
  assert.match(answer.error?.message ?? '', /Topic 3/);
});

test('Topics stay after the Plugin Server stops and starts again', async (t) => {
  const first = await startedAndShaken(t);
  const topic = await made(first, { name: 'Node 24 release', question: 'Q?', sources: NODE_SOURCES });
  first.stop();
  await first.ended();

  const second = await startedAndShaken(t, { directory: first.directory });

  const got = structureOf<{ topic: Topic }>(await second.call('get_topic', { id: topic.id })).topic;
  assert.deepEqual(got, topic);
  assert.equal(second.output(), '');
});

test('making and deleting Topics says nothing on stderr', async (t) => {
  const plugin = await startedAndShaken(t);
  const topic = await made(plugin, { name: 'Node 24 release', sources: NODE_SOURCES });
  await plugin.call('update_topic', { id: topic.id, question: 'Q?' });
  await plugin.call('delete_topic', { id: topic.id });

  assert.equal(plugin.output(), '');
});
