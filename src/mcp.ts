/**
 * The Plugin Server's one connection to the Host: MCP over stdio, one
 * JSON-RPC message per line.
 *
 * A line on stdout that is not JSON breaks the transport, so nothing but
 * JSON-RPC is ever written there and every diagnostic goes to stderr, which
 * the Host hands straight to the journal.
 *
 * The pipe goes both ways. research answers the Host's requests, and sends
 * requests of its own on its own account: the `firstmate/notice` that tells
 * the operator a Sweep ended (FirstMate ADR-0014). Each side numbers its own
 * requests, so a message that names a method is always a request, and only a
 * message that names none is an answer to one of research's (FirstMate
 * ADR-0009). research's ids are strings of its own, so even a reader that got
 * that wrong could not take one for the Host's numbers.
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
  readonly result?: unknown;
  readonly error?: { readonly code: number; readonly message: string };
};

/** What the Host offered in its handshake, as far as research reads it. */
export type Offered = {
  /** Whether the Host takes a `firstmate/notice` (FirstMate ADR-0014). */
  readonly notice: boolean;
};

/** The Host's answer to one of research's own requests: exactly one of the two. */
export type HostAnswer = {
  readonly result?: unknown;
  readonly error?: { readonly code: number; readonly message: string };
};

/** Whoever here waits for the Host, by the id research asked with. */
const owed = new Map<string, (answer: HostAnswer) => void>();
let asked = 0;

/**
 * Ask the Host something on research's own account, and wait for its answer.
 * The id is research's own, numbered on this side of the pipe (FirstMate
 * ADR-0009).
 */
export function askHost(method: string, params: unknown): Promise<HostAnswer> {
  const id = `research-${(asked += 1)}`;
  return new Promise((answered) => {
    owed.set(id, answered);
    reply({ jsonrpc: '2.0', id, method, params });
  });
}

/** Hand the Host's answer to whoever asked. An answer nobody is owed is dropped. */
function settle(message: Message): void {
  const answered = owed.get(String(message.id));
  if (answered === undefined) return;
  owed.delete(String(message.id));
  answered(message.error === undefined ? { result: message.result } : { error: message.error });
}

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
 * Serve these tools to the Host for as long as it holds the pipe open, and
 * say what the Host offered once its handshake comes. The promise settles
 * when the Host closes stdin, which is how it asks a Plugin Server to stop.
 */
export function serve(
  tools: readonly Tool[],
  handshaken: (offered: Offered) => void = () => {},
): Promise<void> {
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
    // A message that names no method answers something research asked. One
    // that names a method is a request, whatever its id, because the Host
    // numbers its own requests and may reach one of research's ids.
    if (message.method === undefined) {
      settle(message);
      return;
    }
    // A notification carries no id and is never answered.
    if (message.id === undefined || message.id === null) return;
    if (message.method === 'initialize') handshaken(offeredBy(message.params));
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

/** What the Host's handshake offers: a Notice only when it carries the capability. */
function offeredBy(params: Message['params']): Offered {
  const capabilities = params?.['capabilities'] as
    | { experimental?: { firstmate?: { notice?: unknown } } }
    | undefined;
  const notice = capabilities?.experimental?.firstmate?.notice;
  return { notice: typeof notice === 'object' && notice !== null };
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
