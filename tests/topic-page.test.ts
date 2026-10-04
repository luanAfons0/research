/**
 * The Plugin Page shows the Topics, opens one from its address fragment, and
 * makes, changes and deletes them with the same tools another Plugin calls.
 *
 * The page's own scripts run as a browser runs them, against the real Plugin
 * Server, through `tests/helpers/page.ts`. A test reads what a person would
 * see, and the Topics the Plugin Server keeps.
 */
import { strict as assert } from 'node:assert';
import test from 'node:test';
import { openPage } from './helpers/page.ts';
import { startedAndShaken, structureOf, type Started } from './helpers/plugin.ts';

type Topic = { id: number; name: string; question: string; sources: string[] };

const NODE = {
  name: 'Node 24 release',
  question: 'What changed in the Node 24 release?',
  sources: ['https://nodejs.org/en/blog/release/v24.0.0', 'https://github.com/nodejs/node'],
};

async function made(plugin: Started, args: Record<string, unknown>): Promise<Topic> {
  return structureOf<{ topic: Topic }>(await plugin.call('create_topic', args)).topic;
}

async function topics(plugin: Started): Promise<Topic[]> {
  return structureOf<{ topics: Topic[] }>(await plugin.call('list_topics')).topics;
}

test('with no Topics, the page says so and offers a New Topic', async (t) => {
  const plugin = await startedAndShaken(t);

  const page = await openPage(t, plugin);

  assert.equal(page.byId('no-topics').hidden, false);
  assert.equal(page.byId('topic-list').hidden, true);
  assert.equal(page.byId('app').classList.contains('index'), true);
  page.byId('new-topic-empty').click();
  await page.settled();
  assert.equal(page.hash(), '#new');
  assert.equal(page.byId('form-view').hidden, false);
});

test('the Topic list shows each Topic with its question and its number of Sources', async (t) => {
  const plugin = await startedAndShaken(t);
  const node = await made(plugin, NODE);
  const wasi = await made(plugin, { name: 'WASI <preview> 3', question: '', sources: [] });

  const page = await openPage(t, plugin);

  const rows = page.byId('rows').innerHTML;
  assert.equal(page.byId('topic-list').hidden, false);
  assert.equal(page.byId('no-topics').hidden, true);
  assert.match(rows, new RegExp(`href="#topic/${node.id}"`));
  assert.match(rows, /<span class="t">Node 24 release<\/span>/);
  assert.match(rows, /What changed in the Node 24 release\?/);
  assert.match(rows, /<span class="c">2<\/span>/);
  assert.match(rows, new RegExp(`href="#topic/${wasi.id}"`));
  assert.match(rows, /WASI &lt;preview&gt; 3/, 'a name became markup');
  assert.match(rows, /<span class="q none">No question<\/span>/);
  assert.match(rows, /<span class="state never">Not swept yet<\/span>/);
});

test('the address fragment opens that Topic, so a reload lands on it again', async (t) => {
  const plugin = await startedAndShaken(t);
  await made(plugin, { name: 'WASI preview 3', sources: [] });
  const node = await made(plugin, NODE);

  const page = await openPage(t, plugin, `#topic/${node.id}`);

  assert.equal(page.byId('app').classList.contains('index'), false);
  assert.equal(page.byId('index').hidden, true);
  assert.equal(page.byId('topic-view').hidden, false);
  assert.equal(page.byId('topic-name').textContent, 'Node 24 release');
  assert.equal(page.byId('topic-question').textContent, NODE.question);
  const rail = page.byId('rail-topics').innerHTML;
  assert.match(rail, new RegExp(`href="#topic/${node.id}" aria-current="page"`));
  assert.match(rail, /WASI preview 3/);
});

test('a link to another Topic changes the view without a reload', async (t) => {
  const plugin = await startedAndShaken(t);
  const node = await made(plugin, NODE);
  const wasi = await made(plugin, { name: 'WASI preview 3', question: '', sources: [] });
  const page = await openPage(t, plugin, `#topic/${node.id}`);

  page.go(`#topic/${wasi.id}`);
  await page.settled();

  assert.equal(page.byId('topic-name').textContent, 'WASI preview 3');
  assert.equal(
    page.byId('topic-question').textContent,
    'No question. The Digest is written in Brazilian Portuguese.',
  );
  page.go('#');
  await page.settled();
  assert.equal(page.byId('index').hidden, false);
  assert.equal(page.byId('topic-view').hidden, true);
});

test('a fragment that names no Topic says so in a sentence', async (t) => {
  const plugin = await startedAndShaken(t);

  const page = await openPage(t, plugin, '#topic/41');

  assert.equal(page.byId('topic-trouble').hidden, false);
  assert.match(page.byId('topic-trouble-why').textContent, /Topic 41/);
  assert.equal(page.byId('topic-head').hidden, true);
});

test('delete asks for confirmation first, and Cancel keeps the Topic', async (t) => {
  const plugin = await startedAndShaken(t);
  const node = await made(plugin, NODE);
  const page = await openPage(t, plugin, `#topic/${node.id}`);

  page.byId('delete').click();
  await page.settled();

  assert.equal(page.byId('confirm').hidden, false);
  assert.equal(page.byId('confirm-what').textContent, 'Delete “Node 24 release”?');
  assert.equal(
    page.byId('confirm-why').textContent,
    'Its 2 Sources go with it. This cannot be undone.',
  );
  assert.ok(!page.called().includes('delete_topic'), 'delete_topic was called before confirmation');
  page.byId('confirm-cancel').click();
  await page.settled();
  assert.equal(page.byId('confirm').hidden, true);
  assert.ok(!page.called().includes('delete_topic'));
  assert.equal((await topics(plugin)).length, 1);
});

test('Escape closes the confirmation, and the Topic stays', async (t) => {
  const plugin = await startedAndShaken(t);
  const node = await made(plugin, NODE);
  const page = await openPage(t, plugin, `#topic/${node.id}`);
  page.byId('delete').click();

  page.key('Escape');
  await page.settled();

  assert.equal(page.byId('confirm').hidden, true);
  assert.equal((await topics(plugin)).length, 1);
});

test('Delete Topic in the confirmation deletes it and goes back to the list', async (t) => {
  const plugin = await startedAndShaken(t);
  const node = await made(plugin, NODE);
  const page = await openPage(t, plugin, `#topic/${node.id}`);
  page.byId('delete').click();

  page.byId('confirm-delete').click();
  await page.settled();

  assert.deepEqual(page.called().filter((name) => name === 'delete_topic'), ['delete_topic']);
  assert.deepEqual(await topics(plugin), []);
  assert.equal(page.hash(), '');
  assert.equal(page.byId('no-topics').hidden, false);
});

test('a Topic made on the page is saved with its Sources, one on each line', async (t) => {
  const plugin = await startedAndShaken(t);
  const page = await openPage(t, plugin, '#new');

  assert.equal(page.byId('form-title').textContent, 'New Topic');
  assert.equal(page.byId('form-submit').textContent, 'Make Topic');
  page.byId('f-name').value = 'Node 24 release';
  page.byId('f-q').value = NODE.question;
  page.byId('f-src').value = `${NODE.sources[0]}\n\n  ${NODE.sources[1]}  \n`;
  page.byId('form').submit();
  await page.settled();

  const [saved] = await topics(plugin);
  assert.ok(saved !== undefined, 'nothing was saved');
  assert.equal(page.hash(), `#topic/${saved.id}`);
  assert.equal(page.byId('topic-name').textContent, 'Node 24 release');
  const whole = structureOf<{ topic: Topic }>(await plugin.call('get_topic', { id: saved.id }));
  assert.deepEqual(whole.topic.sources, NODE.sources);
});

test('Edit fills the form with the Topic, and Save changes it', async (t) => {
  const plugin = await startedAndShaken(t);
  const node = await made(plugin, NODE);
  const page = await openPage(t, plugin, `#topic/${node.id}`);

  page.byId('edit').click();
  await page.settled();

  assert.equal(page.hash(), `#topic/${node.id}/edit`);
  assert.equal(page.byId('form-title').textContent, 'Edit “Node 24 release”');
  assert.equal(page.byId('form-submit').textContent, 'Save');
  assert.equal(page.byId('f-name').value, 'Node 24 release');
  assert.equal(page.byId('f-q').value, NODE.question);
  assert.equal(page.byId('f-src').value, NODE.sources.join('\n'));
  page.byId('f-q').value = '';
  page.byId('form').submit();
  await page.settled();
  assert.equal(page.hash(), `#topic/${node.id}`);
  const whole = structureOf<{ topic: Topic }>(await plugin.call('get_topic', { id: node.id }));
  assert.equal(whole.topic.question, '');
});

test('a bad address is refused under the Sources, naming its line, and nothing is saved', async (t) => {
  const plugin = await startedAndShaken(t);
  const node = await made(plugin, NODE);
  const page = await openPage(t, plugin, `#topic/${node.id}/edit`);

  page.byId('f-name').value = 'Changed';
  page.byId('f-src').value = `${NODE.sources[0]}\n\nftp://files.example.org/node-24-notes.txt`;
  page.byId('form').submit();
  await page.settled();

  assert.equal(page.byId('f-src-err').hidden, false);
  assert.equal(page.byId('f-src-help').hidden, true);
  assert.equal(page.byId('f-src').getAttribute('aria-invalid'), 'true');
  assert.equal(
    page.byId('f-src-err-text').innerHTML,
    'Line 3 is not an http or https address: ' +
      '<code>ftp://files.example.org/node-24-notes.txt</code>. Change it or remove it.',
  );
  assert.equal(page.hash(), `#topic/${node.id}/edit`);
  const whole = structureOf<{ topic: Topic }>(await plugin.call('get_topic', { id: node.id }));
  assert.equal(whole.topic.name, 'Node 24 release');
});

test('Cancel on the form goes back without saving', async (t) => {
  const plugin = await startedAndShaken(t);
  const node = await made(plugin, NODE);
  const page = await openPage(t, plugin, `#topic/${node.id}/edit`);

  page.byId('f-name').value = 'Changed';
  page.byId('form-cancel').click();
  await page.settled();

  assert.equal(page.hash(), `#topic/${node.id}`);
  assert.equal(page.byId('topic-name').textContent, 'Node 24 release');
});
