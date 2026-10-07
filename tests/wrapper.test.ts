/**
 * The `mcp` wrapper finds a Node 24 where the Host's service PATH has none.
 *
 * The Host runs under systemd with a PATH that holds only the distribution's
 * Node, which is too old to run TypeScript or to have node:sqlite. These tests
 * give the wrapper exactly that PATH and a home directory with no nvm in it,
 * so the only Node 24 it can find is the one a test puts in its way.
 *
 * The Host runs `mcp.ts` in a `local` Place, and `mcp` only in a `wsl` Place
 * (FirstMate ADR-0028), so these tests are for Linux alone.
 */
import { strict as assert } from 'node:assert';
import { execFileSync } from 'node:child_process';
import { mkdir, symlink } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import test, { type TestContext } from 'node:test';
import { FIXTURES, makeDirectory, startPluginServer } from './helpers/plugin.ts';

/** `mcp` is `sh`, which Windows has no use for: the Host runs `mcp.ts` there. */
const SKIP = process.platform === 'win32' ? 'the sh wrapper `mcp` is for a wsl Place' : false;

/** The PATH a systemd user service gets: no nvm, no login shell. */
const SERVICE_PATH = '/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin';

/** A Node that says it is version 20, as the distribution's Node is. */
const OLD_NODE = join(FIXTURES, 'old-node', 'node');

/**
 * A PATH that holds the old Node and the one tool the wrapper needs, and
 * nothing else. The machine that runs the suite may have a Node 24 in
 * /usr/local/bin, and the service PATH would then find it first.
 */
async function bareBin(t: TestContext): Promise<string> {
  const bin = await makeDirectory(t);
  await symlink(OLD_NODE, join(bin, 'node'));
  const tool = execFileSync('sh', ['-c', 'command -v dirname'], { encoding: 'utf8' }).trim();
  await symlink(tool, join(bin, 'dirname'));
  return bin;
}

test('the wrapper runs the Node that RESEARCH_NODE names when PATH has none new enough', { skip: SKIP }, async (t) => {
  const home = await makeDirectory(t);
  const plugin = await startPluginServer(t, {
    wrapper: true,
    env: { PATH: SERVICE_PATH, HOME: home, RESEARCH_NODE: process.execPath },
  });

  const answer = await plugin.handshake();

  assert.equal(answer.error, undefined, plugin.output());
});

test('the wrapper runs a Node 24 it finds on PATH', { skip: SKIP }, async (t) => {
  const home = await makeDirectory(t);
  const plugin = await startPluginServer(t, {
    wrapper: true,
    env: { PATH: `${dirname(process.execPath)}:${SERVICE_PATH}`, HOME: home, RESEARCH_NODE: '' },
  });

  const answer = await plugin.handshake();

  assert.equal(answer.error, undefined, plugin.output());
});

test('the wrapper runs a Node 24 it finds under nvm when PATH has only an old one', { skip: SKIP }, async (t) => {
  const home = await makeDirectory(t);
  const bin = join(home, '.nvm', 'versions', 'node', 'v24.0.0', 'bin');
  await mkdir(bin, { recursive: true });
  await symlink(process.execPath, join(bin, 'node'));
  const plugin = await startPluginServer(t, {
    wrapper: true,
    env: { PATH: await bareBin(t), HOME: home, RESEARCH_NODE: '' },
  });

  const answer = await plugin.handshake();

  assert.equal(answer.error, undefined, plugin.output());
});

test('a RESEARCH_NODE older than 24 is passed over for a Node 24 on PATH', { skip: SKIP }, async (t) => {
  const home = await makeDirectory(t);
  const plugin = await startPluginServer(t, {
    wrapper: true,
    env: { PATH: `${dirname(process.execPath)}:${SERVICE_PATH}`, HOME: home, RESEARCH_NODE: OLD_NODE },
  });

  const answer = await plugin.handshake();

  assert.equal(answer.error, undefined, plugin.output());
});

test('with no Node 24 anywhere, the wrapper says so in one sentence that names RESEARCH_NODE', { skip: SKIP }, async (t) => {
  const home = await makeDirectory(t);
  const plugin = await startPluginServer(t, {
    wrapper: true,
    env: { PATH: await bareBin(t), HOME: home, RESEARCH_NODE: OLD_NODE },
  });

  const ending = await plugin.ended();

  assert.notEqual(ending.code, 0);
  const said = plugin.output().trim();
  assert.ok(said.includes('RESEARCH_NODE'), `stderr said: ${said}`);
  assert.ok(said.startsWith('research: '), `stderr said: ${said}`);
  assert.equal(said.split('\n').length, 1, `stderr said more than one line: ${said}`);
  assert.equal(plugin.lines().length, 0, 'something reached stdout');
});
