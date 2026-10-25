/**
 * The settings file, `settings.json`, in the Plugin directory beside
 * `research.db`: what the operator set from the Plugin Page.
 *
 * It lives in the Plugin's own directory, so it is research's alone and the
 * Host neither reads nor keeps it (FirstMate ADR-0005). A setting in it works
 * however the Host was started: the App, a shell or systemd. The Digest
 * command keeps the form of `RESEARCH_DIGEST_COMMAND`, a JSON array, read by
 * `commandFrom` and nowhere else (ADR-0003).
 *
 * The file is written whole, to a file beside it, and then renamed over it, so
 * a Plugin Server that stops halfway leaves the old file or the new one and
 * never half of either. A key this research does not know is kept as it is.
 *
 * A file that research cannot use does not stop the Plugin Server, because
 * the Plugin Page, which the Plugin Server serves, is where it is fixed. Each
 * Digest is refused with a sentence that names the file, and the next save
 * from the Plugin Page writes over it.
 */
import { readFileSync, renameSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import {
  arrayOf,
  COMMAND_FORM,
  commandFrom,
  type Command,
  type CommandSetting,
} from './command.ts';

/** The name of the settings file in the Plugin directory. */
export const SETTINGS_FILE = 'settings.json';

/** What the settings file holds. */
export type SavedSettings = {
  /** The Digest command saved from the Plugin Page, or null when none is. */
  readonly digestCommand: Command | null;
};

/**
 * Read the Digest command in the settings file of a Plugin directory. No file
 * is no command. A file research cannot use is a problem: a sentence that
 * names the file and says how to fix it in Settings.
 */
export function readSettingsFile(directory = '.'): CommandSetting {
  const path = pathOf(directory);
  const whole = readWhole(path);
  if (whole === null) {
    return {
      command: null,
      problem:
        `${path} is not a JSON object; save the Digest command in Settings to write it ` +
        'again.',
    };
  }
  const given = whole['digestCommand'];
  if (given === undefined || given === null) return { command: null, problem: null };
  const command = commandFrom(given);
  if (command === null) {
    return {
      command: null,
      problem:
        `${path} holds the Digest command ${JSON.stringify(given)}; set it to ${COMMAND_FORM}, ` +
        'in Settings.',
    };
  }
  return { command, problem: null };
}

/**
 * Write these settings into the file, and keep every key this research does
 * not know. A file that is not a JSON object holds nothing to keep, so it is
 * written over.
 */
export function writeSettingsFile(settings: SavedSettings, directory = '.'): void {
  const path = pathOf(directory);
  const whole = readWhole(path) ?? {};
  const { digestCommand } = settings;
  if (digestCommand === null) delete whole['digestCommand'];
  else whole['digestCommand'] = arrayOf(digestCommand);
  const next = `${path}.next`;
  writeFileSync(next, `${JSON.stringify(whole, null, 2)}\n`);
  replace(next, path);
}

/** How many times a rename is tried on Windows before its fault is said. */
const RENAME_TRIES = 5;

/** How long the first try waits before the next, in milliseconds. Each wait is longer. */
const RENAME_WAIT_MS = 20;

/** The faults Windows gives for a moment while another process holds a file open. */
const HELD = new Set(['EPERM', 'EBUSY', 'EACCES']);

/**
 * Rename the new file over the settings file. On Windows a process that holds
 * it open for a moment, such as a virus scanner or the search indexer reading
 * what was just written, makes the rename fail with EPERM, EBUSY or EACCES, so
 * it is tried again a few times before the fault is said. Linux renames over
 * an open file, so it tries once.
 */
function replace(next: string, path: string): void {
  for (let tried = 1; ; tried += 1) {
    try {
      renameSync(next, path);
      return;
    } catch (fault) {
      const code = (fault as NodeJS.ErrnoException).code ?? '';
      if (process.platform !== 'win32' || tried === RENAME_TRIES || !HELD.has(code)) throw fault;
      // The write is synchronous, so the wait is too.
      Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, RENAME_WAIT_MS * tried);
    }
  }
}

/** The whole file as an object, an empty one when there is no file, or null when it is not one. */
function readWhole(path: string): Record<string, unknown> | null {
  let text: string;
  try {
    text = readFileSync(path, 'utf8');
  } catch (fault) {
    if ((fault as NodeJS.ErrnoException).code === 'ENOENT') return {};
    throw fault;
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    return null;
  }
  if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) return null;
  return parsed as Record<string, unknown>;
}

function pathOf(directory: string): string {
  return resolve(join(directory, SETTINGS_FILE));
}
