# A command is a program and its arguments

research starts the Digest command as a program and a list of arguments, with
no shell, on Windows and on Linux. `RESEARCH_DIGEST_COMMAND` keeps its name,
and its form is a JSON array of strings: the program first, then each of its
arguments.

```json
["ollama", "run", "llama3.2"]
```

This amends ADR-0002, whose command was a shell line that `/bin/sh -c` ran.
Windows has no `sh`, and the App runs research there with its own Node
(FirstMate ADR-0028). scribe's `SCRIBE_MINUTES_COMMAND` takes the same form,
so the two Plugins say a command the same way.

The form is read in one place, `src/command.ts`. The settings file that the
Plugin Page edits keeps the same array, so the variable and the file take
exactly the same thing.

## Considered Options

- **A shell line, split by research.** `ollama run llama3.2` is easier to
  type, but research would need its own rules for quotes, spaces and
  backslashes, and they would differ from both `sh` and `cmd.exe`. A path
  with a space in it, such as `C:\Program Files\…`, would need them at once.
- **A shell line, run by the system's shell.** `sh -c` on Linux and
  `cmd.exe /c` on Windows read the same line in two different ways, and both
  read `$`, `%`, `&` and `|` in an argument.
- **Two settings, a program and its arguments.** It says the same thing as
  one array, in two places that can disagree.

A JSON array has one reading on every system, and every language reads it. It
is also what the settings file holds, with no second form to convert.

## Consequences

No character of an argument is read by anything but the program. A `$`, a
`%`, a quote or a space arrives as it was written.

Windows starts a `.cmd` or `.bat` file only through `cmd.exe`, and an
npm-installed program such as `claude.cmd` is one. research then starts
`cmd.exe` itself, with every character it would read escaped, so the program
the file starts still gets each argument unchanged.

A command that runs past `RESEARCH_DIGEST_TIMEOUT_MS`, or that is still
running when the Plugin Server stops, is ended with every process it started:
its process group on Linux, through `process.kill` with the group's negative
id, and its tree on Windows, through `taskkill /T /F` by its absolute path. A
group or a tree that cannot be ended is said on stderr. Neither system then keeps a model running for a Sweep that
has ended.

There is no `cd`, `&&` or redirection any more. A command that needs them is
a script of the operator's own, named as the program.

A value in the old form, such as `ollama run llama3.2`, is not a JSON array.
research runs nothing the operator did not mean, and it does not stop the
Plugin Server either: the Plugin Page, where the operator fixes the Digest
command, needs it. Such a value is ignored, so the settings file decides, and
then the default. Settings shows one sentence that says the variable was
ignored and to remove it from where the Host is started. A 1.x operator who
upgrades sets the command in Settings and needs nothing else, and removes the
old line from the systemd drop-in when convenient.

A settings file research cannot use does not stop the Plugin Server either.
Each Digest is refused with a sentence that names the file, Settings shows it,
and the next save from the Plugin Page writes the file again.

In JSON a backslash is written twice, so a Windows path is
`"C:\\Users\\you\\AppData\\Roaming\\npm\\claude.cmd"`.
