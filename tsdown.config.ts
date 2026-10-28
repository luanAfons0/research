/**
 * The only build in this project, and it runs on the release path alone.
 *
 * A clone still runs `mcp.ts` as TypeScript with no build step. A Plugin
 * Release ships one `mcp.js` instead, because the Host takes `mcp.ts` before
 * `mcp.js` (FirstMate ADR-0028) and an archive with both would run the source.
 *
 * Not minified, so that a stack trace stays readable. There is no runtime
 * dependency to bundle: `node:sqlite` and the other `node:` modules stay
 * imports of the Node that runs the file.
 */
import { defineConfig } from 'tsdown';

// biome-ignore lint/style/noDefaultExport: tsdown reads its config from the default export.
export default defineConfig({
  entry: { mcp: 'mcp.ts' },
  format: 'esm',
  platform: 'node',
  outDir: 'release',
  // package.json says "type": "module", so .js is already ESM.
  fixedExtension: false,
  clean: false,
  dts: false,
  minify: false,
  sourcemap: false,
});
