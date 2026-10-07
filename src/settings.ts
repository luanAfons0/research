/**
 * What research reads from its environment, and the Digest command, which
 * the environment or the settings file decides.
 *
 * The Host starts the Plugin Server with the environment it was started with,
 * so a variable is set where the Host is started: the systemd unit, or the
 * shell. Each time has a default that is right for a person, and a test sets a
 * short one so that it does not wait for a slow page for half a minute, or 5
 * seconds between two Notices. The times stay in the environment alone.
 *
 * The Digest command is the operator's choice, so it is set from the Plugin
 * Page and kept in the settings file, which works however the Host was
 * started. `RESEARCH_DIGEST_COMMAND` still beats the file, and the file beats
 * the default, which is no command: research knows no model (ADR-0002).
 *
 * A Digest command that is wrong does not stop the Plugin Server: the Plugin
 * Page is where the operator fixes it (ADR-0003). A variable that is not a
 * command, such as the shell line a 1.x systemd drop-in still sets, is
 * ignored, so the settings file decides and the operator needs nothing but
 * the Plugin Page; the settings tools say it was ignored and to remove it. A
 * settings file that is wrong refuses each Digest with a sentence that names
 * it, until a save from the Plugin Page writes it again.
 */
import {
  arrayOf,
  type Command,
  COMMAND_FORM,
  type CommandSetting,
  parseCommand,
} from './command.ts';
import { readSettingsFile, writeSettingsFile } from './settings-file.ts';

/** How long one Source may take to answer, in milliseconds. */
export const FETCH_TIMEOUT_VARIABLE = 'RESEARCH_FETCH_TIMEOUT_MS';

/**
 * The command that makes a Digest: a prompt on its stdin, the Digest on its
 * stdout (ADR-0002). It is a JSON array: the program, then its arguments (ADR-0003).
 */
export const DIGEST_VARIABLE = 'RESEARCH_DIGEST_COMMAND';

/** How long the Digest command may run, in milliseconds. */
export const DIGEST_TIMEOUT_VARIABLE = 'RESEARCH_DIGEST_TIMEOUT_MS';

/** How long research waits after one Notice before it sends the next, in milliseconds. */
export const NOTICE_GAP_VARIABLE = 'RESEARCH_NOTICE_GAP_MS';

/** One slow site must not hold a Sweep, so a Source waits 30 seconds at most (ADR-0001). */
const FETCH_TIMEOUT_MS = 30_000;

/** A model on a CPU is slow, so the Digest command may take 15 minutes, as scribe's Minutes do. */
const DIGEST_TIMEOUT_MS = 15 * 60_000;

/**
 * The Host takes one Notice from a Plugin every 5 seconds, and refuses the
 * rest (FirstMate ADR-0014).
 */
const NOTICE_GAP_MS = 5_000;

/** What the Plugin Server reads from its environment. */
export type Settings = {
  /** How long one Source may take to answer, body and all, in milliseconds. */
  readonly fetchTimeoutMs: number;
  /** How long the Digest command may run before it is stopped, in milliseconds. */
  readonly digestTimeoutMs: number;
  /** How long to wait after one Notice before the next, in milliseconds. */
  readonly noticeGapMs: number;
};

/** Read the settings, or throw a sentence that names the one that is wrong. */
export function readSettings(env: NodeJS.ProcessEnv = process.env): Settings {
  return {
    fetchTimeoutMs: milliseconds(
      FETCH_TIMEOUT_VARIABLE,
      env[FETCH_TIMEOUT_VARIABLE],
      FETCH_TIMEOUT_MS,
    ),
    digestTimeoutMs: milliseconds(
      DIGEST_TIMEOUT_VARIABLE,
      env[DIGEST_TIMEOUT_VARIABLE],
      DIGEST_TIMEOUT_MS,
    ),
    noticeGapMs: milliseconds(NOTICE_GAP_VARIABLE, env[NOTICE_GAP_VARIABLE], NOTICE_GAP_MS),
  };
}

function milliseconds(variable: string, value: string | undefined, fallback: number): number {
  const given = value?.trim() ?? '';
  if (given === '') return fallback;
  const read = Number(given);
  if (!Number.isSafeInteger(read) || read <= 0) {
    throw new Error(`${variable} is ${given}; set it to a whole number of milliseconds.`);
  }
  return read;
}

/** Who decides the Digest command: the environment, the settings file, or neither. */
export type DecidedBy = 'environment' | 'file' | 'default';

/**
 * The Digest command the next Digest is made with, who decided it, and why
 * what decided it cannot be used, if it cannot.
 */
export type Chosen = CommandSetting & { readonly from: DecidedBy };

/** The Digest command, as the settings tools tell it. */
export type DigestCommandView = {
  /** The program and its arguments the next Digest runs, or null for none. */
  readonly value: readonly string[] | null;
  /** Who decided it. */
  readonly from: DecidedBy;
  /** What the settings file holds, whether or not the environment beats it. */
  readonly saved: readonly string[] | null;
  /** The variable that beats the file. */
  readonly variable: string;
  /** Why the setting that decides cannot be used, as one sentence, or null. */
  readonly problem: string | null;
  /** Why the variable is ignored and what to do about it, as one sentence, or null. */
  readonly ignored: string | null;
};

/** The Digest command of one running Plugin Server: read it, tell it, change it. */
export type DigestCommandSetting = {
  /** What the next Digest runs, decided now. */
  current(): Chosen;
  /** The setting as the tools tell it. */
  view(): DigestCommandView;
  /** Save a command in the settings file, or null for none, and use it from now on. */
  save(command: Command | null): void;
};

/**
 * The Digest command, from the environment and the settings file in the
 * Plugin directory. Each is read once, here. Nothing that is wrong is thrown,
 * so the Plugin Server stays up for the operator to fix it.
 */
export function openDigestCommand(
  env: NodeJS.ProcessEnv = process.env,
  directory = '.',
): DigestCommandSetting {
  const given = env[DIGEST_VARIABLE]?.trim() ?? '';
  const environment = given === '' ? null : parseCommand(given);
  const ignored =
    given !== '' && environment === null
      ? `${DIGEST_VARIABLE} is ${given}, which is not ${COMMAND_FORM}, so research ignores it. ` +
        'Remove it from where the Host is started, such as the systemd drop-in of research ' +
        '1.x, and set the Digest command in Settings.'
      : null;
  let file = readSettingsFile(directory);
  const current = (): Chosen =>
    environment !== null
      ? { command: environment, problem: null, from: 'environment' }
      : file.command !== null || file.problem !== null
        ? { ...file, from: 'file' }
        : { command: null, problem: null, from: 'default' };
  return {
    current,
    view: () => {
      const chosen = current();
      return {
        value: chosen.command === null ? null : arrayOf(chosen.command),
        from: chosen.from,
        saved: file.command === null ? null : arrayOf(file.command),
        variable: DIGEST_VARIABLE,
        problem: chosen.problem,
        ignored,
      };
    },
    save: (command) => {
      writeSettingsFile({ digestCommand: command }, directory);
      file = { command, problem: null };
    },
  };
}
