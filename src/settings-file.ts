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
 */
import { readFileSync, renameSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { COMMAND_FORM, commandFrom, type Command } from './command.ts';

/** The name of the settings file in the Plugin directory. */
export const SETTINGS_FILE = 'settings.json';

/** What the settings file holds. */
export type SavedSettings = {
  /** The Digest command saved from the Plugin Page, or null when none is. */
  readonly digestCommand: Command | null;
};

/**
 * Read the settings file in a Plugin directory. No file is no setting. A file
 * that is not what research writes throws a sentence that names it.
 */
export function readSettingsFile(directory = '.'): SavedSettings {
  const whole = readWhole(directory);
  const given = whole['digestCommand'];
  if (given === undefined || given === null) return { digestCommand: null };
  const command = commandFrom(given);
  if (command === null) {
    throw new Error(
      `${pathOf(directory)} holds the Digest command ${JSON.stringify(given)}; set it to ` +
        `${COMMAND_FORM} on the Plugin Page, or remove the file.`,
    );
  }
  return { digestCommand: command };
}

/** Write these settings into the file, and keep every key this research does not know. */
export function writeSettingsFile(settings: SavedSettings, directory = '.'): void {
  const whole = readWhole(directory);
  const { digestCommand } = settings;
  if (digestCommand === null) delete whole['digestCommand'];
  else whole['digestCommand'] = [digestCommand.program, ...digestCommand.args];
  const path = pathOf(directory);
  const next = `${path}.next`;
  writeFileSync(next, `${JSON.stringify(whole, null, 2)}\n`);
  renameSync(next, path);
}

/** The whole file as an object, or an empty one when there is no file. */
function readWhole(directory: string): Record<string, unknown> {
  const path = pathOf(directory);
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
    parsed = undefined;
  }
  if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
    throw new Error(`${path} is not a JSON object. Fix it, or remove it to start again.`);
  }
  return parsed as Record<string, unknown>;
}

function pathOf(directory: string): string {
  return resolve(join(directory, SETTINGS_FILE));
}
