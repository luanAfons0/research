/**
 * The tools this Plugin ships: one for each thing the Plugin Page or another
 * Plugin can ask research to do (FirstMate ADR-0009).
 *
 * The Plugin Page uses these same tools, through the Host's `rpc` address, so
 * there is one list of what research can do. Every tool answers the same data
 * twice: as text, for whoever reads it in a terminal, and as structure, for
 * the Page, which draws it. Each refusal is a JSON-RPC error with a sentence.
 */
import type { InputSchema, Tool, ToolResult } from './mcp.ts';
import { within, type Store } from './store.ts';
import {
  changeTopic,
  checkTopicId,
  checkTopicInput,
  deleteTopic,
  listTopics,
  makeTopic,
  viewOf,
} from './topics.ts';

/** What the tools work over. */
export type Parts = {
  readonly store: Store;
};

const ID = { type: 'integer', description: 'The id of the Topic, from list_topics.' };
const NAME = { type: 'string', description: 'One line that names the Topic.' };
const QUESTION = {
  type: 'string',
  description:
    'What the Digest answers, in the language the Digest is written in. It may be empty.',
};
const SOURCES = {
  type: 'array',
  items: { type: 'string' },
  description:
    'The addresses of the Sources, in order. Each one is http or https; research reads ' +
    'that page and no page it links to.',
};

/** Only the id of a Topic. */
const BY_ID: InputSchema = { type: 'object', properties: { id: ID }, required: ['id'] };

/** The tools, over the parts of one running Plugin Server. */
export function toolsFor({ store }: Parts): readonly Tool[] {
  return [
    {
      name: 'list_topics',
      description:
        'Every Topic, in the order they were made, with its number of Sources and the time ' +
        'and state of its last Sweep (null when it was never swept).',
      inputSchema: { type: 'object', properties: {}, required: [] },
      call: () => told({ topics: listTopics(store) }),
    },

    {
      name: 'get_topic',
      description: 'One Topic: its name, question, Sources in order, and Sweeps from new to old.',
      inputSchema: BY_ID,
      call: (given) => told({ topic: viewOf(store, checkTopicId('get_topic', given['id'])) }),
    },

    {
      name: 'create_topic',
      description:
        'Make a Topic with a name, an optional question and its Sources. An address that is ' +
        'not http or https is refused with a sentence that names it, and nothing is saved.',
      inputSchema: {
        type: 'object',
        properties: { name: NAME, question: QUESTION, sources: SOURCES },
        required: ['name'],
      },
      call: (given) => {
        const input = checkTopicInput('create_topic', given, true);
        return told({ topic: within(store, () => makeTopic(store, input)) });
      },
    },

    {
      name: 'update_topic',
      description:
        'Change the name, the question or the Sources of a Topic. What is not given is kept; ' +
        'Sources, when given, replace the whole list in their new order. A Sweep that runs ' +
        'keeps the Sources it started with.',
      inputSchema: {
        type: 'object',
        properties: { id: ID, name: NAME, question: QUESTION, sources: SOURCES },
        required: ['id'],
      },
      call: (given) => {
        const id = checkTopicId('update_topic', given['id']);
        const input = checkTopicInput('update_topic', given, false);
        return told({ topic: within(store, () => changeTopic(store, id, input)) });
      },
    },

    {
      name: 'delete_topic',
      description: 'Delete a Topic for good, with its Sources and its Sweeps.',
      inputSchema: BY_ID,
      call: (given) => {
        const id = checkTopicId('delete_topic', given['id']);
        return told({ deleted: within(store, () => deleteTopic(store, id)) });
      },
    },
  ];
}

/** One answer, in both the shapes MCP offers, from one value. */
function told(value: unknown): ToolResult {
  return {
    content: [{ type: 'text', text: JSON.stringify(value, null, 2) }],
    structuredContent: value,
  };
}
