/**
 * The outside world a Sweep reads: the fixture pages in
 * `tests/fixtures/sources/`, served over HTTP on 127.0.0.1 by a small server
 * each test starts on a port the system picks.
 *
 * It is a fixture, not a mock: research fetches real pages over a real
 * socket, exactly as it fetches the web. Beside the files, a few addresses
 * answer the ways the web goes wrong:
 *
 * - `/missing` answers 404;
 * - `/moved` redirects to `/article.html`;
 * - `/silent` takes the request and never answers;
 * - `/large` answers a page larger than research reads;
 * - `/held/<file>` waits until the test calls `release()`, then serves the file.
 *
 * It records each request with the User-Agent it came with, and the most
 * requests it held open at the same time.
 */
import { readFile } from 'node:fs/promises';
import { createServer, type ServerResponse } from 'node:http';
import type { AddressInfo } from 'node:net';
import { extname, join } from 'node:path';
import type { TestContext } from 'node:test';
import { FIXTURES } from './plugin.ts';

/** Where the fixture pages are. */
export const PAGES = join(FIXTURES, 'sources');

/** The type each fixture file is served with, by its extension. */
const TYPES: Readonly<Record<string, string>> = {
  '.html': 'text/html; charset=utf-8',
  '.txt': 'text/plain; charset=utf-8',
  '.pdf': 'application/pdf',
};

/** One request the server took. */
export type Request = {
  readonly path: string;
  readonly userAgent: string | undefined;
};

/** The running fixture server. */
export type Sources = {
  /** The whole address of a path on this server, such as `/article.html`. */
  address(path: string): string;
  /** Every request so far, in the order they came. */
  requests(): readonly Request[];
  /** The most requests the server held open at the same time. */
  mostAtOnce(): number;
  /** How many requests are waiting under `/held/` now. */
  held(): number;
  /** Let every request under `/held/` be answered, now and from now on. */
  release(): void;
};

/** Start the fixture server for one test. It closes when the test ends. */
export async function serveSources(t: TestContext): Promise<Sources> {
  const requests: Request[] = [];
  let open = 0;
  let most = 0;
  let released = false;
  let waiting: (() => void)[] = [];

  const serveFile = async (name: string, response: ServerResponse): Promise<void> => {
    const type = TYPES[extname(name)];
    let body: Buffer;
    try {
      if (type === undefined || name.includes('..')) throw new Error('no such fixture');
      body = await readFile(join(PAGES, name));
    } catch {
      response.writeHead(404, { 'content-type': 'text/html' }).end('<p>No such page.</p>');
      return;
    }
    response.writeHead(200, { 'content-type': type }).end(body);
  };

  const server = createServer(async (request, response) => {
    const path = request.url ?? '/';
    requests.push({ path, userAgent: request.headers['user-agent'] });
    open += 1;
    most = Math.max(most, open);
    response.once('close', () => (open -= 1));

    if (path === '/missing') {
      response.writeHead(404, { 'content-type': 'text/html' }).end('<p>No such page.</p>');
    } else if (path === '/moved') {
      response.writeHead(302, { location: '/article.html' }).end();
    } else if (path === '/silent') {
      // Never answered: research gives up on it when its time is out.
    } else if (path === '/large') {
      response.writeHead(200, { 'content-type': 'text/html' });
      const chunk = `<p>${'x'.repeat(64 * 1024)}</p>`;
      for (let sent = 0; sent < 6 * 1024 * 1024; sent += chunk.length) {
        if (!response.write(chunk)) await new Promise((drained) => response.once('drain', drained));
        if (response.destroyed) return;
      }
      response.end();
    } else if (path.startsWith('/held/')) {
      if (!released) await new Promise<void>((go) => waiting.push(go));
      await serveFile(path.slice('/held/'.length), response);
    } else {
      await serveFile(path.slice(1), response);
    }
  });
  await new Promise<void>((listening) => server.listen(0, '127.0.0.1', listening));
  t.after(
    () =>
      new Promise<void>((closed) => {
        server.closeAllConnections();
        server.close(() => closed());
      }),
  );
  const port = (server.address() as AddressInfo).port;

  return {
    address: (path) => `http://127.0.0.1:${port}${path}`,
    requests: () => requests,
    mostAtOnce: () => most,
    held: () => waiting.length,
    release: () => {
      released = true;
      for (const go of waiting) go();
      waiting = [];
    },
  };
}

/** An address on 127.0.0.1 where nothing listens, for a Source that cannot be reached. */
export async function nobodyThere(): Promise<string> {
  const server = createServer();
  await new Promise<void>((listening) => server.listen(0, '127.0.0.1', listening));
  const port = (server.address() as AddressInfo).port;
  await new Promise<void>((closed) => server.close(() => closed()));
  return `http://127.0.0.1:${port}/`;
}
