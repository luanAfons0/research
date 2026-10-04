/**
 * research keeps its data in one file, `research.db`, in its own Plugin
 * directory, and git keeps that file out of the repository (FirstMate
 * ADR-0005). A file at a schema this research does not know is refused with a
 * sentence rather than guessed at.
 */
import { strict as assert } from 'node:assert';
import { execFile } from 'node:child_process';
import { readdir, stat } from 'node:fs/promises';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import test from 'node:test';
import { promisify } from 'node:util';
import {
  makeDirectory,
  REPOSITORY,
  startedAndShaken,
  startPluginServer,
} from './helpers/plugin.ts';
import { serveSources } from './helpers/sources.ts';
import { sweepNamed, sweptWhole } from './helpers/sweeps.ts';

const run = promisify(execFile);

test('the data file is made in the Plugin directory, and nowhere else', async (t) => {
  const plugin = await startedAndShaken(t);

  const file = await stat(join(plugin.directory, 'research.db'));

  assert.ok(file.isFile());
  assert.deepEqual(await readdir(plugin.directory), ['research.db']);
  assert.equal(plugin.output(), '');
});

test('the data file is kept when the Plugin Server stops and starts again', async (t) => {
  const first = await startedAndShaken(t);
  first.stop();
  await first.ended();

  const second = await startedAndShaken(t, { directory: first.directory });

  assert.ok((await stat(join(second.directory, 'research.db'))).isFile());
  assert.equal(second.output(), '');
});

test('a Sweep and its Extracts are kept in the data file, and nowhere else', async (t) => {
  const sources = await serveSources(t);
  const first = await startedAndShaken(t);
  const sweep = await sweptWhole(first, [sources.address('/article.html'), sources.address('/missing')]);
  first.stop();
  await first.ended();

  const second = await startedAndShaken(t, { directory: first.directory });

  assert.deepEqual(await sweepNamed(second, sweep.id), sweep);
  assert.deepEqual(await readdir(second.directory), ['research.db']);
  assert.equal(second.output(), '');
});

test('git ignores the data file and the files SQLite keeps beside it', async () => {
  for (const name of ['research.db', 'research.db-journal', 'research.db-wal', 'research.db-shm']) {
    // check-ignore exits 0 when the path is ignored, and 1 when it is not.
    const { stdout } = await run('git', ['check-ignore', name], { cwd: REPOSITORY });

    assert.equal(stdout.trim(), name);
  }
});

test('a file at a schema newer than this research knows is refused with a sentence', async (t) => {
  const directory = await makeDirectory(t);
  const newer = new DatabaseSync(join(directory, 'research.db'));
  newer.exec('PRAGMA user_version = 99');
  newer.close();
  const plugin = await startPluginServer(t, { directory });

  const ending = await plugin.ended();

  assert.notEqual(ending.code, 0);
  assert.ok(plugin.output().startsWith('research: '), plugin.output());
  assert.ok(plugin.output().includes('schema version 99'), plugin.output());
});
