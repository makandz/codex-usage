import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';

const root = fileURLToPath(new URL('../', import.meta.url));
for (const [executable, args] of [
  ['node_modules/typescript/bin/tsc', ['--noEmit']],
  ['node_modules/typescript/bin/tsc', ['-p', 'tsconfig.server.json']],
  ['node_modules/vite/bin/vite.js', ['build']],
]) {
  const result = spawnSync(process.execPath, [executable, ...args], { cwd: root, stdio: 'inherit' });
  if (result.error) throw result.error;
  if (result.status !== 0) process.exit(result.status ?? 1);
}

// Inline every asset so Chrome can open the snapshot directly from disk.
const dist = join(root, 'dist');
let html = await readFile(join(dist, 'index.html'), 'utf8');
for (const match of html.matchAll(/<script\b[^>]*\bsrc="([^"]+)"[^>]*><\/script>/g)) {
  const script = await readFile(join(dist, match[1]), 'utf8');
  html = html.replace(match[0], () => `<script type="module">${script.replace(/<\/script/gi, '<\\/script')}</script>`);
}
for (const match of html.matchAll(/<link\b[^>]*\brel="stylesheet"[^>]*\bhref="([^"]+)"[^>]*>/g)) {
  const css = await readFile(join(dist, match[1]), 'utf8');
  html = html.replace(match[0], () => `<style>${css.replace(/<\/style/gi, '<\\/style')}</style>`);
}
const favicon = await readFile(join(dist, 'favicon.svg'));
html = html.replace('/favicon.svg', `data:image/svg+xml;base64,${favicon.toString('base64')}`);
await writeFile(join(dist, 'index.html'), html);
