/**
 * Notices: the one word research sends the operator when a Sweep ends, through
 * the Host, so they know with the Plugin Page closed (FirstMate ADR-0014).
 *
 * A Notice goes on a queue that sends one, then waits a gap before the next,
 * because the Host takes one Notice from a Plugin every 5 seconds and refuses
 * the rest. Two Sweeps that end together still give two Notices: a refusal
 * for "too soon" puts the Notice back at the front, and only a refusal for
 * anything else drops it, said once on stderr. The Host never cuts a text that
 * is too long, it refuses it, so research shortens its own texts to fit.
 *
 * Until the Host's handshake comes, Notices wait. A Host that does not offer
 * Notices gets none, and the queue is let go.
 */
import type { HostAnswer } from './mcp.ts';

/** The method research sends a Notice with. */
export const NOTICE_METHOD = 'firstmate/notice';

/** The longest body the Host takes, in characters. */
const BODY_LIMIT = 200;

/**
 * The most of a Topic's name a body takes, in characters, so that a long name
 * still leaves room for the reason a Sweep failed.
 */
const NAME_LIMIT = 80;

/** What marks a text research shortened. */
const SHORTENED = '…';

/** The JSON-RPC code the Host refuses a Notice with. */
const HOST_ERROR = -32000;

/** How the Host's refusal for "too soon" starts. Its numbers change; these words do not. */
const TOO_SOON = /^A Plugin may send one Notice every \d+(\.\d+)? s\. /;

/** One Notice, as research asks the Host to show it. */
export type Notice = {
  /**
   * One line the Host puts after research's name: `research: <title>`.
   * research's two titles are far below the Host's 64 characters.
   */
  readonly title: string;
  readonly body: string;
  /** Where a click opens, under `/p/research/`. */
  readonly path: string;
};

/** A Sweep that ended, as its Notice tells it. */
export type EndedSweep = {
  readonly topicId: number;
  readonly topicName: string;
  /** `done` or `failed`. */
  readonly state: string;
  /** Why it failed, or null when it did not. */
  readonly reason: string | null;
  /** How many Sources it read with text. */
  readonly readCount: number;
  /** How many Sources it had to read. */
  readonly sourceCount: number;
};

/** The queue of Notices for one Plugin Server. */
export type Notices = {
  /** Put a Notice on the queue. It is sent when its turn comes. */
  send(notice: Notice): void;
  /** What the Host's handshake offered: Notices go out from now on, or never. */
  offered(notice: boolean): void;
  /** Let every waiting Notice go, because the Host has closed the pipe. */
  close(): void;
};

/** How the queue reaches the Host, and how long it waits between two Notices. */
export type NoticeOptions = {
  /** Send one Notice to the Host, and hand back its answer. */
  readonly ask: (notice: Notice) => Promise<HostAnswer>;
  /** How long to wait after one Notice before the next, in milliseconds. */
  readonly gapMs: number;
};

/** The Notice a Sweep that ended sends: `Digest ready`, or `Sweep failed` with why. */
export function noticeFor(sweep: EndedSweep): Notice {
  const name = shorten(oneLine(sweep.topicName), NAME_LIMIT);
  const head = `${name} — `;
  const rest =
    sweep.state === 'done'
      ? `${sweep.readCount} of ${sweep.sourceCount} Sources read`
      : oneLine(sweep.reason ?? 'no reason was kept').replace(/\.+$/, '');
  return {
    title: sweep.state === 'done' ? 'Digest ready' : 'Sweep failed',
    body: `${head}${shorten(rest, BODY_LIMIT - characters(head) - 1)}.`,
    path: `#topic/${sweep.topicId}`,
  };
}

/** Open an empty queue. Nothing is sent until the Host's handshake offers Notices. */
export function openNotices(options: NoticeOptions): Notices {
  const waiting: Notice[] = [];
  // Null until the handshake says; then whether the Host takes Notices.
  let taken: boolean | null = null;
  // True while a Notice is with the Host, and through the gap after it.
  let busy = false;
  let closed = false;

  const next = (): void => {
    if (busy || closed || taken !== true) return;
    const notice = waiting.shift();
    if (notice === undefined) return;
    busy = true;
    void options.ask(notice).then((answer) => {
      if (answer.error !== undefined) {
        if (tooSoon(answer.error)) waiting.unshift(notice);
        else if (!closed) refused(notice, answer.error.message);
      }
      // The gap holds no Plugin Server up: one that is asked to stop stops.
      setTimeout(() => {
        busy = false;
        next();
      }, options.gapMs).unref();
    });
  };

  return {
    send(notice) {
      if (closed || taken === false) return;
      waiting.push(notice);
      next();
    },
    offered(notice) {
      taken = notice;
      if (!notice) waiting.length = 0;
      next();
    },
    close() {
      closed = true;
      waiting.length = 0;
    },
  };
}

/** Whether the Host refused a Notice only for coming too soon after the last one. */
function tooSoon(error: { readonly code: number; readonly message: string }): boolean {
  return error.code === HOST_ERROR && TOO_SOON.test(error.message);
}

/** A refusal for anything else is research's mistake: said once, and the Notice dropped. */
function refused(notice: Notice, why: string): void {
  process.stderr.write(
    `research: the Host refused the Notice "${notice.title}" for ${notice.path}, ` +
      `and it is dropped: ${why}\n`,
  );
}

/** A text on one line, as a Notice shows it. */
function oneLine(text: string): string {
  return text.replace(/\s+/g, ' ').trim();
}

/**
 * A text cut to at most this many characters, with a mark that says so. It
 * counts and cuts by code point, as the Host counts, so a letter outside the
 * Basic Multilingual Plane is one character and is never cut in half.
 */
function shorten(text: string, most: number): string {
  const points = [...text];
  if (points.length <= most) return text;
  return `${points.slice(0, most - 1).join('').trimEnd()}${SHORTENED}`;
}

/** How long a text is, in characters, as the Host counts them. */
function characters(text: string): number {
  return [...text].length;
}
