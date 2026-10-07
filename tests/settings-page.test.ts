/**
 * The Plugin Page shows the Digest command at `#settings`, changes it through
 * update_settings, shows the one sentence the Plugin Server refuses a bad
 * value with, and says when the environment decides the command instead.
 *
 * The page's own scripts run as a browser runs them, against the real Plugin
 * Server, through `tests/helpers/page.ts`. A test reads what a person would
 * see, and asks the Plugin Server what it kept.
 */
import { strict as assert } from 'node:assert';
import { writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import test from 'node:test';
import { openPage } from './helpers/page.ts';
import {
  makeDirectory,
  type Started,
  startedAndShaken,
  structureOf,
} from './helpers/plugin.ts';
import { serveSources } from './helpers/sources.ts';
import { DIGEST_COMMAND, DIGEST_PROGRAM, ended, sweepOf, topicWith } from './helpers/sweeps.ts';

/** The Digest command research uses now, as get_settings says it. */
async function digestCommand(plugin: Started): Promise<string[] | null> {
  return structureOf<{ settings: { digestCommand: { value: string[] | null } } }>(
    await plugin.call('get_settings'),
  ).settings.digestCommand.value;
}

test('#settings shows the Settings, and the Topic list and the rail lead there', async (t) => {
  const plugin = await startedAndShaken(t);
  const page = await openPage(t, plugin);
  assert.equal(page.byId('settings-view').hidden, true);

  page.byId('settings-link').click();
  await page.settled();

  assert.equal(page.hash(), '#settings');
  assert.equal(page.byId('settings-view').hidden, false);
  assert.equal(page.byId('index').hidden, true);
  assert.equal(page.byId('topic-view').hidden, true);
  assert.equal(page.byId('form-view').hidden, true);
  assert.ok(page.called().includes('get_settings'));

  page.go('#');
  await page.settled();
  page.byId('settings-rail').click();
  await page.settled();

  assert.equal(page.hash(), '#settings');
});

test('with no Digest command, Settings says that none is set and what that means', async (t) => {
  const plugin = await startedAndShaken(t);

  const page = await openPage(t, plugin, '#settings');

  assert.equal(page.byId('s-digest').value, '');
  assert.equal(page.byId('s-digest-none').hidden, false);
  assert.equal(page.byId('s-digest-env').hidden, true);
});

test('Settings shows the saved Digest command, and saves a new one', async (t) => {
  const plugin = await startedAndShaken(t);
  await plugin.call('update_settings', { digestCommand: [DIGEST_PROGRAM, '--quiet'] });
  const page = await openPage(t, plugin, '#settings');
  assert.equal(page.byId('s-digest').value, JSON.stringify([DIGEST_PROGRAM, '--quiet']));
  assert.equal(page.byId('s-digest-none').hidden, true);
  assert.equal(page.byId('s-saved').hidden, true);

  page.type('s-digest', '["ollama", "run", "llama3.2"]');
  page.byId('settings-form').submit();
  await page.settled();

  assert.ok(page.called().includes('update_settings'));
  assert.deepEqual(await digestCommand(plugin), ['ollama', 'run', 'llama3.2']);
  assert.equal(page.byId('s-digest').value, '["ollama","run","llama3.2"]');
  assert.equal(page.byId('s-saved').hidden, false);
  assert.equal(page.byId('s-digest-err').hidden, true);
});

test('a value the Plugin Server refuses shows its sentence under the field, and nothing is saved', async (t) => {
  const plugin = await startedAndShaken(t);
  await plugin.call('update_settings', { digestCommand: [DIGEST_PROGRAM] });
  const page = await openPage(t, plugin, '#settings');

  page.type('s-digest', 'ollama run llama3.2');
  page.byId('settings-form').submit();
  await page.settled();

  assert.equal(page.byId('s-digest-err').hidden, false);
  assert.equal(
    page.byId('s-digest-err-text').textContent,
    'update_settings: digestCommand is "ollama run llama3.2"; set it to a JSON array of ' +
      'strings, the program first and then each of its arguments, such as ' +
      '["ollama","run","<model>"], or to null for none.',
  );
  assert.equal(page.byId('s-digest').getAttribute('aria-invalid'), 'true');
  assert.equal(page.byId('s-digest').value, 'ollama run llama3.2');
  assert.equal(page.byId('s-saved').hidden, true);
  assert.deepEqual(await digestCommand(plugin), [DIGEST_PROGRAM]);

  page.type('s-digest', '["ollama"]');

  assert.equal(page.byId('s-digest-err').hidden, true);
  assert.equal(page.byId('s-digest').getAttribute('aria-invalid'), null);
});

test('an empty field takes the Digest command out', async (t) => {
  const plugin = await startedAndShaken(t);
  await plugin.call('update_settings', { digestCommand: [DIGEST_PROGRAM] });
  const page = await openPage(t, plugin, '#settings');

  page.type('s-digest', '  ');
  page.byId('settings-form').submit();
  await page.settled();

  assert.equal(await digestCommand(plugin), null);
  assert.equal(page.byId('s-digest-none').hidden, false);
  assert.equal(page.byId('s-saved').hidden, false);
});

test('with RESEARCH_DIGEST_COMMAND set, Settings says the environment decides, and shows its command', async (t) => {
  const plugin = await startedAndShaken(t, { env: { RESEARCH_DIGEST_COMMAND: DIGEST_COMMAND } });
  await plugin.call('update_settings', { digestCommand: ['ollama', 'run', 'llama3.2'] });

  const page = await openPage(t, plugin, '#settings');

  assert.equal(page.byId('s-digest-env').hidden, false);
  assert.equal(
    page.byId('s-digest-env-why').innerHTML,
    'The Host was started with <code>RESEARCH_DIGEST_COMMAND</code>, so research runs ' +
      `<code>${JSON.stringify([DIGEST_PROGRAM]).replace(/"/g, '&quot;')}</code>, whatever is ` +
      'saved here. To use what is saved here, take the variable out where the Host is started.',
  );
  assert.equal(page.byId('s-digest').value, '["ollama","run","llama3.2"]');
  assert.equal(page.byId('s-digest-none').hidden, true);
});

test('with RESEARCH_DIGEST_COMMAND in the old shell-line form, Settings says it is ignored and to remove it, and the command saved here decides', async (t) => {
  const plugin = await startedAndShaken(t, {
    env: { RESEARCH_DIGEST_COMMAND: 'ollama run llama3.2' },
  });

  const page = await openPage(t, plugin, '#settings');

  assert.equal(page.byId('s-digest-env').hidden, true);
  assert.equal(page.byId('s-digest-ignored').hidden, false);
  assert.equal(
    page.byId('s-digest-ignored-text').textContent,
    'RESEARCH_DIGEST_COMMAND is ollama run llama3.2, which is not a JSON array of strings, ' +
      'the program first and then each of its arguments, such as ["ollama","run","<model>"], ' +
      'so research ignores it. Remove it from where the Host is started, such as the ' +
      'systemd drop-in of research 1.x, and set the Digest command in Settings.',
  );
  assert.equal(page.byId('s-digest-none').hidden, false);

  page.type('s-digest', JSON.stringify([DIGEST_PROGRAM]));
  page.byId('settings-form').submit();
  await page.settled();

  assert.deepEqual(await digestCommand(plugin), [DIGEST_PROGRAM]);
  assert.equal(page.byId('s-digest-none').hidden, true);
  assert.equal(page.byId('s-digest-ignored').hidden, false);
});

test('with a settings file that is not a JSON object, Settings shows why, and a save writes it again', async (t) => {
  const directory = await makeDirectory(t);
  const path = join(directory, 'settings.json');
  await writeFile(path, 'digestCommand = ollama');
  const plugin = await startedAndShaken(t, { directory });
  const page = await openPage(t, plugin, '#settings');
  assert.equal(page.byId('s-digest-problem').hidden, false);
  assert.equal(
    page.byId('s-digest-problem-text').textContent,
    `${resolve(path)} is not a JSON object; save the Digest command in Settings to write it ` +
      'again.',
  );
  assert.equal(page.byId('s-digest-env').hidden, true);
  assert.equal(page.byId('s-digest-none').hidden, true);

  page.type('s-digest', JSON.stringify([DIGEST_PROGRAM]));
  page.byId('settings-form').submit();
  await page.settled();

  assert.equal(page.byId('s-digest-problem').hidden, true);
  assert.equal(page.byId('s-saved').hidden, false);
  assert.deepEqual(await digestCommand(plugin), [DIGEST_PROGRAM]);
});

test('a Sweep with no Digest command says to set one in Settings, with a link there', async (t) => {
  const sources = await serveSources(t);
  const plugin = await startedAndShaken(t);
  const topic = await topicWith(plugin, [sources.address('/notes.txt')]);
  await ended(plugin, (await sweepOf(plugin, topic)).id);

  const page = await openPage(t, plugin, `#topic/${topic}`);

  assert.equal(page.byId('failed-what').textContent, 'Sweep failed: no Digest command is set');
  assert.equal(
    page.byId('failed-why').innerHTML,
    'Set one in <a href="#settings">Settings</a>, then make the Digest again. ' +
      'The 1 Extract this Sweep read is kept.',
  );
});

test('a Sweep kept with the reason research gave before Settings still says to set one in Settings', async (t) => {
  const sources = await serveSources(t);
  const first = await startedAndShaken(t);
  const topic = await topicWith(first, [sources.address('/notes.txt')]);
  const sweep = await ended(first, (await sweepOf(first, topic)).id);
  first.stop();
  await first.ended();
  const file = new DatabaseSync(join(first.directory, 'research.db'));
  file
    .prepare('UPDATE sweeps SET reason = ? WHERE id = ?')
    .run('no Digest command is set in RESEARCH_DIGEST_COMMAND', sweep.id);
  file.close();
  const plugin = await startedAndShaken(t, { directory: first.directory });

  const page = await openPage(t, plugin, `#topic/${topic}`);

  assert.equal(page.byId('failed-what').textContent, 'Sweep failed: no Digest command is set');
  assert.equal(
    page.byId('failed-why').innerHTML,
    'Set one in <a href="#settings">Settings</a>, then make the Digest again. ' +
      'The 1 Extract this Sweep read is kept.',
  );
});

test('a program in Settings that is not found says to fix it in Settings, with a link there', async (t) => {
  const sources = await serveSources(t);
  const plugin = await startedAndShaken(t);
  await plugin.call('update_settings', { digestCommand: ['no-such-model-runner'] });
  const topic = await topicWith(plugin, [sources.address('/notes.txt')]);
  await ended(plugin, (await sweepOf(plugin, topic)).id);

  const page = await openPage(t, plugin, `#topic/${topic}`);

  assert.equal(
    page.byId('failed-why').innerHTML,
    '&quot;no-such-model-runner&quot; is not found on the PATH; give its absolute path in ' +
      'Settings. <a href="#settings">Open Settings</a>',
  );
});
