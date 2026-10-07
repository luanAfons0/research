/**
 * The reader: one Source in, one Extract out (ADR-0001).
 *
 * A Source is read with Node's own `fetch`: one request for the page at its
 * address, and none for the pages it links to. Redirects are followed, the
 * request names research honestly in its User-Agent, and it waits a fixed time
 * at most, body and all, so one slow site does not hold a Sweep. Only HTML and
 * plain text are read, and only up to a size a page has no reason to pass.
 *
 * Whatever goes wrong is the Extract's reason, never a thrown error: a Sweep
 * keeps an Extract for every Source, read or not, so the operator sees which
 * ones to fix.
 */
import { Buffer } from 'node:buffer';
import { plainText, readableText } from './extractor.ts';

/** What every request says it is, so a site knows what reads it (ADR-0001). */
export const USER_AGENT = 'research (FirstMate Plugin)';

/** A response larger than this is not read: no page a person reads is this big. */
export const MOST_BYTES = 5 * 1024 * 1024;

/**
 * An Extract with fewer characters than this is kept and marked: the page
 * likely makes its text with JavaScript, which research does not run.
 */
export const THIN_BELOW = 300;

/** How a Source was read: its text, or the reason it has none. */
export type Reading = {
  /** `read`, `thin` (read, with very little text), or `failed`. */
  readonly state: 'read' | 'thin' | 'failed';
  /** The readable text, or null when the Source could not be read. */
  readonly text: string | null;
  /** Why the Source could not be read, or null when it was. */
  readonly reason: string | null;
  /** The media type the Source answered with, or null when it did not answer. */
  readonly contentType: string | null;
};

/** What a read needs from the Sweep that asks for it. */
export type ReadOptions = {
  /** How long the Source may take, body and all. */
  readonly timeoutMs: number;
  /** Aborts the read when the Plugin Server stops. */
  readonly stopping: AbortSignal;
};

/** Read one Source into one Extract. It never throws; a failure is the reason. */
export async function readSource(address: string, options: ReadOptions): Promise<Reading> {
  const timeout = AbortSignal.timeout(options.timeoutMs);
  const signal = AbortSignal.any([timeout, options.stopping]);
  let response: Response;
  try {
    response = await fetch(address, {
      redirect: 'follow',
      headers: { 'user-agent': USER_AGENT, accept: 'text/html, text/plain;q=0.9' },
      signal,
    });
  } catch (fault) {
    return failed(why(fault, timeout, options.timeoutMs), null);
  }
  const contentType = response.headers.get('content-type');
  const type = mediaType(contentType);
  if (!response.ok) {
    await response.body?.cancel().catch(() => undefined);
    return failed(`HTTP ${response.status}`, type);
  }
  if (type !== 'text/html' && type !== 'text/plain') {
    await response.body?.cancel().catch(() => undefined);
    return failed(`not read: ${type ?? 'no content type'}`, type);
  }
  let bytes: Uint8Array | null;
  try {
    bytes = await capped(response);
  } catch (fault) {
    return failed(why(fault, timeout, options.timeoutMs), type);
  }
  if (bytes === null) return failed(`not read: larger than ${MOST_BYTES / 1024 / 1024} MB`, type);
  const body = decoded(bytes, contentType);
  const text = type === 'text/html' ? readableText(body) : plainText(body);
  return {
    state: text.length < THIN_BELOW ? 'thin' : 'read',
    text,
    reason: null,
    contentType: type,
  };
}

function failed(reason: string, contentType: string | null): Reading {
  return { state: 'failed', text: null, reason, contentType };
}

/** The media type alone, lower case, without its parameters. */
function mediaType(header: string | null): string | null {
  const type = header?.split(';')[0]?.trim().toLowerCase() ?? '';
  return type === '' ? null : type;
}

/** The body's bytes, or null as soon as it passes the cap. */
async function capped(response: Response): Promise<Uint8Array | null> {
  const declared = Number(response.headers.get('content-length'));
  if (Number.isFinite(declared) && declared > MOST_BYTES) {
    await response.body?.cancel().catch(() => undefined);
    return null;
  }
  if (response.body === null) return new Uint8Array();
  const parts: Uint8Array[] = [];
  let size = 0;
  const reader = response.body.getReader();
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    size += value.byteLength;
    if (size > MOST_BYTES) {
      await reader.cancel().catch(() => undefined);
      return null;
    }
    parts.push(value);
  }
  return Buffer.concat(parts);
}

/**
 * The body as text, in the charset the page names: in its Content-Type, or
 * in a `<meta>` near its top. A charset this Node does not know reads as
 * UTF-8, the charset of nearly every page now.
 */
function decoded(bytes: Uint8Array, contentType: string | null): string {
  const head = Buffer.from(bytes.subarray(0, 2048)).toString('latin1');
  const named =
    /charset\s*=\s*["']?([\w-]+)/i.exec(contentType ?? '')?.[1] ??
    /<meta[^>]+charset\s*=\s*["']?([\w-]+)/i.exec(head)?.[1] ??
    'utf-8';
  try {
    return new TextDecoder(named).decode(bytes);
  } catch {
    return new TextDecoder('utf-8').decode(bytes);
  }
}

/** Why a request failed, as the reason an Extract carries. */
function why(fault: unknown, timeout: AbortSignal, timeoutMs: number): string {
  if (timeout.aborted) return `no answer in ${duration(timeoutMs)}`;
  const cause = (fault as { cause?: unknown } | null)?.cause;
  const message =
    cause instanceof Error
      ? cause.message
      : fault instanceof Error
        ? fault.message
        : String(fault);
  return `network error: ${message}`;
}

/** 30000 as "30 s", and 250 as "250 ms". */
function duration(ms: number): string {
  return ms % 1000 === 0 ? `${ms / 1000} s` : `${ms} ms`;
}
