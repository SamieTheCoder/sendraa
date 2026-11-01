// Bundles the Worker into one ES module that the provisioner uploads through
// the Cloudflare API. Wrangler is only used for local development.
import { readFile } from 'node:fs/promises';

import { build } from 'esbuild';

const pkg = JSON.parse(await readFile(new URL('../package.json', import.meta.url), 'utf8'));

const result = await build({
  entryPoints: [new URL('../src/index.ts', import.meta.url).pathname],
  outfile: new URL('../dist/worker.js', import.meta.url).pathname,
  bundle: true,
  format: 'esm',
  platform: 'neutral',
  target: 'es2024',
  conditions: ['workerd', 'worker', 'browser'],
  mainFields: ['module', 'main'],
  external: ['cloudflare:*'],
  minify: true,
  legalComments: 'none',
  define: { __WORKER_VERSION__: JSON.stringify(pkg.version) },
  metafile: true,
});

const bytes = Object.values(result.metafile.outputs)[0]?.bytes ?? 0;
console.log(`dist/worker.js ${(bytes / 1024).toFixed(1)} KiB, version ${pkg.version}`);
