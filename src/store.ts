/**
 * The one SQLite file, `research.db`, where research keeps what it reads
 * (FirstMate ADR-0005).
 *
 * The file is in the Plugin's own directory, which is where the Host starts
 * the Plugin Server, so it is one relative path away, and git ignores it: it is
 * this machine's research, not the project's. Its schema version is
 * `PRAGMA user_version`: opening an older file moves it up to the current
 * version, one step at a time, and a newer file than this code knows is
 * refused rather than guessed at.
 */
import { DatabaseSync } from 'node:sqlite';

/** Where the data lives, relative to the Plugin directory. */
export const FILE = 'research.db';

/** The Store: one open connection to `research.db`. */
export type Store = DatabaseSync;

/**
 * Each step moves the file up one version. A step is never edited once it
 * has shipped; a change to the schema is a new step at the end.
 */
const STEPS: readonly string[] = [
  // A Topic and its Sources, in the order the operator gave them. Deleting a
  // Topic deletes its Sources. A Sweep and its Extracts come in a later step,
  // with their own ON DELETE CASCADE to a Topic: an Extract keeps a copy of
  // the address it read, so no Extract points at a Source, and deleting a
  // Source never reaches a Sweep. The foreign keys hold because every open
  // turns them on.
  `
  CREATE TABLE topics (
    id INTEGER PRIMARY KEY,
    name TEXT NOT NULL CHECK (name <> ''),
    question TEXT NOT NULL DEFAULT '',
    made_at TEXT NOT NULL
  );
  CREATE TABLE sources (
    id INTEGER PRIMARY KEY,
    topic_id INTEGER NOT NULL REFERENCES topics (id) ON DELETE CASCADE,
    address TEXT NOT NULL,
    position INTEGER NOT NULL,
    UNIQUE (topic_id, position)
  );
  `,
  // A Sweep and its Extracts. A Sweep belongs to its Topic and goes with it.
  // An Extract keeps its own copy of the address it read, taken when the
  // Sweep started, so editing or deleting a Source never reaches it. An
  // Extract is `waiting`, then `reading`, then `read`, `thin` or `failed`;
  // its text is null until it is read, and its reason is null unless it failed.
  `
  CREATE TABLE sweeps (
    id INTEGER PRIMARY KEY,
    topic_id INTEGER NOT NULL REFERENCES topics (id) ON DELETE CASCADE,
    started_at TEXT NOT NULL,
    ended_at TEXT,
    state TEXT NOT NULL CHECK (state IN ('reading', 'digesting', 'done', 'failed')),
    reason TEXT,
    digest TEXT,
    digest_at TEXT
  );
  CREATE INDEX sweeps_of_topic ON sweeps (topic_id, id);
  CREATE TABLE extracts (
    sweep_id INTEGER NOT NULL REFERENCES sweeps (id) ON DELETE CASCADE,
    n INTEGER NOT NULL,
    address TEXT NOT NULL,
    state TEXT NOT NULL CHECK (state IN ('waiting', 'reading', 'read', 'thin', 'failed')),
    text TEXT,
    reason TEXT,
    content_type TEXT,
    read_at TEXT,
    PRIMARY KEY (sweep_id, n)
  );
  `,
];

/** Open `research.db`, making it when it is not there, and bring it up to the current version. */
export function openStore(path: string = FILE): Store {
  const store = new DatabaseSync(path);
  store.exec('PRAGMA foreign_keys = ON');
  // A deleted Topic leaves nothing behind: SQLite writes zeros over what it
  // deletes instead of leaving it in free pages of the file.
  store.exec('PRAGMA secure_delete = ON');
  const row = store.prepare('PRAGMA user_version').get() as { user_version: number };
  const version = row.user_version;
  if (version > STEPS.length) {
    store.close();
    throw new Error(
      `${path} is at schema version ${version}, and this research knows only up to ` +
        `${STEPS.length}. Run a newer research, or restore an older copy of the file.`,
    );
  }
  for (let step = version; step < STEPS.length; step += 1) {
    within(store, () => {
      store.exec(STEPS[step] ?? '');
      store.exec(`PRAGMA user_version = ${step + 1}`);
    });
  }
  return store;
}

/** Do this work in one transaction: all of it lands, or none of it does. */
export function within<T>(store: Store, work: () => T): T {
  store.exec('BEGIN IMMEDIATE');
  try {
    const done = work();
    store.exec('COMMIT');
    return done;
  } catch (fault) {
    store.exec('ROLLBACK');
    throw fault;
  }
}

/** This moment, as the Store writes a time: ISO 8601, in UTC. */
export function now(): string {
  return new Date().toISOString();
}
