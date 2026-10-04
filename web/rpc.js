/* research's own Plugin Server, reached from every page in web/. It defines
   three globals: request(method, params) → the JSON-RPC result,
   listTools() → the tools the Plugin Server ships, and
   call(name, args) → one tool's structured answer. A refusal is an Error
   with the Plugin Server's sentence, and its data, when there is some. */
'use strict';

// The one address a page talks to: its own Plugin's tools, relative to the
// address the Host serves the page from. FirstMate admits the page with a
// cookie it set on the first navigation, so nothing here carries a token and
// no address is built by hand (FirstMate ADR-0003).
const RPC = 'rpc';

// What the Host answers when it cannot reach the Plugin Server at all. An
// empty page would leave either one a mystery, so each becomes a sentence.
const STOPPED = 503;
const NO_PLUGIN_SERVER = 501;

let requests = 0;

/** One JSON-RPC request to this Plugin's own Plugin Server, through the Host. */
async function request(method, params) {
  const response = await fetch(RPC, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      jsonrpc: '2.0',
      id: (requests += 1),
      method: method,
      params: params || {},
    }),
  });

  if (response.status === STOPPED) {
    throw new Error(
      'research’s Plugin Server is Stopped. The reason is in the journal: ' +
        'journalctl --user -u firstmate -f. The Host never starts it again on its own, ' +
        'so restart the Host once it is fixed.',
    );
  }
  if (response.status === NO_PLUGIN_SERVER) {
    throw new Error('The Host found no Plugin Server for research, so it has nothing to show.');
  }
  if (!response.ok) {
    throw new Error('The Host answered ' + response.status + ' for this request.');
  }

  const answered = await response.json();
  if (answered.error) {
    // The sentence is for a person. The data, when the Plugin Server gives
    // some, says which part to change, so the page can point at it.
    const refused = new Error(answered.error.message);
    if (answered.error.data !== undefined) refused.data = answered.error.data;
    throw refused;
  }
  return answered.result;
}

/** Every tool this Plugin's Plugin Server ships, as tools/list names them. */
async function listTools() {
  const result = await request('tools/list');
  return result.tools;
}

/** One tool call on this Plugin's own Plugin Server. */
async function call(name, args) {
  const result = await request('tools/call', { name: name, arguments: args || {} });
  return result.structuredContent;
}
