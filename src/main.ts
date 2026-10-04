/**
 * Start-up: read the settings, open `research.db`, fail the Sweeps the last
 * Plugin Server left running, serve the tools, send the Notices once the
 * Host's handshake offers them, and close the file when the Host closes the
 * pipe.
 *
 * The Host spawned this process, holds both ends of its pipe, and started it
 * in the Plugin's own directory, so the one file this Plugin owns is one
 * relative path away (FirstMate ADR-0005).
 *
 * It says nothing on the way up or on the way down. A Plugin Server that
 * started is what the Index Page shows; the journal is for what went wrong.
 */
import { askHost, sentenceFor, serve } from './mcp.ts';
import { NOTICE_METHOD, openNotices } from './notices.ts';
import { readSettings } from './settings.ts';
import { openStore } from './store.ts';
import { failUnfinished } from './sweeps.ts';
import { toolsFor } from './tools.ts';

// A setting or a file that is wrong is one sentence and a non-zero exit: the
// Index Page shows the Plugin Stopped and the journal carries the reason. The
// Host does not start it again.
const { settings, store, notices } = (() => {
  try {
    const settings = readSettings();
    const store = openStore();
    // Notices wait on the queue until the Host's handshake says whether it
    // takes them (FirstMate ADR-0014).
    const notices = openNotices({
      ask: (notice) => askHost(NOTICE_METHOD, notice),
      gapMs: settings.noticeGapMs,
    });
    // A Sweep that still runs was left by a Plugin Server that stopped, and
    // nothing will end it now.
    failUnfinished(store, notices);
    return { settings, store, notices };
  } catch (fault) {
    process.stderr.write(`research: ${sentenceFor(fault)}\n`);
    return process.exit(1);
  }
})();

// Stopping aborts every read of every running Sweep, and stops every Digest
// command, before the file closes under them. Those Sweeps stay as they are,
// and the next start fails them.
const stopping = new AbortController();

await serve(
  toolsFor({
    store,
    reading: { timeoutMs: settings.fetchTimeoutMs, stopping: stopping.signal },
    digesting: { command: settings.digestCommand, timeoutMs: settings.digestTimeoutMs },
    notices,
  }),
  (offered) => notices.offered(offered.notice),
);
notices.close();
stopping.abort();
store.close();
