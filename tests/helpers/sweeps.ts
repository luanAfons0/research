/**
 * The words a test of a Sweep says again and again: make a Topic, start a
 * Sweep, and wait for it to end. Each one goes through the tools, as the
 * Plugin Page and other Plugins do; nothing here reaches inside research.
 */
import { join } from 'node:path';
import { FIXTURES, structureOf, type Started } from './plugin.ts';

/**
 * The fixture Digest program: the Node script on Linux, and its `.cmd` form on
 * Windows, where a script runs only through a file Windows knows how to start.
 */
export const DIGEST_PROGRAM = join(
  FIXTURES,
  process.platform === 'win32' ? 'digest.cmd' : 'digest',
);

/** A Digest command as RESEARCH_DIGEST_COMMAND carries it: the program, then its arguments. */
export function commandOf(program: string, ...args: readonly string[]): string {
  return JSON.stringify([program, ...args]);
}

/** The fixture Digest command, as RESEARCH_DIGEST_COMMAND names it. */
export const DIGEST_COMMAND = commandOf(DIGEST_PROGRAM);

/** One Extract, as get_sweep gives it. */
export type Extract = {
  n: number;
  address: string;
  state: string;
  text: string | null;
  characters: number | null;
  note: string | null;
  reason: string | null;
  contentType: string | null;
  readAt: string | null;
  cut: boolean;
  cutAt: number | null;
};

/** One Sweep, as get_sweep gives it. */
export type Sweep = {
  id: number;
  topicId: number;
  startedAt: string;
  endedAt: string | null;
  state: string;
  reason: string | null;
  /** The stable code of the reason, which the Plugin Page maps to what it says. */
  failure: string | null;
  sourceCount: number;
  readCount: number;
  digest: string | null;
  digestAt: string | null;
  extracts: Extract[];
};

/** How long a test waits for a Sweep to end before it gives up. */
const END_TIMEOUT_MS = 10_000;

/** Make a Topic with these Sources, and hand back its id. */
export async function topicWith(
  plugin: Started,
  sources: readonly string[],
  name = 'Node 24 release',
): Promise<number> {
  const made = structureOf<{ topic: { id: number } }>(
    await plugin.call('create_topic', { name, question: 'What changed?', sources }),
  );
  return made.topic.id;
}

/** Start a Sweep of a Topic, and hand back what sweep_topic answered. */
export async function sweepOf(plugin: Started, topic: number): Promise<Sweep> {
  return structureOf<{ sweep: Sweep }>(await plugin.call('sweep_topic', { id: topic })).sweep;
}

/** One Sweep, whole, as get_sweep gives it. */
export async function sweepNamed(plugin: Started, id: number): Promise<Sweep> {
  return structureOf<{ sweep: Sweep }>(await plugin.call('get_sweep', { id })).sweep;
}

/** Wait until a Sweep is no longer `reading` or `digesting`, and hand it back. */
export async function ended(plugin: Started, id: number): Promise<Sweep> {
  const start = Date.now();
  for (;;) {
    const sweep = await sweepNamed(plugin, id);
    if (sweep.state !== 'reading' && sweep.state !== 'digesting') return sweep;
    if (Date.now() - start > END_TIMEOUT_MS) {
      throw new Error(
        `Sweep ${id} was still ${sweep.state} after ${END_TIMEOUT_MS} ms.\n${plugin.output()}`,
      );
    }
    await new Promise((later) => setTimeout(later, 20));
  }
}

/** Wait until something is so, asking every few milliseconds. */
export async function until(what: string, check: () => boolean | Promise<boolean>): Promise<void> {
  const start = Date.now();
  while (!(await check())) {
    if (Date.now() - start > END_TIMEOUT_MS) {
      throw new Error(`${what} was not so in ${END_TIMEOUT_MS} ms.`);
    }
    await new Promise((later) => setTimeout(later, 10));
  }
}

/** Sweep a Topic of these Sources to its end, and hand back the Sweep. */
export async function sweptWhole(plugin: Started, sources: readonly string[]): Promise<Sweep> {
  const topic = await topicWith(plugin, sources);
  const started = await sweepOf(plugin, topic);
  return ended(plugin, started.id);
}
