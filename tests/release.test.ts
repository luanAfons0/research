/**
 * The Plugin Release: what `npm run build` writes into `release/`, and that it
 * runs as the Host runs a Plugin (ADR-0033 of FirstMate).
 *
 * The seam is the build command and the folder it writes. Each test reads
 * `release/` as `firstmate install` would find it in the archive, and starts
 * its `mcp.js` in a Plugin directory of its own, with the Host's handshake.
 *
 * The build runs in a copy of the repository that holds a `research.db` and a
 * `settings.json`, as the live Plugin directory does: they are the operator's
 * data, and a Plugin Release must never carry them.
 */
import { strict as assert } from 'node:assert';
import { execFileSync } from 'node:child_process';
import { cp, mkdtemp, readdir, rm, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test, { after } from 'node:test';
import { CLEAN_UP_TIMEOUT_MS, REPOSITORY, startedAndShaken } from './helpers/plugin.ts';

/** The copy of the repository the build runs in, made once for every test. */
const built = (async () => {
  const copy = await mkdtemp(join(tmpdir(), 'research-release-'));
  await cp(REPOSITORY, copy, {
    recursive: true,
    filter: (path) => !/[\\/](node_modules|\.git|release)([\\/]|$)/.test(path.slice(REPOSITORY.length)),
  });
  await symlink(join(REPOSITORY, 'node_modules'), join(copy, 'node_modules'), 'junction');
  await writeFile(join(copy, 'research.db'), 'the operator’s Topics');
  await writeFile(join(copy, 'settings.json'), '{"digestCommand":"mine"}');
  execFileSync(process.execPath, ['build.ts'], { cwd: copy, stdio: 'pipe' });
  return { copy, release: join(copy, 'release') };
})();

after(async () => rm((await built).copy, { recursive: true, force: true }), {
  timeout: CLEAN_UP_TIMEOUT_MS,
});

/** Every path under a folder, with `/`, folders as `name/`. */
async function listing(folder: string, prefix = ''): Promise<string[]> {
  const found: string[] = [];
  for (const entry of await readdir(folder, { withFileTypes: true })) {
    const path = `${prefix}${entry.name}`;
    if (entry.isDirectory()) found.push(`${path}/`, ...(await listing(join(folder, entry.name), `${path}/`)));
    else found.push(path);
  }
  return found.sort();
}

test('release/ holds mcp.js, the mcp wrapper and web/, and no source and no data', async () => {
  const files = await listing((await built).release);
  assert.deepEqual(files, [
    'mcp',
    'mcp.js',
    'web/',
    'web/app.css',
    'web/app.js',
    'web/index.html',
    'web/markdown.js',
    'web/rpc.js',
  ]);
});

test('mcp.js is not minified, so a stack trace stays readable', async () => {
  const { release } = await built;
  const { readFile } = await import('node:fs/promises');
  const text = await readFile(join(release, 'mcp.js'), 'utf8');
  assert.match(text, /\n {2,}\S/, 'the bundle keeps its indentation');
  assert.ok(text.split('\n').length > 200);
});

test('mcp.js answers the Host’s handshake and lists the tools, from the Plugin directory', async (t) => {
  const { release } = await built;
  const plugin = await startedAndShaken(t, { release });
  const answer = await plugin.ask('tools/list');
  assert.equal(answer.error, undefined);
  const tools = (answer.result as { tools: { name: string }[] }).tools;
  assert.ok(tools.length > 0);
});

test('the Plugin Server of a release keeps research.db in the Plugin directory, not in release/', async (t) => {
  const { release } = await built;
  const plugin = await startedAndShaken(t, { release });
  await plugin.ask('tools/list');
  assert.ok((await readdir(plugin.directory)).includes('research.db'));
  assert.ok(!(await listing(release)).includes('research.db'));
});

test(
  'the mcp wrapper of release/ runs mcp.js',
  { skip: process.platform === 'win32' ? 'the sh wrapper is for a wsl Place' : false },
  async (t) => {
    const { release } = await built;
    const plugin = await startedAndShaken(t, { release, wrapper: true });
    assert.equal((await plugin.ask('tools/list')).error, undefined);
  },
);
