/**
 * The Plugin Page, as the bytes a browser is served.
 *
 * The Host returns a Plugin's `web/` directory unchanged (FirstMate ADR-0008),
 * so what this test reads off disk is exactly what a browser gets. It asserts
 * the things the Host will not check for you and that break a Page after it is
 * registered: a path that is not relative, an asset that is not there, and an
 * element the script reaches for that the markup does not declare.
 *
 * `rpc.js` is also run as a browser runs it, in a fresh `node:vm` context,
 * against the real Plugin Server behind a small stand-in for the Host's `rpc`
 * address: the page's own call reaches the real `tools/list`.
 */
import { strict as assert } from 'node:assert';
import { readFile, stat } from 'node:fs/promises';
import { createServer } from 'node:http';
import type { AddressInfo } from 'node:net';
import { join } from 'node:path';
import test, { type TestContext } from 'node:test';
import { createContext, runInContext } from 'node:vm';
import { REPOSITORY, startedAndShaken, type Started } from './helpers/plugin.ts';

const WEB = join(REPOSITORY, 'web');

/** Every page in web/, and the script each one runs. */
const PAGES = [{ page: 'index.html', script: 'app.js' }];

/** Every `href` and `src` the page names, in the order it names them. */
function pathsIn(html: string): string[] {
  return [...html.matchAll(/(?:href|src)="([^"]*)"/g)].map((found) => found[1] ?? '');
}

test('the Plugin Page is served as index.html', async () => {
  const page = await stat(join(WEB, 'index.html'));

  assert.ok(page.isFile());
});

for (const { page, script } of PAGES) {
  test(`every path in ${page} is relative, so nothing assumes an address it does not own`, async () => {
    const html = await readFile(join(WEB, page), 'utf8');

    for (const path of pathsIn(html)) {
      if (path.startsWith('data:')) continue;
      assert.ok(!path.startsWith('/'), `${path} assumes it is served from the root`);
      assert.ok(!/^[a-z]+:/i.test(path), `${path} reaches outside the Plugin`);
    }
  });

  test(`every asset ${page} names is beside it in web/, because there is no build step`, async () => {
    const html = await readFile(join(WEB, page), 'utf8');

    for (const path of pathsIn(html)) {
      if (path.startsWith('data:') || path.startsWith('#')) continue;
      const asset = await stat(join(WEB, path));
      assert.ok(asset.isFile(), `${path} is named by ${page} and is not in web/`);
    }
  });

  test(`${page} has no script or style of its own, only files beside it`, async () => {
    const html = await readFile(join(WEB, page), 'utf8');

    assert.doesNotMatch(html, /<script(?![^>]*\ssrc=)[^>]*>/, `${page} has an inline script`);
    assert.doesNotMatch(html, /<style[\s>]/, `${page} has an inline style`);
    assert.doesNotMatch(html, /\sstyle="/, `${page} has an inline style attribute`);
  });

  test(`every element ${script} reaches for is one ${page} declares`, async () => {
    // The Page is the one part of this Plugin no test can drive, so this is
    // the mistake worth catching without a browser: a renamed id leaves the
    // script reading null and the Page blank, and nothing else would say so.
    const html = await readFile(join(WEB, page), 'utf8');
    const code = await readFile(join(WEB, script), 'utf8');
    const declared = new Set([...html.matchAll(/\sid="([^"]+)"/g)].map((found) => found[1]));

    for (const found of code.matchAll(/byId\('([^']+)'\)/g)) {
      assert.ok(declared.has(found[1]), `${script} reaches for #${found[1]}, which ${page} lacks`);
    }
  });

  test(`${page} reaches its Plugin Server through rpc.js, loaded before ${script}`, async () => {
    const html = await readFile(join(WEB, page), 'utf8');
    const code = await readFile(join(WEB, script), 'utf8');
    const paths = pathsIn(html);

    assert.ok(paths.includes('rpc.js'), `${page} does not load rpc.js`);
    assert.ok(paths.indexOf('rpc.js') < paths.indexOf(script), 'rpc.js loads too late');
    assert.ok(!code.includes('/p/research'), `${script} names the Plugin's address by hand`);
    assert.ok(!code.includes('fetch('), `${script} calls the Host without rpc.js`);
  });

  test(`no name is declared twice across the scripts ${page} loads`, async () => {
    // Classic scripts share one global scope, so a name two of them declare at
    // the top stops the second one dead, and the page is blank with no test
    // to say why.
    const html = await readFile(join(WEB, page), 'utf8');
    const seen = new Map<string, string>();
    for (const script of pathsIn(html).filter((path) => path.endsWith('.js'))) {
      const code = await readFile(join(WEB, script), 'utf8');
      for (const found of code.matchAll(
        /^(?:const|let|var|function|async function|class)\s+([A-Za-z_$][\w$]*)/gm,
      )) {
        const name = found[1] ?? '';
        assert.ok(!seen.has(name), `${name} is declared by ${seen.get(name)} and by ${script}`);
        seen.set(name, script);
      }
    }
  });
}

test('app.js asks the Plugin Server for its tools when the page loads', async () => {
  const code = await readFile(join(WEB, 'app.js'), 'utf8');

  assert.match(code, /^start\(\);$/m, 'app.js does not start when it loads');
  assert.match(code, /await listTools\(\)/, 'app.js does not call listTools');
});

test('rpc.js reaches the tools over the relative rpc address, never an absolute one', async () => {
  const code = await readFile(join(WEB, 'rpc.js'), 'utf8');

  assert.match(code, /const RPC = 'rpc';/);
  assert.ok(!code.includes('/p/research'), "rpc.js names the Plugin's address by hand");
});

/**
 * A stand-in for the Host's `POST /p/research/rpc`: it hands each JSON-RPC body
 * to the real Plugin Server and returns the answer with the caller's own id.
 */
async function hostFor(t: TestContext, plugin: Started): Promise<string> {
  const server = createServer(async (request, response) => {
    if (request.method !== 'POST' || request.url !== '/p/research/rpc') {
      response.writeHead(404).end();
      return;
    }
    let body = '';
    for await (const chunk of request) body += String(chunk);
    const asked = JSON.parse(body) as { id: unknown; method: string; params?: unknown };
    const answer = await plugin.ask(asked.method, asked.params);
    response.writeHead(200, { 'content-type': 'application/json' });
    response.end(JSON.stringify({ jsonrpc: '2.0', id: asked.id, ...answer }));
  });
  await new Promise<void>((listening) => server.listen(0, '127.0.0.1', listening));
  t.after(() => new Promise<void>((closed) => server.close(() => closed())));
  return `http://127.0.0.1:${(server.address() as AddressInfo).port}/p/research/`;
}

/** rpc.js, run as a browser runs it, on a page served at `page`. */
async function rpcAt(page: string): Promise<Record<string, unknown>> {
  const code = await readFile(join(WEB, 'rpc.js'), 'utf8');
  // A browser resolves a relative address against the page; Node's fetch has
  // no page, so the context's fetch does that one step and nothing more.
  const context = createContext({
    fetch: (address: string, init: RequestInit) => fetch(new URL(address, page), init),
  });
  runInContext(code, context);
  return context;
}

test("the page's rpc asks the real Plugin Server for its tools, through the rpc address", async (t) => {
  const plugin = await startedAndShaken(t);
  const rpc = await rpcAt(await hostFor(t, plugin));
  const listTools = rpc['listTools'] as () => Promise<unknown[]>;

  const tools = await listTools();

  const answer = await plugin.ask('tools/list');
  assert.deepEqual(tools, (answer.result as { tools: unknown[] }).tools);
});

test("the page's rpc turns a refusal into a sentence", async (t) => {
  const plugin = await startedAndShaken(t);
  const rpc = await rpcAt(await hostFor(t, plugin));
  const call = rpc['call'] as (name: string) => Promise<unknown>;

  await assert.rejects(call('polish_boots'), /polish_boots/);
});
