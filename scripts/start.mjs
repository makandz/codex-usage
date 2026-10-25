import { readdir, stat } from 'node:fs/promises';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { join } from 'node:path';

const root = fileURLToPath(new URL('../', import.meta.url));
process.chdir(root);
async function modified(path) {
  const info = await stat(path);
  if (!info.isDirectory()) return info.mtimeMs;
  const children = await readdir(path);
  return Math.max(info.mtimeMs, ...await Promise.all(children.map(child => modified(join(path, child)))));
}
let built = 0;
try { built = Math.min((await stat('dist/index.html')).mtimeMs, (await stat('build/server/index.js')).mtimeMs); }
catch { /* The first launch builds the app from installed dependencies. */ }
const source = Math.max(...await Promise.all([
  'src', 'server', 'shared', 'public', 'index.html', 'vite.config.ts', 'package.json', 'tsconfig.json', 'tsconfig.server.json',
].map(modified)));
if (source > built) {
  console.log('Building Codex Usage…');
  const build = spawn(process.execPath, ['scripts/build.mjs'], { stdio: 'inherit' });
  const code = await new Promise(resolve => { build.on('exit', resolve); build.on('error', error => { console.error(error.message); resolve(1); }); });
  if (code !== 0) process.exit(typeof code === 'number' ? code : 1);
}
await import('../build/server/index.js');
