/**
 * Topics: make, change, list and delete them, each with its own list of
 * Sources.
 *
 * A Topic is named by its id everywhere, because its name may change. Its
 * Sources are a list of addresses in the order the operator gave them, and
 * the whole list is replaced when it changes, so the order is what was typed
 * and nothing else. A Source is a page research reads with plain fetch
 * (ADR-0001), so an address that is not `http:` or `https:` is refused when the
 * Topic is saved, not found out later by a Sweep.
 */
import { badInput } from './mcp.ts';
import { now, type Store } from './store.ts';
import { sweepsOf, type SweepSummary } from './sweeps.ts';

/** One Topic as list_topics gives it: no Sources, only how many. */
export type TopicSummary = {
  readonly id: number;
  readonly name: string;
  /** The question the Digest answers, or '' when there is none. */
  readonly question: string;
  readonly sourceCount: number;
  /** When the last Sweep started, or null when the Topic was never swept. */
  readonly lastSweepAt: string | null;
  /** Where the last Sweep stands, or null when the Topic was never swept. */
  readonly lastSweepState: string | null;
};

/** One Topic, whole, as get_topic gives it. */
export type TopicView = {
  readonly id: number;
  readonly name: string;
  readonly question: string;
  readonly madeAt: string;
  /** The addresses of its Sources, in order. */
  readonly sources: readonly string[];
  /** Its Sweeps, new to old, without their Extracts. */
  readonly sweeps: readonly SweepSummary[];
};

/** What the operator gives when making or changing a Topic. */
export type TopicInput = {
  readonly name?: string;
  readonly question?: string;
  readonly sources?: readonly string[];
};

type TopicRow = {
  readonly id: number;
  readonly name: string;
  readonly question: string;
  readonly made_at: string;
};

/** Every Topic, in the order they were made. */
export function listTopics(store: Store): readonly TopicSummary[] {
  const rows = store
    .prepare(
      'SELECT topics.*, ' +
        '(SELECT COUNT(*) FROM sources WHERE topic_id = topics.id) AS source_count, ' +
        '(SELECT started_at FROM sweeps WHERE topic_id = topics.id ORDER BY id DESC LIMIT 1) ' +
        'AS last_sweep_at, ' +
        '(SELECT state FROM sweeps WHERE topic_id = topics.id ORDER BY id DESC LIMIT 1) ' +
        'AS last_sweep_state ' +
        'FROM topics ORDER BY id',
    )
    .all() as (TopicRow & {
    readonly source_count: number;
    readonly last_sweep_at: string | null;
    readonly last_sweep_state: string | null;
  })[];
  return rows.map((row) => ({
    id: row.id,
    name: row.name,
    question: row.question,
    sourceCount: row.source_count,
    lastSweepAt: row.last_sweep_at,
    lastSweepState: row.last_sweep_state,
  }));
}

/** One Topic, whole, or a sentence that says there is no such Topic. */
export function viewOf(store: Store, id: number): TopicView {
  const row = rowOf(store, id);
  const sources = store
    .prepare('SELECT address FROM sources WHERE topic_id = ? ORDER BY position')
    .all(id) as { address: string }[];
  return {
    id: row.id,
    name: row.name,
    question: row.question,
    madeAt: row.made_at,
    sources: sources.map((source) => source.address),
    sweeps: sweepsOf(store, id),
  };
}

/** Make a Topic. Call it within one transaction, so a refused one leaves nothing. */
export function makeTopic(store: Store, given: TopicInput): TopicView {
  const row = store
    .prepare('INSERT INTO topics (name, question, made_at) VALUES (?, ?, ?) RETURNING id')
    .get(given.name ?? '', given.question ?? '', now()) as { id: number };
  putSources(store, row.id, given.sources ?? []);
  return viewOf(store, row.id);
}

/** Change what is given of a Topic, and keep the rest. */
export function changeTopic(store: Store, id: number, given: TopicInput): TopicView {
  rowOf(store, id);
  if (given.name !== undefined) {
    store.prepare('UPDATE topics SET name = ? WHERE id = ?').run(given.name, id);
  }
  if (given.question !== undefined) {
    store.prepare('UPDATE topics SET question = ? WHERE id = ?').run(given.question, id);
  }
  if (given.sources !== undefined) {
    store.prepare('DELETE FROM sources WHERE topic_id = ?').run(id);
    putSources(store, id, given.sources);
  }
  return viewOf(store, id);
}

/** Delete a Topic and, through the foreign keys, everything that is its own. */
export function deleteTopic(
  store: Store,
  id: number,
): { readonly id: number; readonly name: string } {
  const row = rowOf(store, id);
  store.prepare('DELETE FROM topics WHERE id = ?').run(id);
  return { id: row.id, name: row.name };
}

function putSources(store: Store, id: number, sources: readonly string[]): void {
  const insert = store.prepare(
    'INSERT INTO sources (topic_id, address, position) VALUES (?, ?, ?)',
  );
  sources.forEach((address, position) => insert.run(id, address, position));
}

function rowOf(store: Store, id: number): TopicRow {
  const row = store.prepare('SELECT * FROM topics WHERE id = ?').get(id) as TopicRow | undefined;
  if (row === undefined) {
    throw badInput(`There is no Topic ${id}. list_topics gives the id of each Topic.`);
  }
  return row;
}

/** The id of a Topic as a tool was given it, or a sentence that names the tool. */
export function checkTopicId(tool: string, given: unknown): number {
  if (typeof given === 'number' && Number.isSafeInteger(given) && given > 0) return given;
  throw badInput(
    `${tool} takes "id" as a whole number, the id of a Topic from list_topics, and was ` +
      `given ${JSON.stringify(given)}.`,
  );
}

/**
 * What a tool was given to make or change a Topic, checked and trimmed. With
 * `whole`, a name is needed, as when a Topic is made; without it, each field
 * that is not given is left out, so the Topic keeps it.
 */
export function checkTopicInput(
  tool: string,
  given: Readonly<Record<string, unknown>>,
  whole: boolean,
): TopicInput {
  const input: { name?: string; question?: string; sources?: readonly string[] } = {};
  if (whole || given['name'] !== undefined) input.name = checkName(tool, given['name']);
  if (given['question'] !== undefined) input.question = checkQuestion(tool, given['question']);
  if (given['sources'] !== undefined) input.sources = checkSources(tool, given['sources']);
  return input;
}

function checkName(tool: string, given: unknown): string {
  const name = typeof given === 'string' ? given.trim() : '';
  if (name === '' || /[\r\n]/.test(name)) {
    throw badInput(`${tool} needs "name": one line of text that names the Topic.`);
  }
  return name;
}

function checkQuestion(tool: string, given: unknown): string {
  if (typeof given !== 'string') {
    throw badInput(`${tool} takes "question" as text, which may be empty.`);
  }
  return given.trim();
}

function checkSources(tool: string, given: unknown): readonly string[] {
  if (!Array.isArray(given) || !given.every((address) => typeof address === 'string')) {
    throw badInput(`${tool} takes "sources" as a list of addresses, each one as text.`);
  }
  return given.map((raw: string, index) => {
    const address = raw.trim();
    if (!isWebAddress(address)) {
      // The data names the exact Source, so the Plugin Page can point at its
      // line without reading the sentence.
      throw badInput(
        `Source ${index + 1} is not an http or https address: ${address}. ` +
          'Change it or remove it.',
        { field: 'sources', index, address },
      );
    }
    return address;
  });
}

function isWebAddress(address: string): boolean {
  try {
    const { protocol } = new URL(address);
    return protocol === 'http:' || protocol === 'https:';
  } catch {
    return false;
  }
}
