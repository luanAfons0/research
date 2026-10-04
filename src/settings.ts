/**
 * What research reads from its environment.
 *
 * The Host starts the Plugin Server with the environment it was started with,
 * so these are set where the Host is started: the systemd unit, or the shell.
 * Each one has a default that is right for a person, and a test sets a short
 * one so that it does not wait for a slow page for half a minute.
 */

/** How long one Source may take to answer, in milliseconds. */
export const FETCH_TIMEOUT_VARIABLE = 'RESEARCH_FETCH_TIMEOUT_MS';

/** One slow site must not hold a Sweep, so a Source waits 30 seconds at most (ADR-0001). */
const FETCH_TIMEOUT_MS = 30_000;

/** What the Plugin Server reads from its environment. */
export type Settings = {
  /** How long one Source may take to answer, body and all, in milliseconds. */
  readonly fetchTimeoutMs: number;
};

/** Read the settings, or throw a sentence that names the one that is wrong. */
export function readSettings(env: NodeJS.ProcessEnv = process.env): Settings {
  return {
    fetchTimeoutMs: milliseconds(
      FETCH_TIMEOUT_VARIABLE,
      env[FETCH_TIMEOUT_VARIABLE],
      FETCH_TIMEOUT_MS,
    ),
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
