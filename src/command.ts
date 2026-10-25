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
 * The Digest command as the settings file holds it: the command, or none, or
 * the sentence that says why the value is not one. A value that is wrong does
 * not stop the Plugin Server: the Plugin Page is where the operator fixes it,
 * so research stays up and refuses each Digest with this sentence.
 */
export type CommandSetting = {
  /** The command, or null when the setting holds none or holds a wrong value. */
  readonly command: Command | null;
  /** Why the value is not a command, as one sentence, or null when it is fine. */
  readonly problem: string | null;
};

/** A command from text that holds a JSON array of strings, or null when it does not. */
export function parseCommand(text: string): Command | null {
  try {
    return commandFrom(JSON.parse(text));
  } catch {
    return null;
  }
}

/** A command from a JSON value, or null when it is not an array of strings with a program. */
export function commandFrom(value: unknown): Command | null {
  if (!Array.isArray(value) || !value.every((part) => typeof part === 'string')) return null;
  const [program, ...args] = value as string[];
  if (program === undefined || program.trim() === '') return null;
  return { program, args };
}

/** A command as the JSON array it is written as: the program, then each argument. */
export function arrayOf(command: Command): readonly string[] {
  return [command.program, ...command.args];
}

const WINDOWS = process.platform === 'win32';

/** The extensions Windows runs a program by when PATHEXT does not say. */
const PATHEXT = '.COM;.EXE;.BAT;.CMD';

/** A file Windows runs only through `cmd.exe`. */
const BATCH = /\.(cmd|bat)$/i;

/**
 * The file a program is started from: its own path when it is a path, or the
 * first match on the PATH. On Windows a name with no extension of PATHEXT is
 * looked for with each one, as `cmd.exe` would. Null when there is none.
 */
export function findProgram(program: string, env: NodeJS.ProcessEnv = process.env): string | null {
  const extensions = WINDOWS ? windowsEndings(program, env) : [''];
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

/**
 * What a program's name is tried with on Windows: nothing more when its
 * extension is one of PATHEXT, and each one of PATHEXT when it is not. A name
 * such as `python3.12` has an extension, `.12`, that no program runs by, so it
 * is `python3.12.exe` that is found. A name with another extension is still
 * tried as it is, last.
 */
function windowsEndings(program: string, env: NodeJS.ProcessEnv): string[] {
  const extensions = (env['PATHEXT'] ?? PATHEXT)
    .split(';')
    .filter((extension) => extension !== '');
  const own = extname(program).toUpperCase();
  if (own === '') return extensions;
  if (extensions.some((extension) => extension.toUpperCase() === own)) return [''];
  return [...extensions, ''];
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
 * Start a command whose program is the file `findProgram` found, with no
 * shell, and with its three pipes.
 *
 * On Linux it leads a process group of its own, so that ending it ends what it
 * started too, and nothing it started holds the pipes open after it. On
 * Windows a `.cmd` or `.bat` file goes through `cmd.exe`, and `taskkill /T`
 * ends the tree.
 */
export function startCommand(command: Command): Started {
  const child =
    WINDOWS && BATCH.test(command.program) ? startBatch(command) : startProgram(command);
  return { child, end: () => endTree(child) };
}

function startProgram({ program, args }: Command): ChildProcessWithoutNullStreams {
  return spawn(program, args, { stdio: 'pipe', windowsHide: true, detached: !WINDOWS });
}

/** A `.cmd` or `.bat` file, through `cmd.exe`, with nothing in a word for it to read. */
function startBatch({ program, args }: Command): ChildProcessWithoutNullStreams {
  const line = [forCmd(program, 1), ...args.map((arg) => forCmd(arg, 2))].join(' ');
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
 * tree on Windows. A group or a tree that cannot be ended is said on stderr,
 * and the command alone is killed, which is still better than leaving it.
 */
function endTree(child: ChildProcessWithoutNullStreams): void {
  // The command may have ended while what it started still runs, so the group
  // or the tree is ended whatever the command's own state.
  if (child.pid === undefined) return;
  const failed = WINDOWS ? endWindowsTree(child.pid) : endGroup(child.pid);
  if (failed === null) return;
  process.stderr.write(
    `research: the processes the Digest command started could not all be ended: ${failed}\n`,
  );
  child.kill('SIGKILL');
}

/**
 * End the process group the command leads on Linux. A negative id names the
 * group; Windows has no groups, so this runs on Linux alone. Null when it was
 * ended, or a sentence that says why not.
 */
function endGroup(pid: number): string | null {
  try {
    process.kill(-pid, 'SIGKILL');
    return null;
  } catch (fault) {
    // ESRCH alone means every process of the group has ended already. Any
    // other fault is said.
    if ((fault as NodeJS.ErrnoException).code === 'ESRCH') return null;
    return `the group ${pid} could not be killed (${(fault as Error).message}).`;
  }
}

/**
 * End the tree of the command on Windows with `taskkill /T /F`. Null when it
 * was ended, or a sentence when `taskkill.exe` could not start or exited with
 * anything but 0.
 */
function endWindowsTree(pid: number): string | null {
  const ended = spawnSync(taskkill(), ['/pid', String(pid), '/T', '/F'], {
    stdio: 'ignore',
    windowsHide: true,
  });
  if (ended.error !== undefined) return `${taskkill()} could not start (${ended.error.message}).`;
  if (ended.status === 0) return null;
  return `${taskkill()} exited with ${ended.status ?? 'a signal'}.`;
}

/**
 * `taskkill.exe` by its absolute path in the Windows directory, so that a short
 * PATH, or a program of the same name earlier on it, does not stand in for it.
 */
function taskkill(): string {
  return join(process.env['SystemRoot'] ?? 'C:\\Windows', 'System32', 'taskkill.exe');
}
