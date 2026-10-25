import { readFile, rename, writeFile } from 'node:fs/promises';
import { homedir } from 'node:os';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawn } from 'node:child_process';
import { Importer } from './importer.ts';
import { UsageStore } from './store.ts';
import { renderSnapshot } from './snapshot.ts';

const root = fileURLToPath(new URL('../../', import.meta.url));
const home = resolve(process.env.CODEX_HOME ?? join(homedir(), '.codex'));
const data = resolve(process.env.CODEX_USAGE_DATA_DIR ?? (process.platform === 'darwin'
  ? join(homedir(), 'Library', 'Application Support', 'codex-usage')
  : join(process.env.XDG_DATA_HOME ?? join(homedir(), '.local', 'share'), 'codex-usage')));
const store = new UsageStore(join(data, 'usage.sqlite'));
const filename = join(data, 'dashboard.html');
try {
  const importer = new Importer(store, home);
  console.log('Importing Codex usage…');
  await importer.refresh();
  if (importer.status.error) console.warn(`Import failed: ${importer.status.error}. Showing saved usage.`);
  const template = await readFile(join(root, 'dist/index.html'), 'utf8');
  // Replace the previous snapshot only after the new file is complete.
  const temporary = `${filename}.${process.pid}.tmp`;
  await writeFile(temporary, renderSnapshot(template, store, importer.status), { mode: 0o600 });
  await rename(temporary, filename);
} finally {
  store.close();
}
console.log(`\n  Codex Usage  ${filename}\n  Run pnpm start again to update this snapshot.\n`);
if (!process.argv.includes('--no-open')) {
  const command = process.platform === 'darwin' ? 'open' : process.platform === 'win32' ? 'explorer.exe' : 'xdg-open';
  const browser = spawn(command, [filename], { stdio: 'ignore' });
  browser.on('error', () => console.log(`Open ${filename} in your browser.`));
  browser.unref();
}
