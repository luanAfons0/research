/**
 * Start-up: read the settings, open `research.db`, fail the Sweeps the last
 * Plugin Server left running, serve the tools, and close the file when the
 * Host closes the pipe.
 *
 * The Host spawned this process, holds both ends of its pipe, and started it
 * in the Plugin's own directory, so the one file this Plugin owns is one
 * relative path away (FirstMate ADR-0005).
 *
 * It says nothing on the way up or on the way down. A Plugin Server that
 * started is what the Index Page shows; the journal is for what went wrong.
 */
import { sentenceFor, serve } from './mcp.ts';
import { readSettings } from './settings.ts';
import { openStore } from './store.ts';
import { failUnfinished } from './sweeps.ts';
import { toolsFor } from './tools.ts';

// A setting or a file that is wrong is one sentence and a non-zero exit: the
// Index Page shows the Plugin Stopped and the journal carries the reason. The
// Host does not start it again.
const { settings, store } = (() => {
  try {
    const settings = readSettings();
    const store = openStore();
    // A Sweep that still runs was left by a Plugin Server that stopped, and
    // nothing will end it now.
    failUnfinished(store);
    return { settings, store };
  } catch (fault) {
    process.stderr.write(`research: ${sentenceFor(fault)}\n`);
    return process.exit(1);
  }
})();

// Stopping aborts every read of every running Sweep, before the file closes
// under them. Those Sweeps stay as they are, and the next start fails them.
const stopping = new AbortController();

await serve(
  toolsFor({ store, reading: { timeoutMs: settings.fetchTimeoutMs, stopping: stopping.signal } }),
);
stopping.abort();
store.close();
