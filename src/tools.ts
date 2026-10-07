/**
 * The tools this Plugin ships: one for each thing the Plugin Page or another
 * Plugin can ask research to do (FirstMate ADR-0009).
 *
 * The Plugin Page uses these same tools, through the Host's `rpc` address, so
 * there is one list of what research can do. Every tool answers the same data
 * twice: as text, for whoever reads it in a terminal, and as structure, for
 * the Page, which draws it. Each refusal is a JSON-RPC error with a sentence.
 */
import { COMMAND_FORM, commandFrom, type Command } from './command.ts';
import { badInput, type InputSchema, type Tool, type ToolResult } from './mcp.ts';
import { within } from './store.ts';
import {
  checkSweepId,
  deleteSweep,
  latestSweep,
  remakeDigest,
  startSweep,
  sweepView,
  type Sweeping,
} from './sweeps.ts';
import {
  changeTopic,
  checkTopicId,
  checkTopicInput,
  deleteTopic,
  listTopics,
  makeTopic,
  viewOf,
} from './topics.ts';

/** What the tools work over: the data file, how a Sweep reads, and how it makes its Digest. */
export type Parts = Sweeping;

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

const SWEEP_ID = { type: 'integer', description: 'The id of the Sweep, from get_topic.' };

/** Only the id of a Topic. */
const BY_ID: InputSchema = { type: 'object', properties: { id: ID }, required: ['id'] };

/** The tools, over the parts of one running Plugin Server. */
export function toolsFor(parts: Parts): readonly Tool[] {
  const { store } = parts;
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

    {
      name: 'sweep_topic',
      description:
        'Start a Sweep of a Topic: each of its Sources is read once, as one page and no page ' +
        'it links to, then the Digest is made from what was read. It answers at once with ' +
        'the new Sweep; get_sweep shows its progress. It is refused while a Sweep of that ' +
        'Topic runs.',
      inputSchema: BY_ID,
      call: (given) => {
        const topic = viewOf(store, checkTopicId('sweep_topic', given['id']));
        return told({ sweep: startSweep(parts, topic) });
      },
    },

    {
      name: 'get_sweep',
      description:
        'One Sweep: its state, why it failed, its Digest and when it was made, and each ' +
        'Extract with its text or the reason it has none, and whether the prompt cut it. ' +
        'Give "id" for one Sweep, or "topic" alone for the latest Sweep of that Topic (null ' +
        'when it was never swept).',
      inputSchema: {
        type: 'object',
        properties: {
          id: SWEEP_ID,
          topic: { type: 'integer', description: 'The id of a Topic, for its latest Sweep.' },
        },
        required: [],
      },
      call: (given) => {
        if (given['id'] !== undefined) {
          const sweep = sweepView(store, checkSweepId('get_sweep', 'id', given['id']));
          if (given['topic'] !== undefined && given['topic'] !== sweep.topicId) {
            throw badInput(`Sweep ${sweep.id} is not a Sweep of Topic ${String(given['topic'])}.`);
          }
          return told({ sweep });
        }
        if (given['topic'] === undefined) {
          throw badInput('get_sweep needs "id", a Sweep, or "topic", for its latest Sweep.');
        }
        const topic = viewOf(store, checkTopicId('get_sweep', given['topic']));
        return told({ sweep: latestSweep(store, topic.id) });
      },
    },

    {
      name: 'make_digest',
      description:
        'Make the Digest of a stored Sweep again, from the Extracts it keeps, with no new ' +
        'fetch: after a change to the question or to the Digest command. It answers at once ' +
        'with the Sweep, digesting; get_sweep shows when it ends. The new Digest replaces ' +
        'the old one. It works on a failed Sweep too, and is refused while a Sweep of that ' +
        'Topic runs.',
      inputSchema: { type: 'object', properties: { id: SWEEP_ID }, required: ['id'] },
      call: (given) => {
        const id = checkSweepId('make_digest', 'id', given['id']);
        return told({ sweep: remakeDigest(parts, id) });
      },
    },

    {
      name: 'get_settings',
      description:
        'The settings an operator chooses: the Digest command, as the program and its ' +
        'arguments the next Digest runs (null for none); who decides it ("environment" when ' +
        'RESEARCH_DIGEST_COMMAND is set, "file" when the settings file holds it, "default" ' +
        'for none); and what the settings file holds.',
      inputSchema: { type: 'object', properties: {}, required: [] },
      call: () => told(settingsOf(parts)),
    },

    {
      name: 'update_settings',
      description:
        'Change the settings an operator chooses, and keep them in the settings file in the ' +
        'Plugin directory. What is not given is kept. RESEARCH_DIGEST_COMMAND, when it is ' +
        'set, still decides the Digest command. A bad value is refused with one sentence, ' +
        'and the file is left as it was.',
      inputSchema: {
        type: 'object',
        properties: {
          digestCommand: {
            type: ['array', 'null'],
            items: { type: 'string' },
            description:
              'The Digest command: the program, then each of its arguments. It reads a prompt ' +
              'on stdin and prints the Digest. Null for none.',
          },
        },
        required: [],
      },
      call: (given) => {
        if (given['digestCommand'] !== undefined) {
          parts.digesting.command.save(checkDigestCommand(given['digestCommand']));
        }
        return told(settingsOf(parts));
      },
    },

    {
      name: 'delete_sweep',
      description:
        'Delete a Sweep for good, with its Extracts and its Digest. It is refused while that ' +
        'Sweep runs.',
      inputSchema: { type: 'object', properties: { id: SWEEP_ID }, required: ['id'] },
      call: (given) => {
        const id = checkSweepId('delete_sweep', 'id', given['id']);
        return told({ deleted: within(store, () => deleteSweep(store, id)) });
      },
    },
  ];
}

/** The settings, as get_settings and update_settings answer them. */
function settingsOf(parts: Parts): unknown {
  return { settings: { digestCommand: parts.digesting.command.view() } };
}

/** A Digest command as update_settings is given it, or null for none, or a refusal. */
function checkDigestCommand(given: unknown): Command | null {
  if (given === null) return null;
  const command = commandFrom(given);
  if (command === null) {
    throw badInput(
      `update_settings: digestCommand is ${JSON.stringify(given)}; set it to ${COMMAND_FORM}, ` +
        'or to null for none.',
    );
  }
  return command;
}

/** One answer, in both the shapes MCP offers, from one value. */
function told(value: unknown): ToolResult {
  return {
    content: [{ type: 'text', text: JSON.stringify(value, null, 2) }],
    structuredContent: value,
  };
}
