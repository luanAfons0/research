/**
 * The seam for the Plugin Page: its own scripts, run as a browser runs them,
 * against the real Plugin Server.
 *
 * The Host serves `web/` byte for byte (FirstMate ADR-0008), so the scripts a
 * test runs are read off disk, exactly as a browser is served them, into one
 * fresh `node:vm` context. Two small stand-ins sit around them, and nothing
 * else does:
 *
 * - the Host's `POST /p/research/rpc`, which hands each JSON-RPC body to the
 *   real Plugin Server, so every tool the page calls is the real one;
 * - the part of a browser the page touches: the elements `index.html`
 *   declares, by id, with the `hidden` each one starts with; their events;
 *   and the address fragment with its `hashchange`.
 *
 * A test drives the page as a person would (open an address, press a button,
 * type, press Escape) and reads what a person would see. No module of
 * research is imported, and no tool is faked.
 */
import { readFile } from 'node:fs/promises';
import { createServer } from 'node:http';
import type { AddressInfo } from 'node:net';
import { join } from 'node:path';
import type { TestContext } from 'node:test';
import { createContext, runInContext } from 'node:vm';
import { REPOSITORY, type Started } from './plugin.ts';

/** The Plugin Page's directory, as the Host serves it. */
export const WEB = join(REPOSITORY, 'web');

/** How long a test waits for the page to settle before it gives up. */
const SETTLE_TIMEOUT_MS = 10_000;

/**
 * A stand-in for the Host's `POST /p/research/rpc`: it hands each JSON-RPC body
 * to the real Plugin Server and returns the answer with the caller's own id.
 * It hands back the address the page is served from.
 */
export async function hostFor(t: TestContext, plugin: Started): Promise<string> {
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

/** One event as the page's listeners get it. */
type PageEvent = {
  readonly type: string;
  readonly target: PageElement;
  readonly key?: string;
  preventDefault(): void;
};

type Listener = (event: PageEvent) => unknown;

/** One element of `index.html`, as much of it as the page touches. */
export type PageElement = {
  readonly id: string;
  hidden: boolean;
  disabled: boolean;
  textContent: string;
  innerHTML: string;
  value: string;
  title: string;
  readonly classList: {
    add(name: string): void;
    remove(name: string): void;
    toggle(name: string, on?: boolean): boolean;
    contains(name: string): boolean;
  };
  setAttribute(name: string, value: string): void;
  getAttribute(name: string): string | null;
  removeAttribute(name: string): void;
  addEventListener(type: string, listener: Listener): void;
  focus(): void;
  /** Press it, as a person does. */
  click(): void;
  /** Send its form, as Enter or the submit button does. */
  submit(): void;
};

/** The Plugin Page, open at one address, and what a person can do with it. */
export type OpenPage = {
  /** The element of `index.html` with this id, as the page left it. */
  byId(id: string): PageElement;
  /** Go to this address fragment, as a click on a link or a Notice does. */
  go(hash: string): void;
  /** The address fragment the page is at now. */
  hash(): string;
  /** Press a key with nothing in particular focused. */
  key(name: string): void;
  /** The element that has focus, or null. */
  focused(): PageElement | null;
  /** Every tool the page has called, by name, in order. */
  called(): readonly string[];
  /** Wait until no request is in flight and no address change is pending. */
  settled(): Promise<void>;
};

/** Every id `index.html` declares, with whether its tag starts `hidden`. */
function declared(html: string): Map<string, boolean> {
  const ids = new Map<string, boolean>();
  for (const found of html.matchAll(/<[a-z][^>]*\sid="([^"]+)"[^>]*>/g)) {
    ids.set(found[1] ?? '', /\shidden[\s>]/.test(found[0]));
  }
  return ids;
}

/**
 * Open the Plugin Page at this address fragment, against this Plugin Server,
 * and wait for it to settle.
 */
export async function openPage(t: TestContext, plugin: Started, hash = ''): Promise<OpenPage> {
  const page = await hostFor(t, plugin);
  const html = await readFile(join(WEB, 'index.html'), 'utf8');
  const scripts = [...html.matchAll(/<script src="([^"]+)"><\/script>/g)].map((found) => found[1]);

  const documentListeners = new Map<string, Listener[]>();
  const windowListeners = new Map<string, Listener[]>();
  const called: string[] = [];
  let inFlight = 0;
  let pendingHash = 0;
  let fragment = hash === '' || hash.startsWith('#') ? hash : `#${hash}`;
  let focused: PageElement | null = null;

  const fire = (listeners: Map<string, Listener[]>, event: PageEvent): void => {
    for (const listener of listeners.get(event.type) ?? []) listener(event);
  };
  const eventFor = (type: string, target: PageElement, key?: string): PageEvent => ({
    type,
    target,
    ...(key === undefined ? {} : { key }),
    preventDefault: () => undefined,
  });

  const elements = new Map<string, PageElement>();
  for (const [id, hidden] of declared(html)) {
    const listeners = new Map<string, Listener[]>();
    const attributes = new Map<string, string>();
    const classes = new Set<string>();
    const element: PageElement = {
      id,
      hidden,
      disabled: false,
      textContent: '',
      innerHTML: '',
      value: '',
      title: '',
      classList: {
        add: (name) => void classes.add(name),
        remove: (name) => void classes.delete(name),
        toggle: (name, on = !classes.has(name)) => {
          if (on) classes.add(name);
          else classes.delete(name);
          return on;
        },
        contains: (name) => classes.has(name),
      },
      setAttribute: (name, value) => void attributes.set(name, String(value)),
      getAttribute: (name) => attributes.get(name) ?? null,
      removeAttribute: (name) => void attributes.delete(name),
      addEventListener: (type, listener) =>
        void listeners.set(type, [...(listeners.get(type) ?? []), listener]),
      focus: () => {
        focused = element;
      },
      click: () => {
        if (element.disabled) return;
        fire(listeners, eventFor('click', element));
      },
      submit: () => fire(listeners, eventFor('submit', element)),
    };
    elements.set(id, element);
  }

  // A browser fires hashchange after the change, not during it, and not at
  // all when the fragment is the same. `#` alone reads back as ''.
  const location = {
    get hash(): string {
      return fragment;
    },
    set hash(next: string) {
      const normal = next === '' || next === '#' ? '' : next.startsWith('#') ? next : `#${next}`;
      if (normal === fragment) return;
      fragment = normal;
      pendingHash += 1;
      setTimeout(() => {
        pendingHash -= 1;
        fire(windowListeners, eventFor('hashchange', elements.values().next().value!));
      }, 0);
    },
  };

  const context = createContext({
    console,
    setTimeout,
    clearTimeout,
    location,
    document: {
      getElementById: (id: string) => elements.get(id) ?? null,
      addEventListener: (type: string, listener: Listener) =>
        void documentListeners.set(type, [...(documentListeners.get(type) ?? []), listener]),
      get activeElement() {
        return focused;
      },
    },
    // A browser resolves a relative address against the page; Node's fetch
    // has no page, so this fetch does that one step, and counts what the page
    // asked for.
    fetch: async (address: string, init: RequestInit) => {
      const body = JSON.parse(String(init.body)) as {
        method: string;
        params?: { name?: string };
      };
      if (body.method === 'tools/call') called.push(String(body.params?.name));
      inFlight += 1;
      try {
        // The body is read here, whole, so the page's own read of it takes no
        // time, and the request counts as in flight until it is answered.
        const answered = await fetch(new URL(address, page), init);
        const text = await answered.text();
        return new Response(text, { status: answered.status, headers: answered.headers });
      } finally {
        setTimeout(() => (inFlight -= 1), 0);
      }
    },
  });
  context['window'] = context;
  context['addEventListener'] = (type: string, listener: Listener) =>
    void windowListeners.set(type, [...(windowListeners.get(type) ?? []), listener]);

  for (const script of scripts) {
    runInContext(await readFile(join(WEB, script ?? ''), 'utf8'), context, { filename: script });
  }

  const opened: OpenPage = {
    byId: (id) => {
      const element = elements.get(id);
      if (element === undefined) throw new Error(`index.html declares no element #${id}.`);
      return element;
    },
    go: (next) => {
      location.hash = next;
    },
    hash: () => fragment,
    key: (name) => fire(documentListeners, eventFor('keydown', elements.get('app')!, name)),
    focused: () => focused,
    called: () => called,
    settled: async () => {
      const start = Date.now();
      let quiet = 0;
      while (quiet < 3) {
        if (Date.now() - start > SETTLE_TIMEOUT_MS) {
          throw new Error(
            `the page did not settle in ${SETTLE_TIMEOUT_MS} ms.\n${plugin.output()}`,
          );
        }
        await new Promise((done) => setTimeout(done, 5));
        quiet = inFlight === 0 && pendingHash === 0 ? quiet + 1 : 0;
      }
    },
  };
  await opened.settled();
  return opened;
}
