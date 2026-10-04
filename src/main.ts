/**
 * Start-up: open `research.db`, serve the tools, and close the file when the
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
import { openStore } from './store.ts';
import { toolsFor } from './tools.ts';

// A file that cannot be opened is one sentence and a non-zero exit: the Index
// Page shows the Plugin Stopped and the journal carries the reason. The Host
// does not start it again.
const store = (() => {
  try {
    return openStore();
  } catch (fault) {
    process.stderr.write(`research: ${sentenceFor(fault)}\n`);
    return process.exit(1);
  }
})();

await serve(toolsFor({ store }));
store.close();
