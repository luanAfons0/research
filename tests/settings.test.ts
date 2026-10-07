/**
 * research keeps the Digest command an operator sets in a settings file in
 * its own Plugin directory, beside `research.db` (FirstMate ADR-0005), so it
 * works however the Host was started. `RESEARCH_DIGEST_COMMAND` still beats
 * the file, and the file beats the default, which is no command at all.
 *
 * Everything here goes through the tools, as the Plugin Page and the Host do,
 * and reads the files the Plugin Server leaves in its directory.
 */
import { strict as assert } from 'node:assert';
import { execFile } from 'node:child_process';
import { readdir, readFile, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import test from 'node:test';
import { promisify } from 'node:util';
import {
  makeDirectory,
  REPOSITORY,
  startedAndShaken,
  structureOf,
  type Answer,
  type Started,
} from './helpers/plugin.ts';
import { serveSources } from './helpers/sources.ts';
import { DIGEST_COMMAND, DIGEST_PROGRAM, sweptWhole } from './helpers/sweeps.ts';

const run = promisify(execFile);

/** The settings file, in the Plugin directory. */
const FILE = 'settings.json';

/** What get_settings and update_settings answer about the Digest command. */
type DigestSetting = {
  value: string[] | null;
  from: 'environment' | 'file' | 'default';
  saved: string[] | null;
  variable: string;
  problem: string | null;
  ignored: string | null;
};

/** The Digest command, as the settings tools answer it. */
function digestOf(answer: Answer): DigestSetting {
  return structureOf<{ settings: { digestCommand: DigestSetting } }>(answer).settings
    .digestCommand;
}

/** Stop a Plugin Server the way the Host does, and wait for it to end. */
async function stopped(plugin: Started): Promise<void> {
  plugin.stop();
  await plugin.ended();
}

test('it ships get_settings and update_settings, with schemas', async (t) => {
  const plugin = await startedAndShaken(t);

  const answer = await plugin.ask('tools/list');

  const tools = (answer.result as { tools: { name: string; inputSchema: unknown }[] }).tools;
  for (const name of ['get_settings', 'update_settings']) {
    const tool = tools.find((each) => each.name === name);
    assert.ok(tool !== undefined, `${name} is not in tools/list`);
    assert.equal((tool.inputSchema as { type: string }).type, 'object');
  }
});

test('with nothing set, get_settings says there is no Digest command, by default', async (t) => {
  const plugin = await startedAndShaken(t);

  const setting = digestOf(await plugin.call('get_settings'));

  assert.deepEqual(setting, {
    value: null,
    from: 'default',
    saved: null,
    variable: 'RESEARCH_DIGEST_COMMAND',
    problem: null,
    ignored: null,
  });
  assert.deepEqual(await readdir(plugin.directory), ['research.db']);
});

test('a Digest command set through update_settings is kept in the Plugin directory, survives a restart, and makes the next Digest', async (t) => {
  const sources = await serveSources(t);
  const first = await startedAndShaken(t);
  const command = [DIGEST_PROGRAM, '--quiet'];

  const answered = digestOf(await first.call('update_settings', { digestCommand: command }));
  await stopped(first);
  const second = await startedAndShaken(t, { directory: first.directory });
  const read = digestOf(await second.call('get_settings'));
  const sweep = await sweptWhole(second, [sources.address('/notes.txt')]);

  assert.deepEqual(answered, {
    value: command,
    from: 'file',
    saved: command,
    variable: 'RESEARCH_DIGEST_COMMAND',
    problem: null,
    ignored: null,
  });
  assert.deepEqual(read, answered);
  assert.deepEqual(JSON.parse(await readFile(join(first.directory, FILE), 'utf8')), {
    digestCommand: command,
  });
  assert.equal(sweep.state, 'done', String(sweep.reason));
  assert.equal(second.output(), '');
});

test('RESEARCH_DIGEST_COMMAND beats the file, and the settings tools say the environment decides it', async (t) => {
  const sources = await serveSources(t);
  const directory = await makeDirectory(t);
  const saved = ['no-such-model-runner', '--fast'];
  await writeFile(join(directory, FILE), JSON.stringify({ digestCommand: saved }));
  const plugin = await startedAndShaken(t, {
    directory,
    env: { RESEARCH_DIGEST_COMMAND: DIGEST_COMMAND },
  });

  const read = digestOf(await plugin.call('get_settings'));
  const changed = digestOf(
    await plugin.call('update_settings', { digestCommand: ['another-runner'] }),
  );
  const sweep = await sweptWhole(plugin, [sources.address('/notes.txt')]);

  assert.deepEqual(read, {
    value: [DIGEST_PROGRAM],
    from: 'environment',
    saved,
    variable: 'RESEARCH_DIGEST_COMMAND',
    problem: null,
    ignored: null,
  });
  assert.deepEqual(changed, { ...read, saved: ['another-runner'] });
  assert.equal(sweep.state, 'done', String(sweep.reason));
});

for (const [what, given] of [
  ['a shell line', 'ollama run llama3.2'],
  ['an empty list', []],
  ['a list with no program', ['', '--fast']],
  ['a list with a number in it', ['ollama', 3]],
  ['an object', { program: 'ollama' }],
] as const) {
  test(`${what} is refused with one sentence, and the file is left as it was`, async (t) => {
    const plugin = await startedAndShaken(t);
    await plugin.call('update_settings', { digestCommand: [DIGEST_PROGRAM] });
    const before = await readFile(join(plugin.directory, FILE), 'utf8');

    const answer = await plugin.call('update_settings', { digestCommand: given });

    assert.equal(
      answer.error?.message,
      `update_settings: digestCommand is ${JSON.stringify(given)}; set it to a JSON array of ` +
        'strings, the program first and then each of its arguments, such as ' +
        '["ollama","run","<model>"], or to null for none.',
    );
    assert.equal(await readFile(join(plugin.directory, FILE), 'utf8'), before);
    assert.deepEqual(digestOf(await plugin.call('get_settings')).value, [DIGEST_PROGRAM]);
  });
}

test('a refused value makes no settings file where there was none', async (t) => {
  const plugin = await startedAndShaken(t);

  const answer = await plugin.call('update_settings', { digestCommand: 'ollama run llama3.2' });

  assert.ok(answer.error !== undefined);
  assert.deepEqual(await readdir(plugin.directory), ['research.db']);
});

test('null takes the Digest command out, and the next Sweep says no Digest command is set', async (t) => {
  const sources = await serveSources(t);
  const plugin = await startedAndShaken(t);
  await plugin.call('update_settings', { digestCommand: [DIGEST_PROGRAM] });

  const cleared = digestOf(await plugin.call('update_settings', { digestCommand: null }));
  const sweep = await sweptWhole(plugin, [sources.address('/notes.txt')]);

  assert.equal(cleared.value, null);
  assert.equal(cleared.from, 'default');
  assert.deepEqual(JSON.parse(await readFile(join(plugin.directory, FILE), 'utf8')), {});
  assert.equal(sweep.state, 'failed');
  assert.equal(sweep.reason, 'no Digest command is set; set one in Settings');
  assert.equal(sweep.failure, 'no-digest-command');
});

test('a key of the settings file that research does not know is kept', async (t) => {
  const directory = await makeDirectory(t);
  await writeFile(join(directory, FILE), JSON.stringify({ later: { kept: true } }));
  const plugin = await startedAndShaken(t, { directory });

  await plugin.call('update_settings', { digestCommand: [DIGEST_PROGRAM] });

  assert.deepEqual(JSON.parse(await readFile(join(directory, FILE), 'utf8')), {
    later: { kept: true },
    digestCommand: [DIGEST_PROGRAM],
  });
});

test('a program the settings file names that is not on the PATH fails the Sweep, and says where to fix it', async (t) => {
  const sources = await serveSources(t);
  const plugin = await startedAndShaken(t);
  await plugin.call('update_settings', { digestCommand: ['no-such-model-runner'] });

  const sweep = await sweptWhole(plugin, [sources.address('/notes.txt')]);
  const again = await plugin.call('make_digest', { id: sweep.id });

  assert.equal(
    sweep.reason,
    'the Digest command failed: "no-such-model-runner" is not found on the PATH; give its ' +
      'absolute path in Settings',
  );
  assert.equal(
    again.error?.message,
    'The Digest command in Settings names "no-such-model-runner", which is not found on the ' +
      "Host's PATH. Give its absolute path: a command installed through nvm is not on the " +
      'PATH of the Host service.',
  );
});

for (const [what, text, said, after] of [
  [
    'that is not JSON',
    'digestCommand = ollama',
    'is not a JSON object; save the Digest command in Settings to write it again.',
    {},
  ],
  [
    'whose Digest command is not a list',
    '{"digestCommand":"ollama run x","later":1}',
    'holds the Digest command "ollama run x"; set it to a JSON array of strings, the ' +
      'program first and then each of its arguments, such as ["ollama","run","<model>"], ' +
      'in Settings.',
    { later: 1 },
  ],
] as const) {
  test(`a settings file ${what} keeps the Plugin Server up, refuses Digests with a sentence that names it, and a save replaces it`, async (t) => {
    const sources = await serveSources(t);
    const directory = await makeDirectory(t);
    const path = join(directory, FILE);
    await writeFile(path, text);
    const plugin = await startedAndShaken(t, { directory });
    const problem = `${resolve(path)} ${said}`;

    const read = digestOf(await plugin.call('get_settings'));
    const sweep = await sweptWhole(plugin, [sources.address('/notes.txt')]);
    const again = await plugin.call('make_digest', { id: sweep.id });
    const saved = digestOf(
      await plugin.call('update_settings', { digestCommand: [DIGEST_PROGRAM] }),
    );
    const remade = await plugin.call('make_digest', { id: sweep.id });

    assert.deepEqual(read, {
      value: null,
      from: 'file',
      saved: null,
      variable: 'RESEARCH_DIGEST_COMMAND',
      problem,
      ignored: null,
    });
    assert.equal(sweep.state, 'failed');
    assert.equal(sweep.reason, `the Digest command failed: ${problem.slice(0, -1)}`);
    assert.equal(again.error?.message, problem);
    assert.equal(again.error?.code, -32602);
    assert.equal(saved.problem, null);
    assert.deepEqual(saved.value, [DIGEST_PROGRAM]);
    assert.deepEqual(JSON.parse(await readFile(path, 'utf8')), {
      ...after,
      digestCommand: [DIGEST_PROGRAM],
    });
    assert.equal(remade.error, undefined);
    assert.equal(plugin.output(), '');
  });
}

test('git ignores the settings file', async () => {
  // check-ignore exits 0 when the path is ignored, and 1 when it is not.
  const { stdout } = await run('git', ['check-ignore', FILE], { cwd: REPOSITORY });

  assert.equal(stdout.trim(), FILE);
});
