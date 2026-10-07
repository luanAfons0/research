/**
 * Sweeps: start one, read its Sources in the background, and record each
 * state it passes through.
 *
 * A Sweep copies its Topic's addresses into its Extracts when it starts, so an
 * edit to the Topic while it reads never reaches it, and deleting a Source
 * later keeps the Extracts old Sweeps made of it. A Sweep is `reading`, then
 * `digesting`, then `done`, or `failed` with a reason from either step. Only
 * one Sweep of a Topic runs at a time, and the data file is the truth about
 * that: a Sweep that runs is one whose state is `reading` or `digesting`.
 *
 * The tool that starts a Sweep answers at once with its id. The reading goes
 * on after the answer, at most a few Sources at a time, then the Digest is
 * made by a command (ADR-0002), and every state change is written as it
 * happens, so `get_sweep` shows the progress and a Plugin Server that stops
 * leaves a Sweep the next start can see did not end. Making the Digest again
 * answers at once too, because a model on a CPU takes minutes.
 *
 * A Sweep that ends sends one Notice, and nothing else does (FirstMate
 * ADR-0014): not its start, not the end of its reading, and not a Digest made
 * again, which the operator asked for from the Plugin Page and watches there.
 * A Sweep the last Plugin Server left running ends at the next start, and
 * sends its Notice then, so that no one waits for a Digest that will not come.
 */
import {
  checkCommand,
  COMMAND_FAILED,
  CUT_AT,
  promptFor,
  runCommand,
  type DigestTopic,
  type PromptExtract,
} from './digest.ts';
import { badInput, sentenceFor } from './mcp.ts';
import { noticeFor, type EndedSweep, type Notices } from './notices.ts';
import { readSource, type ReadOptions } from './reader.ts';
import type { DigestCommandSetting } from './settings.ts';
import { now, within, type Store } from './store.ts';

/** At most this many Sources of one Sweep are read at the same time. */
export const MOST_AT_ONCE = 4;

/** Why a Sweep failed when every Source failed. */
export const NO_SOURCE_READ = 'no Source could be read';
/** Why a Sweep failed when the Plugin Server stopped while it ran. */
export const STOPPED = 'the Plugin Server stopped before the Sweep ended';
/** Why an Extract has no text when the Plugin Server stopped before it was read. */
const NOT_READ_STOPPED = 'not read: the Plugin Server stopped first';

/** What a Sweep needs while it runs. */
export type Sweeping = {
  readonly store: Store;
  /** How each Source is read, and the signal that stops every read. */
  readonly reading: ReadOptions;
  /** How the Digest is made (ADR-0002). */
  readonly digesting: {
    /** The Digest command, from the environment or the settings file, read at each Digest. */
    readonly command: DigestCommandSetting;
    /** How long it may run before it is stopped. */
    readonly timeoutMs: number;
  };
  /** Where the Notice of a Sweep that ends goes. */
  readonly notices: Notices;
};

/** One Sweep without its Extracts, as get_topic lists it. */
export type SweepSummary = {
  readonly id: number;
  readonly topicId: number;
  readonly startedAt: string;
  /** When it ended, or null while it runs. */
  readonly endedAt: string | null;
  /** `reading`, `digesting`, `done` or `failed`. */
  readonly state: string;
  /** Why it failed, or null when it did not. */
  readonly reason: string | null;
  /** How many Sources it reads: one Extract each. */
  readonly sourceCount: number;
  /** How many of them gave text. */
  readonly readCount: number;
};

/** One Extract, whole, as get_sweep gives it. */
export type ExtractView = {
  /** Its number in the Sweep, from 1, which a Digest cites as `[n]`. */
  readonly n: number;
  /** The address it read, as the Topic had it when the Sweep started. */
  readonly address: string;
  /** `waiting`, `reading`, `read`, `thin` (read, with very little text) or `failed`. */
  readonly state: string;
  /** The readable text, or null when it is not read or could not be read. */
  readonly text: string | null;
  /** How many characters the text has, or null when there is none. */
  readonly characters: number | null;
  /** A word about a `thin` Extract, or null. */
  readonly note: string | null;
  /** Why it could not be read, or null. */
  readonly reason: string | null;
  /** The media type the Source answered with, or null. */
  readonly contentType: string | null;
  /** When it was read, or null while it waits. */
  readonly readAt: string | null;
  /** Whether the prompt of the last Digest took only the start of its text. */
  readonly cut: boolean;
  /** How many characters of it that prompt took, when it was cut, or null. */
  readonly cutAt: number | null;
};

/** One Sweep, whole, as get_sweep gives it. */
export type SweepView = SweepSummary & {
  /** The Digest, or null when the Sweep has none. */
  readonly digest: string | null;
  /** When the Digest was made, or null. */
  readonly digestAt: string | null;
  readonly extracts: readonly ExtractView[];
};

/** The Topic a Sweep starts from: its id and its Sources at that moment. */
export type SweptTopic = { readonly id: number; readonly sources: readonly string[] };

type SweepRow = {
  readonly id: number;
  readonly topic_id: number;
  readonly started_at: string;
  readonly ended_at: string | null;
  readonly state: string;
  readonly reason: string | null;
  readonly digest: string | null;
  readonly digest_at: string | null;
  readonly source_count: number;
  readonly read_count: number;
};

type ExtractRow = {
  readonly n: number;
  readonly address: string;
  readonly state: string;
  readonly text: string | null;
  readonly reason: string | null;
  readonly content_type: string | null;
  readonly read_at: string | null;
  readonly cut_at: number | null;
};

const SWEEP_COLUMNS =
  'sweeps.*, ' +
  '(SELECT COUNT(*) FROM extracts WHERE sweep_id = sweeps.id) AS source_count, ' +
  "(SELECT COUNT(*) FROM extracts WHERE sweep_id = sweeps.id AND state IN ('read', 'thin')) " +
  'AS read_count';

/** Whether a Sweep in this state still runs. */
function runs(state: string): boolean {
  return state === 'reading' || state === 'digesting';
}

/**
 * Start a Sweep of this Topic and hand it back at once. Its Sources are read
 * after this returns. Refused while a Sweep of the same Topic runs, and for a
 * Topic with no Sources.
 */
export function startSweep(sweeping: Sweeping, topic: SweptTopic): SweepSummary {
  const { store } = sweeping;
  const id = within(store, () => {
    const running = store
      .prepare(
        "SELECT id FROM sweeps WHERE topic_id = ? AND state IN ('reading', 'digesting') LIMIT 1",
      )
      .get(topic.id) as { id: number } | undefined;
    if (running !== undefined) {
      throw badInput(
        `Sweep ${running.id} of Topic ${topic.id} is running. ` +
          'Wait for it to end, then Sweep again.',
      );
    }
    if (topic.sources.length === 0) {
      throw badInput(
        `Topic ${topic.id} has no Sources, so a Sweep has nothing to read. Add one first.`,
      );
    }
    const row = store
      .prepare(
        "INSERT INTO sweeps (topic_id, started_at, state) VALUES (?, ?, 'reading') RETURNING id",
      )
      .get(topic.id, now()) as { id: number };
    const insert = store.prepare(
      "INSERT INTO extracts (sweep_id, n, address, state) VALUES (?, ?, ?, 'waiting')",
    );
    topic.sources.forEach((address, at) => insert.run(row.id, at + 1, address));
    return row.id;
  });
  void run(sweeping, id);
  return summaryOf(sweepRow(store, id));
}

/** Read every Source of a Sweep, a few at a time, then end it. */
async function run(sweeping: Sweeping, id: number): Promise<void> {
  const { store, reading } = sweeping;
  const stopped = (): boolean => reading.stopping.aborted;
  try {
    const waiting = store
      .prepare('SELECT n, address FROM extracts WHERE sweep_id = ? ORDER BY n')
      .all(id) as { n: number; address: string }[];
    const markReading = store.prepare(
      "UPDATE extracts SET state = 'reading' WHERE sweep_id = ? AND n = ?",
    );
    const record = store.prepare(
      'UPDATE extracts SET state = ?, text = ?, reason = ?, content_type = ?, read_at = ? ' +
        'WHERE sweep_id = ? AND n = ?',
    );
    let next = 0;
    const worker = async (): Promise<void> => {
      while (next < waiting.length && !stopped()) {
        const extract = waiting[next]!;
        next += 1;
        markReading.run(id, extract.n);
        const got = await readSource(extract.address, reading);
        // A Plugin Server that is stopping has closed its data file.
        if (stopped()) return;
        record.run(got.state, got.text, got.reason, got.contentType, now(), id, extract.n);
      }
    };
    await Promise.all(Array.from({ length: Math.min(MOST_AT_ONCE, waiting.length) }, worker));
    if (stopped()) return;
    if (withText(store, id).length === 0) {
      end(store, id, 'failed', NO_SOURCE_READ);
    } else {
      store
        .prepare("UPDATE sweeps SET state = 'digesting' WHERE id = ? AND state = 'reading'")
        .run(id);
      await makeDigest(sweeping, id);
    }
  } catch (fault) {
    failLoudly(sweeping, id, fault);
  }
  tell(sweeping, id);
}

/**
 * Send the Notice of a Sweep that has ended. A Plugin Server that is stopping
 * sends none: the Sweep has not ended, and the next start ends it and says so.
 * A Sweep deleted with its Topic while it ran has no one to tell about.
 */
function tell(sweeping: Sweeping, id: number): void {
  if (sweeping.reading.stopping.aborted) return;
  const sweep = endedSweep(sweeping.store, id);
  if (sweep !== null) sweeping.notices.send(noticeFor(sweep));
}

/** A Sweep that has ended, with its Topic's name, or null when it runs or is gone. */
function endedSweep(store: Store, id: number): EndedSweep | null {
  const row = store
    .prepare(
      `SELECT ${SWEEP_COLUMNS}, topics.name AS topic_name FROM sweeps ` +
        'JOIN topics ON topics.id = sweeps.topic_id WHERE sweeps.id = ?',
    )
    .get(id) as (SweepRow & { readonly topic_name: string }) | undefined;
  if (row === undefined || runs(row.state)) return null;
  return {
    topicId: row.topic_id,
    topicName: row.topic_name,
    state: row.state,
    reason: row.reason,
    readCount: row.read_count,
    sourceCount: row.source_count,
  };
}

/** A fault that is research's own ends the Sweep, and is said once on stderr. */
function failLoudly(sweeping: Sweeping, id: number, fault: unknown): void {
  if (sweeping.reading.stopping.aborted) return;
  process.stderr.write(`research: Sweep ${id} failed: ${sentenceFor(fault)}\n`);
  end(sweeping.store, id, 'failed', sentenceFor(fault));
}

/** The Extracts of a Sweep that have text, which are the ones a Digest is made from. */
function withText(store: Store, id: number): PromptExtract[] {
  return store
    .prepare(
      'SELECT n, address, text FROM extracts ' +
        "WHERE sweep_id = ? AND text IS NOT NULL AND text <> '' ORDER BY n",
    )
    .all(id) as PromptExtract[];
}

/**
 * Make the Digest of a Sweep that is `digesting`: run the Digest command on
 * its prompt, and end the Sweep `done` with the Digest, or `failed` with why.
 * With no Digest command, it ends `failed` and keeps every Extract, so the
 * text of each Source is there without a model (ADR-0002). A new Digest
 * replaces the old one; a failure keeps the old one.
 */
async function makeDigest(sweeping: Sweeping, id: number): Promise<void> {
  const { store, digesting, reading } = sweeping;
  const checked = checkCommand(digesting.command.current());
  if ('reason' in checked) {
    end(store, id, 'failed', checked.reason);
    return;
  }
  const topic = store
    .prepare(
      'SELECT topics.name, topics.question FROM sweeps ' +
        'JOIN topics ON topics.id = sweeps.topic_id WHERE sweeps.id = ?',
    )
    .get(id) as DigestTopic | undefined;
  // The Topic, and the Sweep with it, was deleted while it was made.
  if (topic === undefined) return;
  const prompt = promptFor(topic, withText(store, id));
  within(store, () => {
    store.prepare('UPDATE extracts SET cut_at = NULL WHERE sweep_id = ?').run(id);
    const mark = store.prepare('UPDATE extracts SET cut_at = ? WHERE sweep_id = ? AND n = ?');
    for (const n of prompt.cut) mark.run(CUT_AT, id, n);
  });
  let digest: string;
  try {
    digest = await runCommand(checked.file, checked.args, prompt.text, {
      timeoutMs: digesting.timeoutMs,
      stopping: reading.stopping,
    });
  } catch (fault) {
    // A Plugin Server that is stopping has closed its data file.
    if (reading.stopping.aborted) return;
    end(store, id, 'failed', `${COMMAND_FAILED}: ${sentenceFor(fault)}`);
    return;
  }
  if (reading.stopping.aborted) return;
  const at = now();
  store
    .prepare(
      "UPDATE sweeps SET state = 'done', reason = NULL, digest = ?, digest_at = ?, ended_at = ? " +
        "WHERE id = ? AND state = 'digesting'",
    )
    .run(digest, at, at, id);
}

/**
 * Make the Digest of a stored Sweep again, from the Extracts it keeps, with no
 * new fetch, and hand the Sweep back at once, `digesting`. Refused while any
 * Sweep of its Topic runs, because only one runs at a time; for a Sweep with
 * no Extract that has text; and when there is no command to run.
 */
export function remakeDigest(sweeping: Sweeping, id: number): SweepSummary {
  const { store } = sweeping;
  within(store, () => {
    const row = sweepRow(store, id);
    if (runs(row.state)) {
      throw badInput(`Sweep ${id} is running. Wait for it to end, then make the Digest again.`);
    }
    const running = store
      .prepare(
        "SELECT id FROM sweeps WHERE topic_id = ? AND state IN ('reading', 'digesting') LIMIT 1",
      )
      .get(row.topic_id) as { id: number } | undefined;
    if (running !== undefined) {
      throw badInput(
        `Sweep ${running.id} of Topic ${row.topic_id} is running. ` +
          'Wait for it to end, then make the Digest again.',
      );
    }
    if (withText(store, id).length === 0) {
      throw badInput(
        `Sweep ${id} has no Extract with text, so there is nothing to make a Digest from. ` +
          'Sweep the Topic again.',
      );
    }
    const checked = checkCommand(sweeping.digesting.command.current());
    if ('refusal' in checked) throw badInput(checked.refusal);
    store
      .prepare("UPDATE sweeps SET state = 'digesting', reason = NULL, ended_at = NULL WHERE id = ?")
      .run(id);
  });
  void makeDigest(sweeping, id).catch((fault: unknown) => failLoudly(sweeping, id, fault));
  return summaryOf(sweepRow(store, id));
}

/** End a Sweep that still runs, in this state, with this reason. */
function end(store: Store, id: number, state: 'done' | 'failed', reason: string | null): void {
  store
    .prepare(
      'UPDATE sweeps SET state = ?, reason = ?, ended_at = ? ' +
        "WHERE id = ? AND state IN ('reading', 'digesting')",
    )
    .run(state, reason, now(), id);
}

/**
 * A Sweep that runs when the Plugin Server starts was left by one that
 * stopped, and nothing will end it now. It becomes `failed`, and so does each
 * of its Extracts that was not read. Each one sends its Notice, which waits
 * on the queue for the Host's handshake.
 */
export function failUnfinished(store: Store, notices: Notices): void {
  const ended = within(store, () => {
    const at = now();
    store
      .prepare(
        "UPDATE extracts SET state = 'failed', reason = ?, read_at = ? " +
          "WHERE state IN ('waiting', 'reading') AND sweep_id IN " +
          "(SELECT id FROM sweeps WHERE state IN ('reading', 'digesting'))",
      )
      .run(NOT_READ_STOPPED, at);
    return store
      .prepare(
        "UPDATE sweeps SET state = 'failed', reason = ?, ended_at = ? " +
          "WHERE state IN ('reading', 'digesting') RETURNING id",
      )
      .all(STOPPED, at) as { id: number }[];
  });
  for (const { id } of ended) {
    const sweep = endedSweep(store, id);
    if (sweep !== null) notices.send(noticeFor(sweep));
  }
}

/** The Sweeps of a Topic, new to old, without their Extracts. */
export function sweepsOf(store: Store, topicId: number): readonly SweepSummary[] {
  const rows = store
    .prepare(`SELECT ${SWEEP_COLUMNS} FROM sweeps WHERE topic_id = ? ORDER BY id DESC`)
    .all(topicId) as SweepRow[];
  return rows.map(summaryOf);
}

/** One Sweep, whole, or a sentence that says there is no such Sweep. */
export function sweepView(store: Store, id: number): SweepView {
  const row = sweepRow(store, id);
  const extracts = store
    .prepare('SELECT * FROM extracts WHERE sweep_id = ? ORDER BY n')
    .all(id) as ExtractRow[];
  return {
    ...summaryOf(row),
    digest: row.digest,
    digestAt: row.digest_at,
    extracts: extracts.map(extractOf),
  };
}

/** The latest Sweep of a Topic, whole, or null when it was never swept. */
export function latestSweep(store: Store, topicId: number): SweepView | null {
  const row = store
    .prepare('SELECT id FROM sweeps WHERE topic_id = ? ORDER BY id DESC LIMIT 1')
    .get(topicId) as { id: number } | undefined;
  return row === undefined ? null : sweepView(store, row.id);
}

/** Delete a Sweep and its Extracts. Refused while it runs. */
export function deleteSweep(
  store: Store,
  id: number,
): { readonly id: number; readonly topicId: number } {
  const row = sweepRow(store, id);
  if (runs(row.state)) {
    throw badInput(`Sweep ${id} is running. Wait for it to end, then delete it.`);
  }
  store.prepare('DELETE FROM sweeps WHERE id = ?').run(id);
  return { id: row.id, topicId: row.topic_id };
}

/** The id of a Sweep as a tool was given it, or a sentence that names the tool. */
export function checkSweepId(tool: string, field: string, given: unknown): number {
  if (typeof given === 'number' && Number.isSafeInteger(given) && given > 0) return given;
  throw badInput(
    `${tool} takes "${field}" as a whole number, the id of a Sweep from get_topic, and was ` +
      `given ${JSON.stringify(given)}.`,
  );
}

function sweepRow(store: Store, id: number): SweepRow {
  const row = store.prepare(`SELECT ${SWEEP_COLUMNS} FROM sweeps WHERE id = ?`).get(id) as
    SweepRow | undefined;
  if (row === undefined) {
    throw badInput(`There is no Sweep ${id}. get_topic gives the id of each Sweep of a Topic.`);
  }
  return row;
}

function summaryOf(row: SweepRow): SweepSummary {
  return {
    id: row.id,
    topicId: row.topic_id,
    startedAt: row.started_at,
    endedAt: row.ended_at,
    state: row.state,
    reason: row.reason,
    sourceCount: row.source_count,
    readCount: row.read_count,
  };
}

function extractOf(row: ExtractRow): ExtractView {
  const characters = row.text === null ? null : row.text.length;
  return {
    n: row.n,
    address: row.address,
    state: row.state,
    text: row.text,
    characters,
    note:
      row.state === 'thin'
        ? `Little text (${(characters ?? 0).toLocaleString('en')} characters). ` +
          'The page may need JavaScript.'
        : null,
    reason: row.reason,
    contentType: row.content_type,
    readAt: row.read_at,
    cut: row.cut_at !== null,
    cutAt: row.cut_at,
  };
}
