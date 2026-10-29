// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 northbit
// Bundles the browser demo into web/dist (static files, no server logic).
// The compiled CallSeal circuits and the Midnight on-chain runtime (WASM)
// run fully in the visitor's browser.
import { build } from 'esbuild';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const out = path.join(root, 'web/dist');
const rtDir = path.join(root, 'node_modules/@midnight-ntwrk/onchain-runtime-v3');
fs.rmSync(out, { recursive: true, force: true });
fs.mkdirSync(out, { recursive: true });

// The runtime ships a "bundler" wasm-bindgen entry (import * from '.wasm').
// Replace it with an explicit fetch + instantiate using top-level await.
const wasmLoader = {
  name: 'onchain-runtime-wasm',
  setup(b) {
    b.onLoad({ filter: /onchain-runtime-v3[\\/]midnight_onchain_runtime_wasm\.js$/ }, () => ({
      resolveDir: rtDir,
      contents: `
import * as bg from './midnight_onchain_runtime_wasm_bg.js';
export * from './midnight_onchain_runtime_wasm_bg.js';
const url = new URL('./onchain_runtime.wasm', import.meta.url);
const imports = { './midnight_onchain_runtime_wasm_bg.js': bg };
const { instance } = await WebAssembly.instantiateStreaming(fetch(url), imports)
  .catch(async () => WebAssembly.instantiate(await (await fetch(url)).arrayBuffer(), imports));
bg.__wbg_set_wasm(instance.exports);
instance.exports.__wbindgen_start();
`,
    }));
  },
};

const runs = {};
for (const f of fs.existsSync(path.join(root, 'deploy/runs')) ? fs.readdirSync(path.join(root, 'deploy/runs')) : []) {
  if (f.endsWith('.json')) runs[f.replace('.json', '')] = JSON.parse(fs.readFileSync(path.join(root, 'deploy/runs', f), 'utf8'));
}

await build({
  entryPoints: [path.join(root, 'web/app.js')],
  bundle: true,
  format: 'esm',
  platform: 'browser',
  target: 'es2022',
  conditions: ['browser'],
  minify: true,
  sourcemap: false,
  outfile: path.join(out, 'app.js'),
  define: { __CALLSEAL_RUNS__: JSON.stringify(runs) },
  plugins: [wasmLoader],
  logLevel: 'warning',
});
fs.copyFileSync(path.join(rtDir, 'midnight_onchain_runtime_wasm_bg.wasm'), path.join(out, 'onchain_runtime.wasm'));
for (const f of ['index.html', 'style.css']) fs.copyFileSync(path.join(root, 'web', f), path.join(out, f));
const size = (f) => (fs.statSync(path.join(out, f)).size / 1024).toFixed(0) + ' KiB';
console.log(`web/dist ready: app.js ${size('app.js')}, onchain_runtime.wasm ${size('onchain_runtime.wasm')}`);
