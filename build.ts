/**
 * Make `release/`, the files a Plugin Release ships (FirstMate ADR-0033):
 * `mcp.js`, the bundle of `mcp.ts` and `src/`; the `mcp` wrapper; and `web/`.
 * The release workflow runs it as `node build.ts`, in the repository root.
 *
 * It copies a short list of names and never a folder of the repository, so
 * `research.db` and `settings.json`, which the Plugin keeps in its own
 * directory when that directory is this repository, cannot reach `release/`.
 * They are the operator's data, and `firstmate update` keeps them.
 */
import { spawnSync } from 'node:child_process';
import { cp, mkdir, rm } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = dirname(fileURLToPath(import.meta.url));
const release = join(root, 'release');

/** What a Plugin Release copies as it is, beside the bundle. */
const COPIED = ['mcp', 'web'];

await rm(release, { recursive: true, force: true });
await mkdir(release);

const tsdown = join(root, 'node_modules', 'tsdown', 'dist', 'run.mjs');
const bundled = spawnSync(process.execPath, [tsdown, '--logLevel', 'warn'], {
  cwd: root,
  stdio: 'inherit',
});
if (bundled.status !== 0) throw new Error('tsdown could not bundle mcp.ts.');

for (const name of COPIED) await cp(join(root, name), join(release, name), { recursive: true });
