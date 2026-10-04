/**
 * The Plugin Server starts, answers the Host, and says what it can do.
 *
 * Everything here goes through the one seam: the real `mcp` executable against
 * a temporary Plugin directory, spoken to as the Host speaks to it.
 */
import { strict as assert } from 'node:assert';
import test from 'node:test';
import { PROTOCOL_VERSION, startedAndShaken, startPluginServer } from './helpers/plugin.ts';

test('the Plugin Server answers the handshake', async (t) => {
  const plugin = await startPluginServer(t);

  const answer = await plugin.handshake();

  const result = answer.result as {
    protocolVersion: string;
    capabilities: { tools?: unknown };
    serverInfo: { name: string };
  };
  assert.equal(answer.error, undefined, plugin.output());
  assert.equal(result.protocolVersion, PROTOCOL_VERSION);
  assert.deepEqual(result.capabilities.tools, {});
  assert.equal(result.serverInfo.name, 'research');
});

test('it answers a handshake that offers no Notice, as an older Host sends', async (t) => {
  const plugin = await startPluginServer(t, { notice: false });

  const answer = await plugin.handshake();

  assert.equal(answer.error, undefined, plugin.output());
  assert.equal(plugin.output(), '');
});

test('it lists its tools, and each has a schema for its arguments', async (t) => {
  const plugin = await startedAndShaken(t);

  const answer = await plugin.ask('tools/list');

  assert.equal(answer.error, undefined, plugin.output());
  const { tools } = answer.result as {
    tools: { name: string; description: string; inputSchema: { type: string } }[];
  };
  assert.ok(Array.isArray(tools), 'tools/list did not answer a list');
  for (const tool of tools) {
    assert.ok(tool.description.length > 0, `${tool.name} says nothing about itself`);
    assert.equal(tool.inputSchema.type, 'object');
  }
});

test('nothing but JSON-RPC goes to stdout', async (t) => {
  const plugin = await startedAndShaken(t);
  await plugin.ask('tools/list');
  await plugin.call('no_such_tool', {});
  await plugin.ask('no/such/method');

  for (const line of plugin.lines()) {
    const message = JSON.parse(line) as { jsonrpc?: string };
    assert.equal(message.jsonrpc, '2.0', `this line on stdout is not JSON-RPC: ${line}`);
  }
});

test('a line on stdin that is not JSON is one sentence on stderr, and the pipe survives it', async (t) => {
  const plugin = await startedAndShaken(t);
  const said = plugin.lines().length;

  plugin.raw('this is not JSON');
  const answer = await plugin.ask('tools/list');
  // stderr and stdout are two pipes, so the sentence may land a moment after
  // the answer that was written later.
  for (let waited = 0; !plugin.output().includes('was not JSON') && waited < 2000; waited += 20) {
    await new Promise((done) => setTimeout(done, 20));
  }

  assert.ok(plugin.output().includes('was not JSON'), `stderr said: ${plugin.output()}`);
  assert.ok(plugin.output().startsWith('research: '), `stderr said: ${plugin.output()}`);
  assert.equal(plugin.lines().length, said + 1, 'the bad line was answered on stdout');
  assert.equal(answer.error, undefined);
});

test('a method it does not have is refused with a sentence naming it', async (t) => {
  const plugin = await startedAndShaken(t);

  const answer = await plugin.ask('tools/nonsense');

  assert.equal(answer.error?.code, -32601);
  assert.ok(answer.error?.message.includes('tools/nonsense'), answer.error?.message);
});

test('a tool it does not have is refused with a sentence naming it', async (t) => {
  const plugin = await startedAndShaken(t);

  const answer = await plugin.call('polish_boots');

  assert.equal(answer.error?.code, -32602);
  assert.ok(answer.error?.message.includes('polish_boots'), answer.error?.message);
});

test('it sends no Notice when nothing has happened', async (t) => {
  const plugin = await startedAndShaken(t);

  await plugin.ask('tools/list');

  assert.deepEqual(plugin.notices(), []);
});

test('closing stdin is how the Host stops it, and it goes quietly', async (t) => {
  const plugin = await startedAndShaken(t);
  await plugin.ask('tools/list');

  plugin.stop();

  const ending = await plugin.ended();
  assert.equal(ending.code, 0);
  assert.equal(plugin.output(), '');
});
