// Test the built Worker over HTTP without Wrangler's hot-reloading dev proxy.
import '../scripts/sites-env.mjs';
import { dirname, join } from 'node:path';
import { readdirSync } from 'node:fs';
import { createRequire } from 'node:module';
import { pathToFileURL } from 'node:url';
import { unstable_getMiniflareWorkerOptions } from 'wrangler';

// Resolve the exact Miniflare version already pinned by Wrangler, including
// package managers that do not hoist transitive dependencies.
const requireFromWrangler = createRequire(import.meta.resolve('wrangler'));
const { Miniflare, Log, LogLevel } = await import(pathToFileURL(requireFromWrangler.resolve('miniflare')).href);

let input = '';
for await (const chunk of process.stdin) input += chunk;
const { config, persistTo, port, vars } = JSON.parse(input);
const { workerOptions, main, externalWorkers } = unstable_getMiniflareWorkerOptions(config);
if (!main) throw Error('The built Worker entrypoint is missing.');
// Vinext imports its SSR chunks dynamically. Register the complete build,
// as Wrangler's no_bundle mode does, instead of inferring static imports.
const root = dirname(main);
const modules = [main, ...readdirSync(root, { recursive: true }).filter(file => /\.(?:m?js)$/.test(file)).map(file => join(root, file)).filter(file => file !== main)];
const runtime = new Miniflare({
  host: '127.0.0.1', port, cf: false, log: new Log(LogLevel.WARN),
  r2Persist: join(persistTo, 'v3', 'r2'),
  d1Persist: join(persistTo, 'v3', 'd1'),
  cachePersist: join(persistTo, 'v3', 'cache'),
  workers: [{
    ...workerOptions,
    name: 'arafat-http-test', modules: modules.map(path => ({ type: 'ESModule', path })), modulesRoot: root,
    bindings: { ...workerOptions.bindings, ...vars },
  }, ...externalWorkers],
});
let stopping = false;
async function stop() {
  if (stopping) return;
  stopping = true;
  await runtime.dispose();
}
process.once('SIGINT', stop);
process.once('SIGTERM', stop);
await runtime.ready;
process.stdout.write('Built Worker HTTP runtime ready.\n');
