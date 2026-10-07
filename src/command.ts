/**
 * A command research starts: a program and a list of arguments, started with
 * no shell, on Windows and on Linux, and ended with every process it started
 * (ADR-0003).
 *
 * A shell line is read differently by `sh` and by `cmd.exe`, and Windows has
 * no `sh`. A program and its arguments, written as a JSON array, mean the same
 * thing on both systems, and no character in an argument is read by anything
 * but the program. That form is read here and nowhere else, so the
 * environment variable and the settings file take exactly the same thing.
 *
 * Windows starts a `.cmd` or `.bat` file only through `cmd.exe`, and an
 * npm-installed program such as `claude.cmd` is one. research then starts
 * `cmd.exe` itself, with every character `cmd.exe` would read escaped, as the
 * Host starts an `mcp.cmd` (FirstMate ADR-0019).
 *
 * research takes no dependency for this (FirstMate ADR-0005 keeps Plugins
 * apart, and `firstmate install` runs no `npm install`).
 */
import { type ChildProcessWithoutNullStreams, spawn, spawnSync } from 'node:child_process';
import { accessSync, constants, statSync } from 'node:fs';
import { delimiter, extname, isAbsolute, join } from 'node:path';

/** A program and the arguments it is started with. */
export type Command = {
  /** The program: a name looked for on the PATH, or a path to it. */
  readonly program: string;
  /** Each argument, given to the program exactly as it is written. */
  readonly args: readonly string[];
};

/** The form a command is written in, as a sentence that refuses another one says it. */
export const COMMAND_FORM =
  'a JSON array of strings, the program first and then each of its arguments, such as ' +
  '["ollama","run","<model>"]';

/**
 * A command from what a setting holds: a JSON array of strings, the program
 * first. Undefined, or text that is blank, is no command. Anything else
 * throws a sentence that names the setting, the value and the form.
 */
export function readCommand(setting: string, value: string | undefined): Command | null {
  const given = value?.trim() ?? '';
  if (given === '') return null;
  let parsed: unknown;
  try {
    parsed = JSON.parse(given);
  } catch {
    parsed = undefined;
  }
  const command = commandFrom(parsed);
  if (command === null) throw new Error(`${setting} is ${given}; set it to ${COMMAND_FORM}.`);
  return command;
}

/** A command from a JSON value, or null when it is not an array of strings with a program. */
export function commandFrom(value: unknown): Command | null {
  if (!Array.isArray(value) || !value.every((part) => typeof part === 'string')) return null;
  const [program, ...args] = value as string[];
  if (program === undefined || program.trim() === '') return null;
  return { program, args };
}

const WINDOWS = process.platform === 'win32';

/** The extensions Windows runs a program by when PATHEXT does not say. */
const PATHEXT = '.COM;.EXE;.BAT;.CMD';

/** A file Windows runs only through `cmd.exe`. */
const BATCH = /\.(cmd|bat)$/i;

/**
 * The file a program is started from: its own path when it is a path, or the
 * first match on the PATH. On Windows a name with no extension is looked for
 * with each one in PATHEXT, as `cmd.exe` would. Null when there is none.
 */
export function findProgram(program: string, env: NodeJS.ProcessEnv = process.env): string | null {
  const extensions = WINDOWS && extname(program) === '' ? windowsExtensions(env) : [''];
  const isPath =
    isAbsolute(program) || program.includes('/') || (WINDOWS && program.includes('\\'));
  const directories = isPath
    ? ['']
    : (env['PATH'] ?? '').split(delimiter).filter((directory) => directory !== '');
  for (const directory of directories) {
    for (const extension of extensions) {
      const name = program + extension;
      const candidate = directory === '' ? name : join(directory, name);
      if (runnable(candidate)) return candidate;
    }
  }
  return null;
}

function windowsExtensions(env: NodeJS.ProcessEnv): string[] {
  return (env['PATHEXT'] ?? PATHEXT).split(';').filter((extension) => extension !== '');
}

function runnable(file: string): boolean {
  try {
    if (!statSync(file).isFile()) return false;
    accessSync(file, constants.X_OK);
    return true;
  } catch {
    return false;
  }
}

/** A command that runs: its pipes, and how to end it with everything it started. */
export type Started = {
  /** The process, with stdin, stdout and stderr as pipes. */
  readonly child: ChildProcessWithoutNullStreams;
  /** End the command and every process it started. Ending one that has ended does nothing. */
  readonly end: () => void;
};

/**
 * Start a command from the file `findProgram` found, with no shell, and with
 * its three pipes.
 *
 * On Linux it leads a process group of its own, so that ending it ends what it
 * started too, and nothing it started holds the pipes open after it. On
 * Windows a `.cmd` or `.bat` file goes through `cmd.exe`, and `taskkill /T`
 * ends the tree.
 */
export function startCommand(file: string, args: readonly string[]): Started {
  const child = WINDOWS && BATCH.test(file) ? startBatch(file, args) : startProgram(file, args);
  return { child, end: () => endTree(child) };
}

function startProgram(file: string, args: readonly string[]): ChildProcessWithoutNullStreams {
  return spawn(file, args, { stdio: 'pipe', windowsHide: true, detached: !WINDOWS });
}

/** A `.cmd` or `.bat` file, through `cmd.exe`, with nothing in a word for it to read. */
function startBatch(file: string, args: readonly string[]): ChildProcessWithoutNullStreams {
  const line = [forCmd(file, 1), ...args.map((arg) => forCmd(arg, 2))].join(' ');
  return spawn(process.env['ComSpec'] ?? 'cmd.exe', ['/d', '/s', '/c', `"${line}"`], {
    stdio: 'pipe',
    windowsHide: true,
    windowsVerbatimArguments: true,
  });
}

/** Every character `cmd.exe` reads as more than a letter. */
const CMD_META = /([()\][%!^"`<>&|;, *?])/g;

/**
 * One word on the line `cmd.exe /s /c` runs a `.cmd` file with, so that the
 * file, and the program it starts, get it unchanged.
 *
 * The word is first quoted as a Windows program reads its command line:
 * backslashes double before a quote and at the end, and a quote is escaped.
 * Then each character `cmd.exe` would read is escaped with `^`. `cmd.exe`
 * reads the file's own name once. It reads an argument twice, because a
 * `.cmd` file passes its arguments on with `%*` and that line is read again,
 * so an argument is escaped twice. An npm-installed program is such a file.
 */
function forCmd(word: string, reads: 1 | 2): string {
  const quoted = `"${word.replace(/(\\*)"/g, '$1$1\\"').replace(/(\\*)$/, '$1$1')}"`;
  const once = quoted.replace(CMD_META, '^$1');
  return reads === 1 ? once : once.replace(CMD_META, '^$1');
}

/**
 * End a command and every process it started: its process group on Linux, its
 * tree on Windows. When the tool that ends a group or a tree cannot be run, the
 * command alone is killed, which is still better than leaving it.
 */
function endTree(child: ChildProcessWithoutNullStreams): void {
  // The command may have ended while what it started still runs, so the group
  // or the tree is ended whatever the command's own state.
  if (child.pid === undefined) return;
  const ended = WINDOWS
    ? spawnSync(taskkill(), ['/pid', String(child.pid), '/T', '/F'], {
        stdio: 'ignore',
        windowsHide: true,
      })
    : // The system's own tool ends the group, as `taskkill` ends the tree on
      // Windows, so no call here takes an id that only POSIX knows. `kill`
      // reads a process group as the id with a minus sign, after `--`.
      spawnSync('kill', ['-KILL', '--', `-${child.pid}`], { stdio: 'ignore' });
  if (ended.error !== undefined || ended.status !== 0) child.kill('SIGKILL');
}

/** `taskkill.exe` from the Windows directory, so that a short PATH does not hide it. */
function taskkill(): string {
  const windows = process.env['SystemRoot'];
  return windows === undefined ? 'taskkill.exe' : join(windows, 'System32', 'taskkill.exe');
}
