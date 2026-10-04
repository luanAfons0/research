/**
 * The tools this Plugin ships: one for each thing the Plugin Page or another
 * Plugin can ask research to do (FirstMate ADR-0009).
 *
 * The Plugin Page uses these same tools, through the Host's `rpc` address, so
 * there is one list of what research can do. Every tool answers the same data
 * twice: as text, for whoever reads it in a terminal, and as structure, for
 * the Page, which draws it.
 */
import type { Tool } from './mcp.ts';
import type { Store } from './store.ts';

/** What the tools work over. */
export type Parts = {
  readonly store: Store;
};

/** The tools, over the parts of one running Plugin Server. There are none yet. */
export function toolsFor(_parts: Parts): readonly Tool[] {
  return [];
}
