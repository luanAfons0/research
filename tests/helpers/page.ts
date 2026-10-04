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
 *
 * Two things a browser has are bent, so a test stays fast and exact:
 *
 * - an item the page draws inside a declared element (a Sweep, an Extract)
 *   is pressed with `pressIn`, which sends the click to that element's
 *   listeners with the item as its target, as a browser bubbles it; the page
 *   finds one with `querySelector` on a declared element, for a selector of
 *   one attribute, and a test reads which ones it scrolled into view;
 * - a wait of a second or more, such as the page's poll while a Sweep runs,
 *   passes only when a test says so with `later()`, so no test sleeps for it;
 * - a key or a paste goes to the element it is aimed at, then to the
 *   document, as a browser bubbles it. Enter in an input that nothing
 *   stopped sends the form, as a browser does, and a paste that nothing
 *   stopped lands at the end of the value, as if the caret were there.
 */
import { readFile } from 'node:fs/promises';
import { createServer } from 'node:http';
import type { AddressInfo } from 'node:net';
import { join } from 'node:path';
import type { TestContext } from 'node:test';
import { createContext, runInContext } from 'node:vm';
import { CLEAN_UP_TIMEOUT_MS, REPOSITORY, type Started } from './plugin.ts';

/** The Plugin Page's directory, as the Host serves it. */
export const WEB = join(REPOSITORY, 'web');

/** How long a test waits for the page to settle before it gives up. */
const SETTLE_TIMEOUT_MS = 10_000;

/** A wait this long or longer passes only when a test calls `later()`. */
const LONG_WAIT_MS = 1_000;

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
    // Every request is answered, whatever goes wrong: one left open would
    // hold this server's close, and the test, until the page's fetch gave up.
    try {
      let body = '';
      for await (const chunk of request) body += String(chunk);
      const asked = JSON.parse(body) as { id: unknown; method: string; params?: unknown };
      const answer = await plugin.ask(asked.method, asked.params);
      response.writeHead(200, { 'content-type': 'application/json' });
      response.end(JSON.stringify({ jsonrpc: '2.0', ...answer, id: asked.id }));
    } catch (fault) {
      if (!response.headersSent) response.writeHead(502, { 'content-type': 'text/plain' });
      response.end(`the stand-in Host could not reach the Plugin Server: ${String(fault)}`);
    }
  });
  await new Promise<void>((listening) => server.listen(0, '127.0.0.1', listening));
  t.after(
    () =>
      new Promise<void>((closed) => {
        server.closeAllConnections();
        server.close(() => closed());
      }),
    { timeout: CLEAN_UP_TIMEOUT_MS },
  );
  return `http://127.0.0.1:${(server.address() as AddressInfo).port}/p/research/`;
}

/** What an event names as its target: an element, or an item drawn inside one. */
type Target = PageElement | DrawnItem;

/** The keys held down with another key. */
export type Modifiers = {
  readonly altKey?: boolean;
  readonly shiftKey?: boolean;
  readonly ctrlKey?: boolean;
  readonly metaKey?: boolean;
};

/** One event as the page's listeners get it. */
type PageEvent = {
  readonly type: string;
  readonly target: Target;
  readonly key?: string;
  readonly altKey: boolean;
  readonly shiftKey: boolean;
  readonly ctrlKey: boolean;
  readonly metaKey: boolean;
  /** What a paste carries, as a browser's clipboardData gives it. */
  readonly clipboardData?: { getData(format: string): string };
  readonly defaultPrevented: boolean;
  preventDefault(): void;
};

/**
 * One item the page drew into an element's markup, as a click's target sees
 * it: its attributes, and `closest` for a selector of one attribute, such as
 * `[data-x]`, which matches the item itself.
 */
export type DrawnItem = {
  getAttribute(name: string): string | null;
  hasAttribute(name: string): boolean;
  closest(selector: string): DrawnItem | null;
  focus(): void;
  scrollIntoView(options?: unknown): void;
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
  /** The custom properties the page set on it, such as the meter's `--done`. */
  readonly style: {
    setProperty(name: string, value: string): void;
    getPropertyValue(name: string): string;
  };
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
  /** The first item drawn inside it that a selector of one attribute matches. */
  querySelector(selector: string): DrawnItem | null;
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
  /**
   * Press a key in element `id`, such as Enter in an input. Enter in an input
   * sends the form unless the page stopped it.
   */
  press(id: string, key: string, modifiers?: Modifiers): void;
  /**
   * Press a key on the item drawn inside element `id` whose `attribute` is
   * `value`, as a person does with that item focused.
   */
  pressKeyIn(id: string, attribute: string, value: string, key: string, modifiers?: Modifiers): void;
  /** Type into element `id`: its value becomes this text, and it hears `input`. */
  type(id: string, text: string): void;
  /** Paste this text into element `id`, at the end of what it holds. */
  paste(id: string, text: string): void;
  /**
   * Press the item drawn inside element `id` whose `attribute` is `value`,
   * as a person presses a Sweep or an Extract. A disabled one takes no click.
   */
  pressIn(id: string, attribute: string, value: string): void;
  /** Let every wait of a second or more pass now, as if the time had gone by. */
  later(): void;
  /** The element that has focus, or null. */
  focused(): PageElement | null;
  /**
   * The drawn item that has focus, as the element it is in and the selector
   * it was found by: `#f-src-list [data-up="1"]`, or null.
   */
  focusedItem(): string | null;
  /**
   * Each drawn item the page scrolled into view, in order, as the element it
   * is in and the selector it was found by: `#extracts [data-x="2"]`.
   */
  scrolled(): readonly string[];
  /** Every tool the page has called, by name, in order. */
  called(): readonly string[];
  /** Wait until no request is in flight and no address change is pending. */
  settled(): Promise<void>;
};

/** One element `index.html` declares: its tag, and whether it starts `hidden`. */
type Declared = { readonly tag: string; readonly hidden: boolean };

/** Every id `index.html` declares, with its tag and whether it starts `hidden`. */
function declared(html: string): Map<string, Declared> {
  const ids = new Map<string, Declared>();
  for (const found of html.matchAll(/<([a-z][a-z0-9]*)[^>]*\sid="([^"]+)"[^>]*>/g)) {
    ids.set(found[2] ?? '', { tag: found[1] ?? '', hidden: /\shidden[\s>]/.test(found[0]) });
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
  let focusedItem: string | null = null;
  const scrolls: string[] = [];

  const fire = (listeners: Map<string, Listener[]>, event: PageEvent): void => {
    for (const listener of listeners.get(event.type) ?? []) listener(event);
  };
  const eventFor = (
    type: string,
    target: Target,
    key?: string,
    modifiers: Modifiers = {},
    pasted?: string,
  ): PageEvent => {
    let prevented = false;
    return {
      type,
      target,
      ...(key === undefined ? {} : { key }),
      altKey: modifiers.altKey === true,
      shiftKey: modifiers.shiftKey === true,
      ctrlKey: modifiers.ctrlKey === true,
      metaKey: modifiers.metaKey === true,
      ...(pasted === undefined ? {} : { clipboardData: { getData: () => pasted } }),
      get defaultPrevented() {
        return prevented;
      },
      preventDefault: () => {
        prevented = true;
      },
    };
  };

  const elements = new Map<string, PageElement>();
  const listenersOf = new Map<string, Map<string, Listener[]>>();
  const tags = new Map<string, string>();
  for (const [id, { tag, hidden }] of declared(html)) {
    tags.set(id, tag);
    const listeners = new Map<string, Listener[]>();
    listenersOf.set(id, listeners);
    const attributes = new Map<string, string>();
    const classes = new Set<string>();
    const properties = new Map<string, string>();
    const element: PageElement = {
      id,
      hidden,
      disabled: false,
      textContent: '',
      innerHTML: '',
      value: '',
      title: '',
      style: {
        setProperty: (name, value) => void properties.set(name, String(value)),
        getPropertyValue: (name) => properties.get(name) ?? '',
      },
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
      querySelector: (selector) => {
        const wanted = /^\[([^\]=]+)(?:="([^"]*)")?\]$/.exec(selector);
        if (wanted === null) throw new Error(`querySelector knows no selector ${selector}.`);
        const name = wanted[1] ?? '';
        const item = drawnIn(element.innerHTML).find((attributes) =>
          wanted[2] === undefined ? attributes.has(name) : attributes.get(name) === wanted[2],
        );
        return item === undefined
          ? null
          : drawnItem(
              item,
              () => void scrolls.push(`#${id} ${selector}`),
              () => {
                focused = null;
                focusedItem = `#${id} ${selector}`;
              },
            );
      },
      focus: () => {
        focused = element;
        focusedItem = null;
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

  // A long wait is held here, by a number of its own, until `later()`.
  const waits = new Map<number, () => void>();
  let waitCount = 0;
  const pageSetTimeout = (run: () => void, ms = 0): unknown => {
    if (ms < LONG_WAIT_MS) return setTimeout(run, ms);
    waitCount += 1;
    waits.set(waitCount, run);
    return waitCount;
  };
  const pageClearTimeout = (handle: unknown): void => {
    if (typeof handle === 'number') waits.delete(handle);
    else clearTimeout(handle as NodeJS.Timeout);
  };

  const context = createContext({
    console,
    URL,
    // A test's browser asks for no reduced motion.
    matchMedia: () => ({ matches: false }),
    setTimeout: pageSetTimeout,
    clearTimeout: pageClearTimeout,
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
    press: (id, key, modifiers) => {
      const element = opened.byId(id);
      const event = eventFor('keydown', element, key, modifiers);
      fire(listenersOf.get(id)!, event);
      fire(documentListeners, event);
      // A browser sends the form on Enter in an input, unless the page stopped it.
      if (key === 'Enter' && tags.get(id) === 'input' && !event.defaultPrevented) {
        opened.byId('form').submit();
      }
    },
    pressKeyIn: (id, attribute, value, key, modifiers) => {
      const item = drawnIn(opened.byId(id).innerHTML).find(
        (attributes) => attributes.get(attribute) === value,
      );
      if (item === undefined) throw new Error(`#${id} shows nothing with ${attribute}="${value}".`);
      const event = eventFor('keydown', drawnItem(item), key, modifiers);
      fire(listenersOf.get(id)!, event);
      fire(documentListeners, event);
    },
    type: (id, text) => {
      const element = opened.byId(id);
      element.value = text;
      fire(listenersOf.get(id)!, eventFor('input', element));
    },
    paste: (id, text) => {
      const element = opened.byId(id);
      const event = eventFor('paste', element, undefined, {}, text);
      fire(listenersOf.get(id)!, event);
      if (event.defaultPrevented) return;
      element.value += text;
      fire(listenersOf.get(id)!, eventFor('input', element));
    },
    pressIn: (id, attribute, value) => {
      const item = drawnIn(opened.byId(id).innerHTML).find(
        (attributes) => attributes.get(attribute) === value,
      );
      if (item === undefined) throw new Error(`#${id} shows nothing with ${attribute}="${value}".`);
      // A browser sends no click to a disabled button.
      if (item.has('disabled')) return;
      fire(listenersOf.get(id)!, eventFor('click', drawnItem(item)));
    },
    later: () => {
      const due = [...waits.values()];
      waits.clear();
      for (const run of due) run();
    },
    focused: () => focused,
    focusedItem: () => focusedItem,
    scrolled: () => scrolls,
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

/** Every tag drawn in a piece of markup, as its attributes. */
function drawnIn(markup: string): Map<string, string>[] {
  return [...markup.matchAll(/<[a-z][a-z0-9]*\b([^>]*)>/g)].map((tag) =>
    attributesOf(tag[1] ?? ''),
  );
}

/**
 * One drawn tag as a click's target or a query's answer sees it. `closest`
 * takes a selector of one attribute, such as `[data-x]`, and matches the item
 * itself or nothing.
 */
function drawnItem(
  attributes: Map<string, string>,
  onScroll: () => void = () => undefined,
  onFocus: () => void = () => undefined,
): DrawnItem {
  const drawn: DrawnItem = {
    getAttribute: (name) => attributes.get(name) ?? null,
    hasAttribute: (name) => attributes.has(name),
    closest: (selector) => {
      const wanted = /^\[([^\]=]+)\]$/.exec(selector);
      if (wanted === null) throw new Error(`closest knows no selector ${selector}.`);
      return attributes.has(wanted[1] ?? '') ? drawn : null;
    },
    focus: onFocus,
    scrollIntoView: onScroll,
  };
  return drawn;
}

/** The attributes of one tag, by name, with the markup's escapes undone. */
function attributesOf(markup: string): Map<string, string> {
  const attributes = new Map<string, string>();
  const unescape = (text: string): string =>
    text
      .replace(/&quot;/g, '"')
      .replace(/&lt;/g, '<')
      .replace(/&gt;/g, '>')
      .replace(/&amp;/g, '&');
  for (const found of markup.matchAll(
    /([a-zA-Z_:][-a-zA-Z0-9_:.]*)(?:\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s"'>]+)))?/g,
  )) {
    attributes.set(found[1] ?? '', unescape(found[2] ?? found[3] ?? found[4] ?? ''));
  }
  return attributes;
}
