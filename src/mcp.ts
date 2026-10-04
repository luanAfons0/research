/**
 * The Plugin Server's one connection to the Host: MCP over stdio, one
 * JSON-RPC message per line.
 *
 * A line on stdout that is not JSON breaks the transport, so nothing but
 * JSON-RPC is ever written there and every diagnostic goes to stderr, which
 * the Host hands straight to the journal.
 */
import { createInterface } from 'node:readline';

/** The MCP version the Host speaks. */
export const PROTOCOL_VERSION = '2025-06-18';

/** What this Plugin calls itself when the Host asks. */
export const SERVER_INFO = { name: 'research', version: '0.1.0' };

/** JSON-RPC's own code for a method this Plugin Server does not have. */
export const METHOD_NOT_FOUND = -32601;
/** JSON-RPC's own code for arguments this Plugin Server will not take. */
export const INVALID_PARAMS = -32602;
/** JSON-RPC's own code for a fault that is this Plugin Server's to own. */
export const INTERNAL_ERROR = -32603;

/** What a tool answers: the same data twice, as text and as structure. */
export type ToolResult = {
  readonly content: readonly { readonly type: 'text'; readonly text: string }[];
  readonly structuredContent?: unknown;
};

/** The shape of one tool's arguments, as MCP describes it to a caller. */
export type InputSchema = {
  readonly type: 'object';
  readonly properties: Readonly<Record<string, unknown>>;
  readonly required: readonly string[];
};

/** One thing this Plugin can do, for its own Page or for another Plugin. */
export type Tool = {
  readonly name: string;
  readonly description: string;
  readonly inputSchema: InputSchema;
  call(given: Readonly<Record<string, unknown>>): ToolResult;
};

type Message = {
  readonly id?: string | number | null;
  readonly method?: string;
  readonly params?: Readonly<Record<string, unknown>>;
};

/**
 * A caller's mistake, as a sentence the caller can act on. It is refused as
 * bad arguments rather than as this Plugin Server's own fault, so whoever
 * reads the answer knows which side has to change. `data`, when given, goes
 * out as the JSON-RPC error's own `data`, for a caller that points at the
 * exact part to change, as the Plugin Page does under its Sources.
 */
export function badInput(sentence: string, data?: unknown): Error {
  return Object.assign(new Error(sentence), {
    code: INVALID_PARAMS,
    ...(data === undefined ? {} : { data }),
  });
}

/**
 * Serve these tools to the Host for as long as it holds the pipe open. The
 * promise settles when the Host closes stdin, which is how it asks a Plugin
 * Server to stop.
 */
export function serve(tools: readonly Tool[]): Promise<void> {
  const byName = new Map(tools.map((tool) => [tool.name, tool]));
  const lines = createInterface({ input: process.stdin });
  lines.on('line', (line) => {
    if (line.trim() === '') return;
    let message: Message;
    try {
      message = JSON.parse(line) as Message;
    } catch {
      process.stderr.write('research: a line on stdin was not JSON.\n');
      return;
    }
    // A message that names no method answers something this Plugin Server
    // asked. Nothing here asks the Host anything yet, so there is nothing to
    // do with one.
    if (message.method === undefined) return;
    // A notification carries no id and is never answered.
    if (message.id === undefined || message.id === null) return;
    dispatch(byName, message.id, message);
  });
  return new Promise((closed) => lines.once('close', closed));
}

/** One line on stdout, which is the whole of what this Plugin Server says. */
function reply(message: unknown): void {
  process.stdout.write(`${JSON.stringify(message)}\n`);
}

function answer(id: string | number, result: unknown): void {
  reply({ jsonrpc: '2.0', id, result });
}

function refuse(id: string | number, code: number, message: string, data?: unknown): void {
  reply({ jsonrpc: '2.0', id, error: { code, message, ...(data === undefined ? {} : { data }) } });
}

function dispatch(
  byName: ReadonlyMap<string, Tool>,
  id: string | number,
  message: Message,
): void {
  const params = message.params ?? {};
  try {
    switch (message.method) {
      case 'initialize':
        answer(id, {
          protocolVersion: PROTOCOL_VERSION,
          capabilities: { tools: {} },
          serverInfo: SERVER_INFO,
        });
        return;
      case 'tools/list':
        answer(id, { tools: [...byName.values()].map(described) });
        return;
      case 'tools/call': {
        const name = String(params['name']);
        const tool = byName.get(name);
        if (tool === undefined) {
          refuse(id, INVALID_PARAMS, `no such tool: ${name}`);
          return;
        }
        const given = params['arguments'];
        if (given !== undefined && (typeof given !== 'object' || given === null)) {
          refuse(id, INVALID_PARAMS, `${name} takes its arguments as an object.`);
          return;
        }
        answer(id, tool.call((given as Record<string, unknown>) ?? {}));
        return;
      }
      default:
        refuse(id, METHOD_NOT_FOUND, `no such method: ${message.method}`);
    }
  } catch (fault) {
    refuse(id, codeOf(fault), sentenceFor(fault), dataOf(fault));
  }
}

function described(tool: Tool): unknown {
  return { name: tool.name, description: tool.description, inputSchema: tool.inputSchema };
}

function codeOf(fault: unknown): number {
  const code = (fault as { code?: unknown } | null)?.code;
  return code === INVALID_PARAMS ? INVALID_PARAMS : INTERNAL_ERROR;
}

function dataOf(fault: unknown): unknown {
  return (fault as { data?: unknown } | null)?.data;
}

/** Whatever was thrown, as a sentence rather than as a stack trace. */
export function sentenceFor(fault: unknown): string {
  return fault instanceof Error ? fault.message : String(fault);
}
