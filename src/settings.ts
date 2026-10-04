/**
 * What research reads from its environment.
 *
 * The Host starts the Plugin Server with the environment it was started with,
 * so these are set where the Host is started: the systemd unit, or the shell.
 * Each time has a default that is right for a person, and a test sets a short
 * one so that it does not wait for a slow page for half a minute. The Digest
 * command has no default: research knows no model (ADR-0002).
 */

/** How long one Source may take to answer, in milliseconds. */
export const FETCH_TIMEOUT_VARIABLE = 'RESEARCH_FETCH_TIMEOUT_MS';

/** The command that makes a Digest: a prompt on its stdin, the Digest on its stdout (ADR-0002). */
export const DIGEST_VARIABLE = 'RESEARCH_DIGEST_COMMAND';

/** How long the Digest command may run, in milliseconds. */
export const DIGEST_TIMEOUT_VARIABLE = 'RESEARCH_DIGEST_TIMEOUT_MS';

/** One slow site must not hold a Sweep, so a Source waits 30 seconds at most (ADR-0001). */
const FETCH_TIMEOUT_MS = 30_000;

/** A model on a CPU is slow, so the Digest command may take 15 minutes, as scribe's Minutes do. */
const DIGEST_TIMEOUT_MS = 15 * 60_000;

/** What the Plugin Server reads from its environment. */
export type Settings = {
  /** How long one Source may take to answer, body and all, in milliseconds. */
  readonly fetchTimeoutMs: number;
  /** The Digest command, run by `sh`, or null when none is set (ADR-0002). */
  readonly digestCommand: string | null;
  /** How long the Digest command may run before it is stopped, in milliseconds. */
  readonly digestTimeoutMs: number;
};

/** Read the settings, or throw a sentence that names the one that is wrong. */
export function readSettings(env: NodeJS.ProcessEnv = process.env): Settings {
  return {
    fetchTimeoutMs: milliseconds(
      FETCH_TIMEOUT_VARIABLE,
      env[FETCH_TIMEOUT_VARIABLE],
      FETCH_TIMEOUT_MS,
    ),
    digestCommand: nonEmpty(env[DIGEST_VARIABLE]),
    digestTimeoutMs: milliseconds(
      DIGEST_TIMEOUT_VARIABLE,
      env[DIGEST_TIMEOUT_VARIABLE],
      DIGEST_TIMEOUT_MS,
    ),
  };
}

/** A variable's value, trimmed, or null when it is not set or is only blanks. */
function nonEmpty(value: string | undefined): string | null {
  const given = value?.trim() ?? '';
  return given === '' ? null : given;
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
