/**
 * The Plugin Page shows the Topics, opens one from its address fragment, and
 * makes, changes and deletes them with the same tools another Plugin calls.
 *
 * The page's own scripts run as a browser runs them, against the real Plugin
 * Server, through `tests/helpers/page.ts`. A test reads what a person would
 * see, and the Topics the Plugin Server keeps.
 */
import { strict as assert } from 'node:assert';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import test from 'node:test';
import { openPage, WEB, type OpenPage } from './helpers/page.ts';
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

/** The Sources the form lists, in order, as their remove buttons name them. */
function listed(page: OpenPage): string[] {
  return [...page.byId('f-src-list').innerHTML.matchAll(/aria-label="Remove ([^"]*)"/g)].map(
    (found) => (found[1] ?? '').replace(/&quot;/g, '"').replace(/&lt;/g, '<').replace(/&amp;/g, '&'),
  );
}

/** Type an address into the box and press Enter, as a person adds one. */
function add(page: OpenPage, address: string): void {
  page.type('f-src-add', address);
  page.press('f-src-add', 'Enter');
}

async function sourcesOf(plugin: Started, id: number): Promise<string[]> {
  return structureOf<{ topic: Topic }>(await plugin.call('get_topic', { id })).topic.sources;
}

test('a new Topic has no Sources yet, and says so quietly', async (t) => {
  const plugin = await startedAndShaken(t);

  const page = await openPage(t, plugin, '#new');

  assert.equal(page.byId('f-src-none').hidden, false);
  assert.equal(page.byId('f-src-list').hidden, true);
  assert.equal(page.byId('f-src-count').textContent, '');
  assert.equal(page.byId('f-src-add-err').hidden, true);
  // The words are the page's own bytes, as the Host serves them.
  const html = await readFile(join(WEB, 'index.html'), 'utf8');
  assert.match(
    html,
    /id="f-src-none">No Sources yet\. Add the pages to read, one at a time or many at once\.<\/p>/,
  );
  assert.match(html, /placeholder="https:\/\/…" aria-label="Add a Source"/);
  assert.match(html, /id="f-src-help">research reads each page once, and no page it links to\.</);
});

test('Enter and the Add button each add a Source to the end of the list, and Enter sends nothing', async (t) => {
  const plugin = await startedAndShaken(t);
  const page = await openPage(t, plugin, '#new');

  add(page, NODE.sources[0]!);
  page.type('f-src-add', `  ${NODE.sources[1]} `);
  page.byId('f-src-add-button').click();
  await page.settled();

  assert.deepEqual(listed(page), NODE.sources);
  assert.ok(!page.called().includes('create_topic'), 'Enter in the box sent the form');
  assert.equal(page.byId('f-src-add').value, '');
  assert.equal(page.focused()?.id, 'f-src-add');
  assert.equal(page.byId('f-src-count').textContent, '(2)');
  assert.equal(page.byId('f-src-none').hidden, true);
  assert.equal(page.byId('f-src-list').hidden, false);
  const rows = page.byId('f-src-list').innerHTML.split('</li>');
  assert.match(
    rows[0] ?? '',
    /<span class="n">1<\/span><span class="host">nodejs\.org<\/span><span class="path">\/en\/blog\/release\/v24\.0\.0<\/span>/,
  );
  assert.match(
    rows[1] ?? '',
    /<span class="n">2<\/span><span class="host">github\.com<\/span><span class="path">\/nodejs\/node<\/span>/,
  );
  assert.match(rows[1] ?? '', /class="src fresh"/);
});

test('a Topic made on the page is saved with its Sources, in the order of the list', async (t) => {
  const plugin = await startedAndShaken(t);
  const page = await openPage(t, plugin, '#new');

  assert.equal(page.byId('form-title').textContent, 'New Topic');
  assert.equal(page.byId('form-submit').textContent, 'Make Topic');
  page.byId('f-name').value = 'Node 24 release';
  page.byId('f-q').value = NODE.question;
  add(page, NODE.sources[0]!);
  add(page, NODE.sources[1]!);
  page.byId('form').submit();
  await page.settled();

  const [saved] = await topics(plugin);
  assert.ok(saved !== undefined, 'nothing was saved');
  assert.equal(page.hash(), `#topic/${saved.id}`);
  assert.equal(page.byId('topic-name').textContent, 'Node 24 release');
  assert.deepEqual(await sourcesOf(plugin, saved.id), NODE.sources);
});

test('an address left in the box joins the list when the form is saved', async (t) => {
  const plugin = await startedAndShaken(t);
  const page = await openPage(t, plugin, '#new');

  page.byId('f-name').value = 'Node 24 release';
  add(page, NODE.sources[0]!);
  page.type('f-src-add', NODE.sources[1]!);
  page.byId('form').submit();
  await page.settled();

  const [saved] = await topics(plugin);
  assert.ok(saved !== undefined, 'nothing was saved');
  assert.deepEqual(await sourcesOf(plugin, saved.id), NODE.sources);
});

test('a paste of several addresses adds each one in order, and a paste of one lands in the box', async (t) => {
  const plugin = await startedAndShaken(t);
  const page = await openPage(t, plugin, '#new');
  const many = [
    'https://nodejs.org/en/blog/release/v24.0.0',
    'https://github.com/nodejs/node',
    'https://developer.mozilla.org/en-US/docs/Web/API/URLPattern',
    'https://example.org/search?q=a,b',
    'http://nodeweekly.com/issues/580',
  ];

  page.paste('f-src-add', `${many[0]}\n\n${many[1]}, ${many[2]}\t${many[3]},${many[4]}\n`);

  assert.deepEqual(listed(page), many);
  assert.equal(page.byId('f-src-add').value, '');
  assert.equal(page.byId('f-src-count').textContent, '(5)');
  page.paste('f-src-add', 'https://openjsf.org/slides');
  assert.equal(page.byId('f-src-add').value, 'https://openjsf.org/slides');
  assert.equal(listed(page).length, 5);
});

test('an address that is not http or https is refused under the box, and stays there to be fixed', async (t) => {
  const plugin = await startedAndShaken(t);
  const page = await openPage(t, plugin, '#new');

  add(page, 'ftp://files.example.org/node-24-notes.txt');

  assert.deepEqual(listed(page), []);
  assert.equal(page.byId('f-src-add-err').hidden, false);
  assert.equal(
    page.byId('f-src-add-err-text').innerHTML,
    '<code>ftp://files.example.org/node-24-notes.txt</code> is not an http or https address.',
  );
  assert.equal(page.byId('f-src-add').value, 'ftp://files.example.org/node-24-notes.txt');
  assert.equal(page.byId('f-src-add').getAttribute('aria-invalid'), 'true');
  assert.equal(page.byId('f-src-add').getAttribute('aria-describedby'), 'f-src-add-err f-src-help');
  page.type('f-src-add', 'https://files.example.org/node-24-notes.txt');
  assert.equal(page.byId('f-src-add-err').hidden, true, 'the reason stayed while the address was fixed');
  assert.equal(page.byId('f-src-add').getAttribute('aria-invalid'), null);
  page.press('f-src-add', 'Enter');
  assert.deepEqual(listed(page), ['https://files.example.org/node-24-notes.txt']);
});

test('an address already in the list is refused, and an empty box says nothing', async (t) => {
  const plugin = await startedAndShaken(t);
  const page = await openPage(t, plugin, '#new');
  add(page, 'https://nodejs.org/en/blog/release/v24.0.0');

  add(page, 'https://NodeJS.org/en/blog/release/v24.0.0');

  assert.deepEqual(listed(page), ['https://nodejs.org/en/blog/release/v24.0.0']);
  assert.equal(
    page.byId('f-src-add-err-text').innerHTML,
    '<code>https://NodeJS.org/en/blog/release/v24.0.0</code> is already in the list.',
  );
  assert.equal(page.byId('f-src-add').value, 'https://NodeJS.org/en/blog/release/v24.0.0');

  page.type('f-src-add', '   ');
  page.press('f-src-add', 'Enter');
  page.byId('f-src-add-button').click();

  assert.equal(page.byId('f-src-add-err').hidden, true);
  assert.equal(listed(page).length, 1);
  assert.ok(!page.called().includes('create_topic'));
});

test('a paste adds the good addresses and keeps each refused one in the box, with why', async (t) => {
  const plugin = await startedAndShaken(t);
  const page = await openPage(t, plugin, '#new');
  add(page, 'https://github.com/nodejs/node');

  page.paste(
    'f-src-add',
    'https://nodejs.org/en/blog/release/v24.0.0 nodejs.org/en/download ' +
      'https://github.com/nodejs/node https://openjsf.org/',
  );

  assert.deepEqual(listed(page), [
    'https://github.com/nodejs/node',
    'https://nodejs.org/en/blog/release/v24.0.0',
    'https://openjsf.org/',
  ]);
  assert.equal(page.byId('f-src-add').value, 'nodejs.org/en/download https://github.com/nodejs/node');
  assert.equal(
    page.byId('f-src-add-err-text').innerHTML,
    '<code>nodejs.org/en/download</code> is not an http or https address. ' +
      '<code>https://github.com/nodejs/node</code> is already in the list.',
  );
});

test('a refused address in the box stops the save, and says why', async (t) => {
  const plugin = await startedAndShaken(t);
  const page = await openPage(t, plugin, '#new');
  page.byId('f-name').value = 'Node 24 release';

  page.type('f-src-add', 'files.example.org/notes.txt');
  page.byId('form').submit();
  await page.settled();

  assert.ok(!page.called().includes('create_topic'));
  assert.equal(page.byId('f-src-add-err').hidden, false);
  assert.equal(page.focused()?.id, 'f-src-add');
  assert.deepEqual(await topics(plugin), []);
});

test('the trash button removes a Source, and the focus goes to the row that takes its place', async (t) => {
  const plugin = await startedAndShaken(t);
  const node = await made(plugin, {
    ...NODE,
    sources: [...NODE.sources, 'https://openjsf.org/'],
  });
  const page = await openPage(t, plugin, `#topic/${node.id}/edit`);
  assert.match(
    page.byId('f-src-list').innerHTML,
    /data-remove="1" aria-label="Remove https:\/\/github\.com\/nodejs\/node"/,
  );

  page.pressIn('f-src-list', 'data-remove', '1');

  assert.deepEqual(listed(page), [NODE.sources[0], 'https://openjsf.org/']);
  assert.equal(page.focusedItem(), '#f-src-list [data-remove="1"]');
  assert.equal(page.byId('f-src-count').textContent, '(2)');
  page.pressIn('f-src-list', 'data-remove', '1');
  page.pressIn('f-src-list', 'data-remove', '0');
  assert.deepEqual(listed(page), []);
  assert.equal(page.byId('f-src-none').hidden, false);
  assert.equal(page.focused()?.id, 'f-src-add');
  page.byId('form').submit();
  await page.settled();
  assert.deepEqual(await sourcesOf(plugin, node.id), []);
});

test('the move buttons change the order, the first row cannot go up, and the last cannot go down', async (t) => {
  const plugin = await startedAndShaken(t);
  const three = [...NODE.sources, 'https://openjsf.org/'];
  const node = await made(plugin, { ...NODE, sources: three });
  const page = await openPage(t, plugin, `#topic/${node.id}/edit`);
  const list = page.byId('f-src-list').innerHTML;
  assert.match(list, /data-up="0" aria-label="Move https:\/\/nodejs\.org\/en\/blog\/release\/v24\.0\.0 up" disabled/);
  assert.match(list, /data-down="2" aria-label="Move https:\/\/openjsf\.org\/ down" disabled/);
  assert.doesNotMatch(list, /data-down="1"[^>]*disabled/);

  page.pressIn('f-src-list', 'data-up', '0');
  assert.deepEqual(listed(page), three, 'the first row went up');
  page.pressIn('f-src-list', 'data-up', '2');
  assert.deepEqual(listed(page), [three[0], three[2], three[1]]);
  assert.equal(page.focusedItem(), '#f-src-list [data-up="1"]');
  assert.match(page.byId('f-src-list').innerHTML, /<li class="src moved" data-src="1">/);
  page.pressIn('f-src-list', 'data-down', '0');
  assert.deepEqual(listed(page), [three[2], three[0], three[1]]);
  page.pressIn('f-src-list', 'data-up', '1');
  assert.deepEqual(listed(page), [three[0], three[2], three[1]]);
  assert.equal(page.focusedItem(), '#f-src-list [data-down="0"]', 'the focus stayed on a button that is off');

  page.byId('form').submit();
  await page.settled();

  assert.equal(page.hash(), `#topic/${node.id}`);
  assert.deepEqual(await sourcesOf(plugin, node.id), [three[0], three[2], three[1]]);
});

test('Alt+ArrowUp and Alt+ArrowDown move the row that has the focus, and the focus moves with it', async (t) => {
  const plugin = await startedAndShaken(t);
  const three = [...NODE.sources, 'https://openjsf.org/'];
  const node = await made(plugin, { ...NODE, sources: three });
  const page = await openPage(t, plugin, `#topic/${node.id}/edit`);

  page.pressKeyIn('f-src-list', 'data-remove', '2', 'ArrowUp', { altKey: true });

  assert.deepEqual(listed(page), [three[0], three[2], three[1]]);
  assert.equal(page.focusedItem(), '#f-src-list [data-remove="1"]');
  page.pressKeyIn('f-src-list', 'data-remove', '1', 'ArrowUp', { altKey: true });
  assert.deepEqual(listed(page), [three[2], three[0], three[1]]);
  page.pressKeyIn('f-src-list', 'data-down', '0', 'ArrowDown', { altKey: true });
  assert.deepEqual(listed(page), [three[0], three[2], three[1]]);
  assert.equal(page.focusedItem(), '#f-src-list [data-down="1"]');
  page.pressKeyIn('f-src-list', 'data-remove', '1', 'ArrowDown');
  assert.deepEqual(listed(page), [three[0], three[2], three[1]], 'an arrow without Alt moved a row');

  page.byId('form').submit();
  await page.settled();

  assert.deepEqual(await sourcesOf(plugin, node.id), [three[0], three[2], three[1]]);
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
  assert.deepEqual(listed(page), NODE.sources);
  assert.equal(page.byId('f-src-count').textContent, '(2)');
  page.byId('f-q').value = '';
  add(page, 'https://openjsf.org/');
  page.byId('form').submit();
  await page.settled();
  assert.equal(page.hash(), `#topic/${node.id}`);
  const whole = structureOf<{ topic: Topic }>(await plugin.call('get_topic', { id: node.id }));
  assert.equal(whole.topic.question, '');
  assert.deepEqual(whole.topic.sources, [...NODE.sources, 'https://openjsf.org/']);
});

test('an address the Plugin Server refuses shows on its row, and nothing is saved', async (t) => {
  const plugin = await startedAndShaken(t);
  const node = await made(plugin, NODE);
  const page = await openPage(t, plugin, `#topic/${node.id}/edit`);

  page.byId('f-name').value = 'Changed';
  add(page, 'https://[node-24-notes');
  assert.equal(page.byId('f-src-add-err').hidden, true, 'the page refused what the Plugin Server checks');
  page.byId('form').submit();
  await page.settled();

  const rows = page.byId('f-src-list').innerHTML.split('</li>');
  assert.match(rows[2] ?? '', /<li class="src bad" data-src="2">/);
  assert.match(
    rows[2] ?? '',
    /<span class="src-err" id="f-src-row-err">.*<span>Source 3 is not an http or https address: https:\/\/\[node-24-notes\. Change it or remove it\.<\/span><\/span>/,
  );
  assert.match(rows[2] ?? '', /data-remove="2" aria-label="Remove https:\/\/\[node-24-notes" aria-describedby="f-src-row-err"/);
  assert.doesNotMatch(rows[0] ?? '', /bad/);
  assert.equal(page.focusedItem(), '#f-src-list [data-remove="2"]');
  assert.equal(page.byId('form-error').hidden, true);
  assert.equal(page.hash(), `#topic/${node.id}/edit`);
  const whole = structureOf<{ topic: Topic }>(await plugin.call('get_topic', { id: node.id }));
  assert.equal(whole.topic.name, 'Node 24 release');

  page.pressIn('f-src-list', 'data-remove', '2');
  assert.doesNotMatch(page.byId('f-src-list').innerHTML, /src-err/);
  page.byId('form').submit();
  await page.settled();
  assert.equal(page.hash(), `#topic/${node.id}`);
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
